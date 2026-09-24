import { createClient } from "../../../../../lib/supabase/server";
import { requirePermission } from "../../../../../lib/auth";
import { can } from "../../../../../lib/permissions";

/**
 * Everything the hotel holds about one guest, as JSON — for a guest asking
 * for their data (SOW Module 8: "handled per applicable privacy laws").
 * Scans are listed, not included; the ID number is included only for roles
 * that may see it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("guests.privacy");
  const { id } = await params;
  const supabase = await createClient();

  const { data: guest } = await supabase.from("guests").select("*").eq("id", id).maybeSingle();
  if (!guest) return new Response("Guest not found.", { status: 404 });

  const [{ data: bookings }, { data: feedback }, { data: documents }, { data: identity }] = await Promise.all([
    supabase
      .from("bookings")
      .select("reference, status, source, check_in, check_out, adults, children, rooms_count, total_amount, special_requests, contact_name, contact_email, contact_phone, created_at, room_types(name)")
      .eq("guest_id", id)
      .order("check_in"),
    supabase.from("guest_feedback").select("overall, room, service, cleanliness, food, comment, submitted_at, source").eq("guest_id", id),
    supabase.from("guest_documents").select("kind, uploaded_at").eq("guest_id", id),
    can(session, "guests.view_id")
      ? supabase.from("guest_identities").select("id_type, id_number, issuing_country, expiry_date, visa_number").eq("guest_id", id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const { data: messages } = await supabase
    .from("notifications")
    .select("channel, template, recipient, subject, status, created_at")
    .in("recipient", [guest.email, guest.phone].filter(Boolean) as string[]);

  await supabase.rpc("log_event", {
    p_module: "guests",
    p_action: "export",
    p_record_id: id,
    p_summary: `Exported the personal data of ${guest.full_name}`,
  });

  const body = {
    exported_at: new Date().toISOString(),
    profile: guest,
    identity: identity ?? (can(session, "guests.view_id") ? null : "withheld — requires the View identity documents permission"),
    identity_documents_held: documents ?? [],
    stays: bookings ?? [],
    feedback: feedback ?? [],
    messages_sent: messages ?? [],
  };
  const safeName = guest.full_name.replace(/[^\w-]+/g, "-").toLowerCase() || "guest";
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="guest-data-${safeName}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
