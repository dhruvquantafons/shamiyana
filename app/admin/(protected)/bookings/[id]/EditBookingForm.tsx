import type { Booking, Company, RatePlan, RoomType } from "../../../../lib/types";
import { BOOKING_SOURCE_LABELS, PAYMENT_METHOD_LABELS } from "../../../../lib/types";
import { updateBookingDetails } from "../../../booking-actions";
import { Field, Check, inputClass } from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

/**
 * Amendments. Changing dates, room type, plan or occupancy re-prices the stay
 * from the current rates; nights an in-house guest has already stayed keep
 * the price they were sold at. A manual rate overrides every night.
 */
export default function EditBookingForm({
  booking,
  roomTypes,
  plans,
  companies,
  canOverbook,
}: {
  booking: Booking;
  roomTypes: RoomType[];
  plans: RatePlan[];
  companies: Company[];
  canOverbook: boolean;
}) {
  const inHouse = booking.status === "checked_in";

  return (
    <ActionForm
      action={updateBookingDetails}
      submitLabel="Save changes"
      overbookHint={
        canOverbook ? (
          <Field label="Overbooking reason" hint="Needed to sell beyond capacity. Recorded in the audit log.">
            <input name="overbook_reason" className={inputClass} />
          </Field>
        ) : null
      }
    >
      <input type="hidden" name="id" value={booking.id} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Guest name">
          <input name="contact_name" defaultValue={booking.contact_name} className={inputClass} />
        </Field>
        <Field label="Phone">
          <input name="contact_phone" defaultValue={booking.contact_phone} className={inputClass} />
        </Field>
        <Field label="Email">
          <input name="contact_email" type="email" defaultValue={booking.contact_email} className={inputClass} />
        </Field>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <Field label="Arrival">
          <input type="date" name="check_in" defaultValue={booking.check_in} readOnly={inHouse} required className={inputClass} />
        </Field>
        <Field label="Departure">
          <input type="date" name="check_out" defaultValue={booking.check_out} required className={inputClass} />
        </Field>
        <Field label="Adults">
          <input type="number" name="adults" min={1} defaultValue={booking.adults} className={inputClass} />
        </Field>
        <Field label="Children">
          <input type="number" name="children" min={0} defaultValue={booking.children} className={inputClass} />
        </Field>
        <Field label="Rooms">
          <input type="number" name="rooms_count" min={1} defaultValue={booking.rooms_count} readOnly={inHouse} className={inputClass} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Room type">
          <select name="room_type_id" defaultValue={booking.room_type_id ?? ""} className={inputClass}>
            <option value="">Not set</option>
            {roomTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Rate plan">
          <select name="rate_plan_id" defaultValue={booking.rate_plan_id ?? ""} className={inputClass}>
            <option value="">Not set</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.is_active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Override nightly rate (₹)" hint={`Now ${booking.quoted_rate ?? "—"} on average.`}>
          <input type="number" name="rate_override" min={0} step="1" className={inputClass} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Source">
          <select name="source" defaultValue={booking.source} className={inputClass}>
            {Object.entries(BOOKING_SOURCE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Payment method">
          <select name="payment_method" defaultValue={booking.payment_method ?? ""} className={inputClass}>
            <option value="">Not set</option>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Company">
          <select name="company_id" defaultValue={booking.company_id ?? ""} className={inputClass}>
            <option value="">Individual</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Preferred floor">
          <input type="number" name="preferred_floor" defaultValue={booking.preferred_floor ?? ""} className={inputClass} />
        </Field>
        <Field label="Preferred view">
          <input name="preferred_view" defaultValue={booking.preferred_view} className={inputClass} />
        </Field>
        <Field label="Expected arrival">
          <input type="time" name="eta" defaultValue={booking.eta?.slice(0, 5) ?? ""} className={inputClass} />
        </Field>
      </div>

      <Field label="Special requests">
        <textarea name="special_requests" rows={2} defaultValue={booking.special_requests} className={inputClass} />
      </Field>

      <div className="flex flex-wrap gap-6">
        <Check name="is_vip" defaultChecked={booking.is_vip} label="VIP" />
        <Check name="reprice" label="Re-price from current rates" hint="Even if nothing else changed." />
        <Check
          name="notify_guest"
          label="Tell the guest"
          hint="Emails the updated details, but only if the stay itself moved."
        />
        {canOverbook && <Check name="override_restrictions" label="Override stay restrictions" />}
      </div>
    </ActionForm>
  );
}
