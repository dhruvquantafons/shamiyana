import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";
import { createClient } from "../../../../../lib/supabase/server";
import { requirePermission } from "../../../../../lib/auth";
import { getSettings } from "../../../../../lib/settings";
import type { GuestDocument } from "../../../../../lib/types";
import { DOCUMENT_KIND_LABELS, ID_TYPE_LABELS } from "../../../../../lib/types";
import { Card, EmptyState, Notice, SectionTitle, Tag, fmtDate, fmtDateTime } from "../../../../components/ui";

type DocRow = GuestDocument & {
  bookings: { reference: string; check_in: string } | null;
  staff: { full_name: string } | null;
};

/** Signed links expire quickly so a copied URL is useless soon after. */
const LINK_SECONDS = 300;

/**
 * The guest's identity scans and full ID details. Only roles with
 * guests.view_id reach this page, and every visit is written to the audit log.
 */
export default async function IdentityPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("guests.view_id");
  const { id } = await params;
  const supabase = await createClient();
  const settings = await getSettings();

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, reference, guest_id, contact_name, guests(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!booking) notFound();
  const guestName =
    (booking.guests as unknown as { full_name: string } | null)?.full_name || booking.contact_name || "Unnamed guest";

  const back = (
    <Link
      href={`/admin/bookings/${id}`}
      className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700 mb-4"
    >
      <ArrowLeft className="w-3.5 h-3.5" /> {booking.reference}
    </Link>
  );

  if (!booking.guest_id) {
    return (
      <div className="max-w-3xl">
        {back}
        <Notice>No guest profile yet — ID is captured at check-in.</Notice>
      </div>
    );
  }

  const [{ data: identity }, { data: docData }] = await Promise.all([
    supabase.from("guest_identities").select("*").eq("guest_id", booking.guest_id).maybeSingle(),
    supabase
      .from("guest_documents")
      .select("*, bookings(reference, check_in), staff:uploaded_by(full_name)")
      .eq("guest_id", booking.guest_id)
      .order("uploaded_at", { ascending: false }),
  ]);
  const docs = (docData ?? []) as DocRow[];

  const { data: signed } = docs.length
    ? await supabase.storage.from("guest-documents").createSignedUrls(
        docs.map((d) => d.storage_path),
        LINK_SECONDS,
      )
    : { data: [] };
  const urlFor = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  await supabase.rpc("log_event", {
    p_module: "guests",
    p_action: "view_id",
    p_record_id: id,
    p_summary: `Viewed ID documents of ${guestName} (${booking.reference})`,
  });

  // This stay first, then earlier stays.
  const thisStay = docs.filter((d) => d.booking_id === id);
  const earlier = docs.filter((d) => d.booking_id !== id);

  const gallery = (list: DocRow[]) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4">
      {list.map((d) => {
        const url = urlFor.get(d.storage_path);
        const isPdf = d.storage_path.toLowerCase().endsWith(".pdf");
        return (
          <figure key={d.id} className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
            {!url ? (
              <p className="h-48 flex items-center justify-center text-xs text-slate-500">File no longer available</p>
            ) : isPdf ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="h-48 flex flex-col items-center justify-center gap-2 text-sm text-yellow-800 hover:text-yellow-900"
              >
                <FileText className="w-8 h-8" /> Open PDF
              </a>
            ) : (
              <a href={url} target="_blank" rel="noreferrer" title="Open full size">
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                <img
                  src={url}
                  alt={`${DOCUMENT_KIND_LABELS[d.kind]} of ${guestName}`}
                  className={`w-full h-48 ${d.kind === "signature" ? "object-contain bg-white" : "object-cover"}`}
                />
              </a>
            )}
            <figcaption className="px-3 py-2 bg-white border-t border-slate-200">
              <p className="text-sm font-medium text-slate-900">{DOCUMENT_KIND_LABELS[d.kind] ?? d.kind}</p>
              <p className="text-xs text-slate-500">
                {fmtDateTime(d.uploaded_at)}
                {d.staff?.full_name && ` · ${d.staff.full_name}`}
                {d.booking_id !== id && d.bookings && ` · stay ${d.bookings.reference}, ${fmtDate(d.bookings.check_in)}`}
              </p>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        {back}
        <h1 className="text-xl font-semibold text-slate-900">ID documents — {guestName}</h1>
        <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" />
          Restricted. This visit is recorded in the audit log. Links expire after {LINK_SECONDS / 60} minutes; scans are
          deleted {settings.id_document_retention_days} days after upload.
        </p>
      </div>

      <Card className="p-5">
        <SectionTitle>ID on file</SectionTitle>
        {identity ? (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Type</dt>
              <dd className="text-slate-900">{ID_TYPE_LABELS[identity.id_type] ?? identity.id_type}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Number</dt>
              <dd className="text-slate-900 font-mono">{identity.id_number}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Issuing country</dt>
              <dd className="text-slate-900">{identity.issuing_country}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Expiry</dt>
              <dd className="text-slate-900">{identity.expiry_date ? fmtDate(identity.expiry_date) : "—"}</dd>
            </div>
            {identity.visa_number && (
              <div>
                <dt className="text-xs text-slate-500">Visa number</dt>
                <dd className="text-slate-900 font-mono">{identity.visa_number}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-sm text-slate-500">No ID details recorded.</p>
        )}
      </Card>

      <Card>
        <div className="px-4 pt-4">
          <SectionTitle action={<Tag>{thisStay.length}</Tag>}>This stay</SectionTitle>
        </div>
        {thisStay.length ? gallery(thisStay) : <EmptyState message="No scans for this stay." />}
      </Card>

      {earlier.length > 0 && (
        <Card>
          <div className="px-4 pt-4">
            <SectionTitle action={<Tag>{earlier.length}</Tag>}>Earlier stays</SectionTitle>
          </div>
          {gallery(earlier)}
        </Card>
      )}
    </div>
  );
}
