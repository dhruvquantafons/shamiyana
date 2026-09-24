import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import { loadPricingData, loadCompanies } from "../../../../lib/rate-data";
import { todayIn, addDays } from "../../../../lib/dates";
import { loadGroupAvailability, getCurrentProperty } from "../../../../lib/properties";
import { Card } from "../../../components/ui";
import NewBookingForm from "./NewBookingForm";
import CentralReservation from "./CentralReservation";

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ walkin?: string; check_in?: string; room_type?: string }>;
}) {
  const session = await requirePermission("bookings.create");
  const params = await searchParams;
  const supabase = await createClient();
  const settings = await getSettings();
  const [pricing, companies] = await Promise.all([loadPricingData(supabase), loadCompanies(supabase)]);

  const today = todayIn(settings.timezone);
  const walkIn = params.walkin === "1";
  const checkIn = !walkIn && params.check_in && params.check_in >= today ? params.check_in : today;
  const checkOut = addDays(checkIn, 1);

  // Who in the group has room on these dates (SOW Module 14). Returns a single
  // property for a single-hotel installation, and the strip hides itself.
  const [availability, currentProperty] = await Promise.all([
    loadGroupAvailability(checkIn, checkOut),
    getCurrentProperty(),
  ]);

  return (
    <>
      <Link
        href={walkIn ? "/admin/front-desk" : "/admin/bookings"}
        className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700 mb-4 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </Link>

      <h1 className="text-xl font-semibold tracking-tight text-slate-900 mb-1">{walkIn ? "Walk-in guest" : "New booking"}</h1>
      <p className="text-sm text-slate-600 mb-6">
        {walkIn
          ? "Book the stay, then check the guest straight in."
          : "For reservations by phone, email, travel agent or at the desk. A returning guest is matched on email or phone."}
      </p>

      <div className="max-w-4xl">
        <CentralReservation
          availability={availability}
          current={currentProperty?.id ?? null}
          checkIn={checkIn}
          checkOut={checkOut}
        />
      </div>

      <Card className="p-5 max-w-4xl">
        <NewBookingForm
          roomTypes={pricing.roomTypes.filter((t) => t.is_active)}
          plans={pricing.plans.filter((p) => p.is_active)}
          seasons={pricing.seasons}
          restrictions={pricing.restrictions}
          extraCharges={pricing.extraCharges}
          adjustments={pricing.adjustments}
          companies={companies}
          defaults={{
            checkIn,
            checkOut,
            source: walkIn ? "walk_in" : "phone",
            roomTypeId: params.room_type ?? "",
            walkIn,
          }}
          canOverbook={can(session, "bookings.overbook")}
          canOverrideRate={can(session, "bookings.edit")}
          canTakePayment={can(session, "folio.payment")}
        />
      </Card>
    </>
  );
}
