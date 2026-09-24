/**
 * Turns the database's guard errors into sentences for the desk.
 *
 * enforce_booking_inventory() raises messages prefixed OVERBOOKED:,
 * ROOM_CONFLICT: and ROOM_BLOCKED:, which carry the detail after the colon.
 */
export function friendlyDbError(message: string | undefined | null): string {
  if (!message) return "Something went wrong. Please try again.";

  if (message.startsWith("OVERBOOKED:")) {
    return `No availability — ${message.slice("OVERBOOKED:".length).trim()}. Waitlist the guest, choose other dates or room type, or (with permission) override with a reason.`;
  }
  if (message.startsWith("ROOM_CONFLICT:")) {
    return `Room clash — ${message.slice("ROOM_CONFLICT:".length).trim()} for overlapping nights.`;
  }
  if (message.startsWith("ROOM_BLOCKED:")) {
    return `Room unavailable — ${message.slice("ROOM_BLOCKED:".length).trim()}.`;
  }
  if (message.startsWith("BUSINESS_DATE_MOVED:")) {
    return "Night audit has already moved the business date. Refresh and check the current date.";
  }
  if (message.startsWith("INVOICE_IMMUTABLE")) {
    return "An issued invoice cannot be changed or deleted. Cancel it and issue a new one.";
  }
  if (message.startsWith("INVOICE_CANCELLED")) {
    return "That invoice is already cancelled.";
  }
  if (message.startsWith("REFUND_SELF_APPROVAL")) {
    return "A refund must be approved by someone other than the person who requested it.";
  }
  if (message.startsWith("FOLIO_BOOKING_MISMATCH")) {
    return "That folio belongs to a different booking.";
  }

  // City ledger (Module 7)
  if (message.startsWith("CITY_LEDGER_CREDIT_LIMIT:")) {
    return `Over the credit limit — ${message.slice("CITY_LEDGER_CREDIT_LIMIT:".length).trim()}. Take a payment on account, or raise the limit under Companies.`;
  }
  if (message.startsWith("CITY_LEDGER_ALREADY_TRANSFERRED")) {
    return "This bill is already on a company account. Open a new folio for anything charged since.";
  }
  if (message.startsWith("CITY_LEDGER_NOTHING_OWED")) {
    return "There is nothing left to bill on this folio.";
  }
  if (message.startsWith("CITY_LEDGER_INACTIVE")) {
    return "That company account is closed. Reactivate it under Companies first.";
  }
  if (message.startsWith("CITY_LEDGER_INVOICED")) {
    return "This charge has been invoiced. Cancel the invoice before voiding the transfer.";
  }
  if (message.startsWith("CITY_LEDGER_ALREADY_VOID")) {
    return "That entry is already voided.";
  }
  if (message.startsWith("CITY_LEDGER_VOID_REASON")) {
    return "Give a reason for voiding this entry.";
  }
  if (message.startsWith("CITY_LEDGER_NO_COMPANY")) {
    return "Choose a company to bill.";
  }
  if (message.startsWith("CITY_LEDGER_NO_FOLIO") || message.startsWith("CITY_LEDGER_NO_ENTRY")) {
    return "That record no longer exists. Refresh the page.";
  }
  if (message.startsWith("CURRENCY_BASE_RATE")) {
    return "The property's own currency is always held at a rate of 1.";
  }

  // Loyalty (Module 8)
  if (message.startsWith("LOYALTY_INSUFFICIENT:")) {
    return `Not enough points — ${message.slice("LOYALTY_INSUFFICIENT:".length).trim()}.`;
  }
  if (message.startsWith("LOYALTY_BELOW_MINIMUM:")) {
    return `Too few points — ${message.slice("LOYALTY_BELOW_MINIMUM:".length).trim()}.`;
  }
  if (message.startsWith("LOYALTY_OVER_BALANCE:")) {
    return `Worth more than the bill — ${message.slice("LOYALTY_OVER_BALANCE:".length).trim()}. Redeem fewer points.`;
  }
  if (message.startsWith("LOYALTY_NOT_A_MEMBER")) {
    return "Enrol the guest in the loyalty programme first.";
  }
  if (message.startsWith("LOYALTY_NO_REDEEM_RATE")) {
    return "This tier has no redemption rate set. Set one under Guests → Loyalty.";
  }
  if (message.startsWith("LOYALTY_NOTHING_OWED")) {
    return "There is nothing left to settle on this folio.";
  }
  if (message.startsWith("LOYALTY_POINTS_INVALID")) {
    return "Enter a whole number of points.";
  }
  if (message.startsWith("LOYALTY_REASON_REQUIRED")) {
    return "Give a reason for the correction.";
  }
  if (message.startsWith("LOYALTY_NO_TIERS")) {
    return "Set up at least one membership tier before enrolling guests.";
  }

  // Events and banquets (Module 10)
  if (message.startsWith("EVENT_SPACE_CLASH:")) {
    return `The hall is already taken — ${message.slice("EVENT_SPACE_CLASH:".length).trim()}. Choose another time, another day, or hold this one as an enquiry.`;
  }
  if (message.startsWith("EVENT_OVERPAYMENT:")) {
    return `More than is owed — ${message.slice("EVENT_OVERPAYMENT:".length).trim()}. Take the balance, or record the rest as a separate payment once the event is repriced.`;
  }
  if (message.startsWith("EVENT_NOT_FOUND")) {
    return "That event no longer exists. Refresh the page.";
  }
  if (message.startsWith("EVENT_NOT_QUOTED")) {
    return "Send a quotation first, so there is a price both sides have agreed.";
  }
  if (message.startsWith("EVENT_NOTHING_QUOTED")) {
    return "Price the hall, the catering or the equipment before sending a quotation.";
  }
  if (message.startsWith("EVENT_ALREADY_CONFIRMED")) {
    return "This event is past the quotation stage. Reprice it on a new event, or cancel this one.";
  }
  if (message.startsWith("EVENT_NEEDS_APPROVAL")) {
    return "This quotation is above the approval threshold. It needs a manager's approval before the date can be held.";
  }
  if (message.startsWith("EVENT_NO_APPROVAL_NEEDED")) {
    return "This quotation is below the approval threshold, so it can be confirmed as it stands.";
  }
  if (message.startsWith("EVENT_ALREADY_APPROVED")) {
    return "This quotation is already approved.";
  }
  if (message.startsWith("EVENT_SELF_APPROVAL")) {
    return "A quotation must be approved by someone other than the person who prepared it.";
  }
  if (message.startsWith("EVENT_ALREADY_BILLED")) {
    return "This event has already been billed, so its price cannot change. Cancel the bill first.";
  }
  if (message.startsWith("EVENT_INVOICED")) {
    return "This event has been invoiced. Cancel the invoice first.";
  }
  if (message.startsWith("EVENT_NOT_CONFIRMED")) {
    return "Confirm the event before billing it or closing it off.";
  }
  if (message.startsWith("EVENT_BOOKING_NOT_RESIDENT")) {
    return "An event can only be billed to a stay the guest has actually checked into.";
  }
  if (message.startsWith("EVENT_NO_BOOKING")) {
    return "Choose the stay to bill this event to.";
  }
  if (message.startsWith("EVENT_NOTHING_OWED")) {
    return "This event is already settled.";
  }
  if (message.startsWith("EVENT_CANCELLED")) {
    return "This event is cancelled. Only a refund can be recorded against it.";
  }
  if (message.startsWith("EVENT_ALREADY_CANCELLED")) {
    return "This event is already cancelled.";
  }
  if (message.startsWith("EVENT_CANCEL_REASON")) {
    return "Give a reason for cancelling.";
  }
  if (message.startsWith("EVENT_PAX_INVALID")) {
    return "Enter how many people actually attended.";
  }
  if (message.startsWith("EVENT_PAYMENT_KIND")) {
    return "Choose a deposit, a payment or a refund.";
  }
  if (message.startsWith("EVENT_PAYMENT_AMOUNT")) {
    return "Enter an amount greater than zero.";
  }
  if (message.includes("event_hold_covers_event")) {
    return "The hall has to be held from before the event starts until after it ends.";
  }
  if (message.includes("event_times_ordered")) {
    return "The event has to finish after it starts.";
  }
  if (message.includes("event_has_a_client")) {
    return "Say who the event is for: a guest, a company, or a contact name.";
  }

  if (/row-level security/i.test(message)) {
    return "Your role does not allow that change.";
  }
  if (/duplicate key/i.test(message)) {
    return "That already exists.";
  }
  return message;
}

export function isOverbooked(message: string | undefined | null) {
  return Boolean(message?.startsWith("OVERBOOKED:"));
}
