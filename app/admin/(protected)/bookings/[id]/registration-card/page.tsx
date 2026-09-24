import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "../../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../../lib/auth";
import { can } from "../../../../../lib/permissions";
import { getSettings, hhmm } from "../../../../../lib/settings";
import type { Booking } from "../../../../../lib/types";
import { ID_TYPE_LABELS } from "../../../../../lib/types";
import { fmtDate, fmtDateTime, Notice } from "../../../../components/ui";
import PrintButton from "../../../../components/PrintButton";

/**
 * The signed registration card. The signature and full ID number are shown
 * only to roles with guests.view_id; everyone else sees the masked number.
 */
export default async function RegistrationCardPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAnyPermission(["frontdesk.view", "bookings.view"]);
  const { id } = await params;
  const supabase = await createClient();
  const settings = await getSettings();

  const [{ data: bookingData }, { data: card }] = await Promise.all([
    supabase.from("bookings").select("*, rooms(room_number), room_types(name)").eq("id", id).maybeSingle(),
    supabase.from("registration_cards").select("*").eq("booking_id", id).maybeSingle(),
  ]);
  if (!bookingData) notFound();
  const booking = bookingData as Booking;

  if (!card) {
    return <Notice>No registration card yet — it is completed at check-in.</Notice>;
  }

  const seesId = can(session, "guests.view_id");
  let identity: { id_type: string; id_number: string; issuing_country: string; visa_number: string } | null = null;
  let masked: { id_type: string; id_last4: string } | null = null;
  let signatureUrl: string | null = null;

  if (seesId && booking.guest_id) {
    const [{ data: gi }, { data: signed }] = await Promise.all([
      supabase.from("guest_identities").select("*").eq("guest_id", booking.guest_id).maybeSingle(),
      card.signature_path
        ? supabase.storage.from("guest-documents").createSignedUrl(card.signature_path, 300)
        : Promise.resolve({ data: null }),
    ]);
    identity = gi;
    signatureUrl = signed?.signedUrl ?? null;
  } else if (booking.guest_id) {
    const { data } = await supabase.rpc("guest_identity_masked", { p_guest: booking.guest_id });
    masked = (data as { id_type: string; id_last4: string }[] | null)?.[0] ?? null;
  }

  const row = (label: string, value: React.ReactNode) => (
    <div className="border-b border-slate-200 py-2 grid grid-cols-3 gap-2">
      <span className="text-slate-600 text-xs uppercase tracking-wider">{label}</span>
      <span className="col-span-2">{value || "—"}</span>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex justify-between items-center mb-6 print:hidden">
        <Link href={`/admin/bookings/${id}`} className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </Link>
        <PrintButton />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-8 print:border-0 print:p-0 text-sm">
        <div className="text-center mb-6">
          <p className="text-xl font-semibold tracking-tight">{settings.name}</p>
          <p className="text-xs font-medium text-slate-500 mt-1">Guest registration card</p>
        </div>

        {row("Reservation", <span className="font-mono">{booking.reference}</span>)}
        {row("Guest", card.guest_name)}
        {row("Address", card.address)}
        {row("Nationality", card.nationality)}
        {row(
          "Identity",
          identity
            ? `${ID_TYPE_LABELS[identity.id_type] ?? identity.id_type} ${identity.id_number}${identity.issuing_country ? ` (${identity.issuing_country})` : ""}${identity.visa_number ? ` · visa ${identity.visa_number}` : ""}`
            : masked
              ? `${ID_TYPE_LABELS[masked.id_type] ?? masked.id_type} ending ${masked.id_last4}`
              : "",
        )}
        {row("Contact", [card.phone, card.email].filter(Boolean).join(" · "))}
        {row("Room", `${booking.rooms?.room_number ?? "—"} · ${booking.room_types?.name ?? ""}`)}
        {row("Stay", `${fmtDate(booking.check_in)} → ${fmtDate(booking.check_out)} · ${booking.adults} adult(s)${booking.children ? `, ${booking.children} child(ren)` : ""}`)}

        <p className="text-xs text-slate-700 mt-6 leading-relaxed">
          I agree to the hotel&apos;s house rules. Check-out is by {hhmm(settings.check_out_time)}. I am responsible for all
          charges incurred during my stay, and for the room and its contents.
        </p>

        <div className="mt-6 flex items-end justify-between gap-6">
          <div>
            {signatureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              <img src={signatureUrl} alt="Guest signature" className="h-24 border-b border-slate-900" />
            ) : (
              <div className="h-24 w-64 border-b border-slate-900 flex items-end text-xs text-slate-500 pb-1">
                {card.signed_at ? "Signed electronically (visible to authorised roles)" : ""}
              </div>
            )}
            <p className="text-xs text-slate-600 mt-1">Guest signature</p>
          </div>
          <p className="text-xs text-slate-600">{card.signed_at ? `Signed ${fmtDateTime(card.signed_at)}` : ""}</p>
        </div>
      </div>
    </div>
  );
}
