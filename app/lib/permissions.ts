/**
 * Every permission a role can hold, grouped by module (SOW Module 15:
 * "configurable at the module and action level").
 *
 * The keys are also referenced by row level security policies in
 * supabase/migrations, so renaming one means changing it there too.
 */

export const PERMISSION_GROUPS = [
  {
    module: "Dashboard",
    permissions: [{ key: "dashboard.view", label: "View the dashboard" }],
  },
  {
    module: "Reservations",
    permissions: [
      { key: "bookings.view", label: "View bookings" },
      { key: "bookings.create", label: "Create bookings" },
      { key: "bookings.edit", label: "Change dates, rooms and rates" },
      { key: "bookings.cancel", label: "Cancel and mark no-show" },
      { key: "bookings.waive_penalty", label: "Waive cancellation penalties" },
      { key: "bookings.overbook", label: "Override overbooking" },
      { key: "bookings.groups", label: "Group bookings" },
    ],
  },
  {
    module: "Front desk",
    permissions: [
      { key: "frontdesk.view", label: "View arrivals, departures and in-house" },
      { key: "frontdesk.checkin", label: "Check guests in" },
      { key: "frontdesk.checkout", label: "Check guests out" },
      { key: "frontdesk.night_audit", label: "Run night audit" },
      { key: "frontdesk.requests", label: "Log and complete guest requests" },
    ],
  },
  {
    module: "Guests",
    permissions: [
      { key: "guests.view", label: "View guest profiles" },
      { key: "guests.edit", label: "Edit guest profiles" },
      { key: "guests.view_id", label: "View identity documents" },
      { key: "guests.privacy", label: "Merge duplicates, export and erase guest data" },
      { key: "companies.manage", label: "Manage corporate accounts" },
      { key: "loyalty.manage", label: "Loyalty programme: tiers, enrolment and corrections" },
      { key: "loyalty.redeem", label: "Redeem loyalty points against a bill" },
    ],
  },
  {
    module: "Folio & payments",
    permissions: [
      { key: "folio.view", label: "View folios" },
      { key: "folio.post", label: "Post charges" },
      { key: "folio.payment", label: "Take payments and refunds" },
      { key: "folio.adjust", label: "Adjustments and voids" },
      { key: "folio.invoice", label: "Issue and cancel tax invoices" },
      { key: "folio.refund_approve", label: "Approve refunds" },
      { key: "folio.city_ledger", label: "City ledger: bill companies and record receipts" },
    ],
  },
  {
    module: "Point of sale",
    permissions: [
      { key: "pos.view", label: "View outlets, bills and takings" },
      { key: "pos.order", label: "Open bills and take orders" },
      { key: "pos.pay", label: "Settle bills and charge to a room" },
      { key: "pos.manage", label: "Manage outlets, menus, prices and void bills" },
    ],
  },
  {
    module: "Events & banquets",
    permissions: [
      { key: "events.view", label: "View the events diary and event orders" },
      { key: "events.book", label: "Take enquiries, confirm and cancel events" },
      { key: "events.quote", label: "Prepare and send quotations" },
      { key: "events.approve", label: "Approve quotations above the threshold" },
      { key: "events.bill", label: "Take deposits and bill events" },
      { key: "events.manage", label: "Manage spaces, layouts, catering packages and equipment" },
    ],
  },
  {
    module: "Rooms",
    permissions: [
      { key: "rooms.view", label: "View the room board" },
      { key: "rooms.status", label: "Change room and housekeeping status" },
      { key: "rooms.block", label: "Block rooms (out of order / service)" },
      { key: "rooms.manage", label: "Add, edit and remove rooms" },
    ],
  },
  {
    module: "Housekeeping",
    permissions: [
      { key: "housekeeping.tasks", label: "Work cleaning tasks" },
      { key: "housekeeping.inspect", label: "Inspect and approve rooms" },
      { key: "housekeeping.assign", label: "Assign tasks, zones and checklists" },
      { key: "housekeeping.lost_found", label: "Lost & found" },
    ],
  },
  {
    module: "Maintenance",
    permissions: [
      { key: "maintenance.report", label: "Report problems (raise tickets)" },
      { key: "maintenance.work", label: "Work maintenance tickets" },
      { key: "maintenance.manage", label: "Assign tickets, assets, preventive schedules and targets" },
    ],
  },
  {
    module: "HR",
    permissions: [
      { key: "hr.view", label: "View rosters, attendance and staff profiles" },
      { key: "hr.manage", label: "Edit profiles, rosters, attendance and shift setup" },
      { key: "hr.approve_leave", label: "Approve leave requests" },
      { key: "hr.export", label: "Export payroll data" },
    ],
  },
  {
    module: "Rates",
    permissions: [
      { key: "rates.view", label: "View rates and plans" },
      { key: "rates.manage", label: "Change rates, plans, seasons, restrictions and packages" },
    ],
  },
  {
    module: "Revenue",
    permissions: [
      { key: "revenue.view", label: "View the forecast, pricing rules and competitor rates" },
      { key: "revenue.manage", label: "Set pricing rules, promo codes and competitor rates" },
      { key: "revenue.approve", label: "Approve rate changes above the automatic threshold" },
    ],
  },
  {
    module: "Reports",
    permissions: [
      { key: "reports.view", label: "Operational and guest reports" },
      { key: "reports.financial", label: "Financial reports: revenue, tax, outlet sales, money owed" },
      { key: "reports.schedule", label: "Set up scheduled email reports" },
    ],
  },
  {
    module: "Properties",
    permissions: [
      { key: "properties.view", label: "Compare properties across the group" },
      { key: "properties.manage", label: "Add properties and push group standards" },
    ],
  },
  {
    module: "Administration",
    permissions: [
      { key: "staff.manage", label: "Manage staff accounts" },
      { key: "roles.manage", label: "Manage roles and permissions" },
      { key: "settings.manage", label: "Change property settings" },
      { key: "audit.view", label: "View the audit log" },
    ],
  },
] as const;

export type Permission = (typeof PERMISSION_GROUPS)[number]["permissions"][number]["key"];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p.key),
);

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as string[]).includes(value);
}

/** What the app needs to decide access for the signed-in person. */
export interface Access {
  isSuperuser: boolean;
  permissions: ReadonlySet<string>;
}

export function can(access: Access, permission: Permission) {
  return access.isSuperuser || access.permissions.has(permission);
}

export function canAny(access: Access, permissions: Permission[]) {
  return permissions.some((p) => can(access, p));
}
