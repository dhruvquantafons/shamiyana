# Hotel Shamiyana

The website and property management system (PMS) for **Hotel Shamiyana**, Srinagar.

- **Public website** (`/`): rooms, dining, gallery and a booking form with live availability and prices.
- **Guest portal** (`/account`): guests sign in to see their stays, pay a deposit, cancel, and keep their details current.
- **Admin panel** (`/admin`): reservations, front desk, rooms and rates, revenue, housekeeping, maintenance, outlets, events, HR, reporting and guest records for hotel staff.

Built to the *Hotel PMS Scope of Work* (18 modules). It runs one hotel out of the box and a group of them
without a rebuild.

---

## Contents

1. [Module status](#module-status)
2. [Quick start](#quick-start)
3. [Supabase setup](#supabase-setup)
4. [Environment variables](#environment-variables)
5. [Scripts and tests](#scripts-and-tests)
6. [Project structure](#project-structure)
7. [How it works](#how-it-works)
8. [Security](#security)
9. [Integration endpoints](#integration-endpoints)
10. [Deployment](#deployment)
11. [Before go-live](#before-go-live)
12. [Known gaps](#known-gaps)

---

## Module status

| # | Module | Status |
|---|---|---|
| 1 | Reservations & booking engine | ✅ Done |
| 2 | Front desk (check-in / check-out) | ✅ Done |
| 3 | Rooms, rates & inventory | ✅ Done |
| 4 | Revenue & dynamic pricing | ✅ Done |
| 5 | Housekeeping | ✅ Done |
| 6 | Point of sale | ✅ Done |
| 7 | Billing, invoicing, folio & payments | ✅ Done |
| 8 | Guest CRM & loyalty | ✅ Done |
| 9 | Channel manager / OTAs | ⬜ **Not started** |
| 10 | Banquets & events | ✅ Done |
| 11 | Maintenance / engineering | ✅ Done |
| 12 | HR & staff | ✅ Done |
| 13 | Reporting & analytics | ✅ Done |
| 14 | Multi-property / multi-brand | ✅ Done |
| 15 | Roles, permissions & administration | ✅ Done |
| 16 | Notifications | ✅ Done |
| 17 | Guest booking portal | ✅ Done |
| 18 | Mobile apps | ⛔ Excluded by the client |

**Module 9 is the only module left.** Much of its work is the hotel's rather than
ours: the Booking.com, Expedia and Agoda extranet accounts and their connectivity
credentials have to be arranged before the integration can be built or tested, and
that takes calendar time. Worth starting that conversation early.

Module 18 (mobile apps) is excluded from this project at the client's instruction.
Key staff screens already work on a phone browser.

Features the SOW itself marks optional are deliberately **not** built, since
Section 11 makes any addition a formal Change Request:

- the stock module in Module 6 (recipe and ingredient deduction)
- GDS connectivity in Module 9 ("optional/enterprise")
- WhatsApp and push notifications in Module 16 ("optional")
- competitor rate-shopping integration in Module 4 — manual entry is built instead
- biometric and access-control hooks, which stand down cleanly when unconfigured

---

## Quick start

```bash
npm install
cp .env.example .env.local   # add your Supabase keys
npm run dev
```

Open <http://localhost:3000>. The public site works without any keys. The admin panel shows a setup notice until Supabase is configured.

**Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Supabase (Postgres, Auth, Storage, Realtime).

> **Note:** this Next.js version differs from older ones. Read the guide in `node_modules/next/dist/docs/` before changing framework code (see `AGENTS.md`).

---

## Supabase setup

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. In the **SQL editor**, run every file in `supabase/migrations/` **in order**, one at a time.
3. Copy the project URL, anon key and service role key (**Project Settings → API**) into `.env.local`.
4. Add the first user under **Authentication → Users** with "Auto Confirm User" ticked. This first account becomes the administrator. Create everyone else from **Staff** in the admin panel.

| Migration | What it adds |
|---|---|
| `0001_init.sql` | Base schema, security policies, tariff |
| `0002_room_photos.sql` | Room photo storage |
| `0003_room_status_and_staff.sql` | Room occupancy, staff details |
| `0004_staff_roles.sql` | Manager and housekeeping roles |
| `0005_foundation.sql` | Roles & permissions, settings, audit log, sign-in tracking |
| `0006_rooms_and_rates.sql` | Room blocks, rate plans, seasons, restrictions, channel allocation, companies |
| `0007_reservations.sql` | Booking statuses, groups, room moves, folio, guest IDs, overbooking guard |
| `0008_front_desk.sql` | Registration cards, ID scans, guest requests, key cards, night audit, message log |
| `0009_housekeeping.sql` | Cleaning tasks, zones, checklist, inspections, DND, lost & found |
| `0010_housekeeping_sow_scope.sql` | Trims housekeeping to the SOW |
| `0011_maintenance.sql` | Tickets, photos, assets, preventive schedules, resolution targets |
| `0012_hr.sql` | HR profiles, shifts, roster, attendance, leave |
| `0013_guest_crm_and_admin.sql` | Guest profiles, feedback, merge & erase; message templates, languages, sessions |
| `0014_billing.sql` | Split folios, GST invoice numbering, gateway payments, refund approval |
| `0015_city_ledger_and_currency.sql` | City ledger (corporate A/R), exchange rates, foreign-currency settlement |
| `0016_loyalty.sql` | Loyalty tiers, points lots, redemption, expiry, tier history |
| `0017_pos.sql` | Outlets, menus, modifiers, bills, split/merge, charge to room, KOT |
| `0018_reports.sql` | Permission-checked report functions, KPI sources, scheduled reports |
| `0019_events.sql` | Event spaces, seating plans, per-head catering, quotations, approval, event billing |
| `0020_revenue.sql` | Pricing rules, approval queue, competitor rates, packages, promo codes |
| `0021_guest_portal.sql` | Guest accounts, self-service cancellation, portal settings |
| `0022_notifications.sql` | Pre-arrival, check-in, post-stay and receipt templates; notification log |
| `0023_guest_password_login.sql` | Password sign-in for the guest portal (staging only) |
| `0024_multi_property.sql` | Properties, per-property isolation, group settings, central dashboard |

Migrations upgrade an existing database in place; existing data is kept.

> **`0024` is not a routine migration — take a backup first.** It renames
> `property_settings` to `properties`, changes its primary key from a boolean
> singleton to a uuid, adds `property_id` to ~70 tables, and rewrites 22 unique
> keys to be per-property. It is written to be safe on a single-property database
> and is tested that way, but it is the one migration in this project worth
> being deliberate about.

---

## Environment variables

Set these in `.env.local` locally, and in **Vercel → Settings → Environment Variables** for Production and Preview.

| Variable | Needed | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes** | Public Supabase key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Server-only key: website bookings, staff accounts, feedback page. Never expose it to the browser. |
| `NEXT_PUBLIC_SITE_URL` | On staging | Where this deployment answers. Leave unset in production (defaults to the live domain). A staging deployment **must** set it, or emailed links point at the live site — and setting it to anything else also tells search engines not to index the deployment. |
| `TWO_FACTOR_MODE` | Before go-live | `demo` (default: every code is `123456`) or `totp` (real authenticator apps) |
| `DEMO_2FA_CODE` | No | The demo 2FA code (default `123456`) |
| `GUEST_PASSWORD_LOGIN` | Staging only | Offers a password as well as an emailed code on `/account`, so a team can test without each having an inbox the sender can reach. **Leave unset in production.** |
| `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL` | Optional | Guest and staff emails. Not what sends the portal sign-in code — that is Supabase Auth's own email. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Optional | SMS |
| `DOOR_LOCK_WEBHOOK_URL`, `DOOR_LOCK_API_KEY` | Optional | Electronic key cards |
| `ROOM_CONTROLS_SECRET` | Optional | Do Not Disturb from in-room controls |
| `CRON_SECRET` | Optional | Scheduled jobs: maintenance escalations, emailed reports, and guest messages (pre-arrival, check-in, post-stay) |
| `ATTENDANCE_API_SECRET` | Optional | Biometric attendance devices |
| `KOT_WEBHOOK_URL`, `KOT_API_KEY` | Optional | Kitchen display for outlet order tickets |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Optional | Online payment links |
| `RAZORPAY_WEBHOOK_SECRET` | With Razorpay | Signs the webhook. Without it no online payment reaches a folio |

Without an optional key, that feature is skipped. Email, SMS and key-card attempts are still logged as "skipped", so nothing breaks.

---

## Scripts and tests

```bash
npm run dev      # development server
npm run build    # production build
npm start        # serve the production build
npm run lint     # ESLint
npm test         # unit tests (pricing, tax, penalties, room assignment, passwords, HR, templates,
                 #             invoices, city-ledger aging, currency conversion, loyalty points,
                 #             POS lines, tax bands and charge-to-room rules,
                 #             hotel KPIs, GOPPAR and report date ranges,
                 #             pricing rules, promo codes and portal translations)
```

Database tests apply every migration to a throwaway local Postgres and check behaviour: overbooking,
permissions, housekeeping, maintenance, HR, guest records, invoice immutability, refund approval, city
ledger transfers and credit limits, loyalty earning, redemption and expiry, the POS bill lifecycle
(split and merge, charge to room, the outlet limit and points at the till), who may read which report,
guest portal access and cancellation, and property isolation.

```bash
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres supabase/tests/run.sh
```

**These are the tests that matter most.** Row-level security, `SECURITY DEFINER`
functions and trigger ordering cannot be checked by typecheck, lint or unit tests
— they only fail against a real Postgres. This suite has caught a privilege
escalation (every new guest login becoming front-desk staff), a promo discount
that never reached the folio, and — during Module 14 — reports and nightly jobs
that would have quietly operated on every hotel in the group at once.

Lines marked `EXPECT` in the output are deliberate refusals, not failures. What
you are checking is that the set of refusals has not changed.

---

## Project structure

```
proxy.ts                   Session refresh and /admin sign-in guard
supabase/migrations/       Database schema, security policies, triggers (run in order)
supabase/tests/            Database behaviour tests
tests/                     Unit tests

app/
├── (site)/                Public website pages
│   └── account/           Guest portal: sign in, bookings, pay, cancel, profile
├── feedback/[token]/      Guest feedback form (link in the final bill email)
├── api/                   Integration endpoints (see below)
├── lib/                   Shared logic: auth, permissions, pricing, tax, dates, HR,
│                          notifications, templates, integrations, invoices,
│                          city-ledger, currency, loyalty, pos, events, reports,
│                          revenue, guest-auth, guest-portal, portal-i18n, properties
└── admin/
    ├── *-actions.ts       Server actions, one file per area
    ├── login/, security/  Sign-in, 2FA, password
    └── (protected)/       Admin pages:
        dashboard, front-desk, bookings, guests (+ loyalty), groups, tape-chart,
        rooms, housekeeping, maintenance, pos (till, bills, menus), hr, rates,
        revenue (forecast, rules, approvals, competitors, packages, promos),
        events (diary, quotation, contract, event order, hall & packages),
        companies, reports, notifications, night-audit,
        billing (invoices, refunds, city-ledger, currencies), staff, roles,
        properties, settings, audit
```

---

## How it works

### Reservations and front desk
- **Booking statuses:** Tentative, Confirmed, Checked-In, Checked-Out, Cancelled, No-Show, Waitlisted.
- **Prices** are calculated as: base rate (or weekend rate) → season → rate plan → length-of-stay discount, plus extra adults. The agreed nightly prices are saved on the booking, so later rate changes don't affect it.
- **Overbooking is blocked by the database.** A manager can override it with a reason, which is logged.
- **Website bookings** show live availability and prices. The guest picks a rate plan and sends a request, which is held as *tentative* (or *waitlisted* if full) for the desk to confirm.
- **Check-in** needs an inspected room, government ID, a signed registration card and the deposit.
- **Check-out** settles the bill and can email it.
- **Night audit** posts the night's room charges, marks no-shows, retires expired loyalty points,
re-checks every member's tier, and moves the business date forward.

### Billing and invoicing
- **Folios:** every stay starts with one master bill. The desk can open more — "Company", "Extras" — and move charges between them, so one stay can be billed to more than one payer.
- **Tax invoices** are numbered `INV/2026-27/0001`: sequential per financial year, handed out by the database so two people issuing at once cannot collide, and never reused. An issued invoice cannot be edited or deleted — only cancelled, and the number stays spent.
- The invoice freezes its own lines, totals, rate-wise tax summary and the customer's name and GSTIN, so later changes to the guest record cannot alter a document already given out.
- **Online payments** use Razorpay payment links: the guest pays on Razorpay's page, so no card details reach this application. A folio is credited only when the signed webhook confirms the money arrived — never from the browser.
- **Refunds** at or above the configured threshold need a second person to approve, and never the person who asked. Approving pays out and posts the folio line in one step.

### Revenue and dynamic pricing
- **Rules raise or drop the rate on four triggers** — occupancy crossing a threshold, day of week,
a special event or holiday, and how far ahead the booking is. A rule's conditions are ANDed, so
"Fridays in December above 80% full" is one rule rather than three.
- **Nothing changes a live rate silently.** A proposal at or below the configured percentage is applied
automatically; anything larger waits for a manager under **Revenue → Approvals**. Re-running the engine
each morning reconciles against decisions already made, so an approved rate is not knocked back into the
queue overnight.
- **The build-up order is** base → season → dynamic adjustment → rate plan → length-of-stay → extras,
with a promo code coming off the finished total. A booking stores the nightly prices it was sold at, so
later rate movements never rewrite it.
- **A promo discount is spread back across the nights** rather than left as a total-level deduction.
Room charges bill from the stored nightly breakdown, so a discount that stayed at the top would be
invisible on the bill and the tax would be computed on a price nobody paid.
- **Redemption counting belongs to the database.** A trigger keeps a promo code's usage in step with the
bookings that used it, so a code with 50 uses cannot be oversold by the application forgetting to count.
- **Competitor rates are entered by hand.** The SOW makes rate-shopping integration optional, so the
screen records what somebody saw rather than calling a paid service.

### Guest booking portal
- **Guests sign in with a one-time code emailed to them**, never a password. That is not convenience: the
account is matched to stays made earlier by phone or at the desk, and those are matched on email address.
Without the address being proved on every sign-in, that matching would be a way to read a stranger's
booking history. It also means there is no password here to store, reset or leak.
- **The code's length belongs to the Supabase project** (6 to 10 digits), so nothing in the app assumes six.
- **A password option exists for staging only**, behind `GUEST_PASSWORD_LOGIN`. A password proves nothing
about an address, so a password session never inherits an existing guest profile — it always starts empty.
The check reads the authentication method from the signed token rather than anything the browser sends,
and is written as a deny-list so the one-time-code path cannot regress.
- **Guests read through row-level security but never write through it.** A select policy can scope rows;
it cannot stop a guest who may update their own booking from changing its dates or its status. So the one
thing a guest may change — cancelling — goes through a database function that works the penalty out from
the same rate-plan fields the desk uses, posts it to the folio, and writes only the columns a cancellation
should touch.
- **Their own profile is the same story.** Row-level security grants whole rows, and that row also carries
the VIP tag, the blacklist reason and the loyalty tier, so a whitelist function handles the handful of
fields a guest owns.
- **Paying online** uses a Razorpay hosted link, so no card data reaches this application.

### Notifications
- **Guest messages:** booking confirmation, pre-arrival reminder, check-in instructions, post-stay
thank-you with the feedback link, payment receipt, and a note when a booking is changed. The timing of the
three scheduled ones is configurable in days under **Settings**.
- **Staff alerts:** new booking, VIP arrival, maintenance ticket assigned, and tickets past their SLA.
Each is a toggle, because a hotel that is told everything stops reading any of it.
- **Every attempt is logged**, including ones skipped for want of an API key, so the history answers "was
anybody told?" rather than only "did it work?" — the question that matters when a VIP arrives unannounced.
Browse it under **Notifications**.
- **The scheduled messages are idempotent.** A partial unique index means a retrying scheduler cannot send
the same guest the same pre-arrival reminder twice.
- **Templates are editable per property and per language** with placeholders like `{GuestName}`, under
**Settings → Edit message templates**. WhatsApp and push notifications are optional in the SOW and are
not built.

### Multi-property
- **`properties` is the table that was `property_settings`.** Each hotel holds its own name, brand, tax
slabs, business date, check-in times and fee rules. A view still called `property_settings` shows *the
property this request is about*, which is why the many functions written as `from property_settings limit 1`
kept working and kept meaning the right thing.
- **The database decides which hotel, not the browser.** `current_property()` reads the signed-in staff
member's selection from their own row; every `property_id` column defaults to it. That default is why
almost no insert in the application had to change.
- **Separation is one restrictive policy per table.** Postgres ORs permissive policies together, so adding
"and it must be your property" as another permissive policy would have *widened* access. Restrictive
policies are ANDed instead. No existing policy was rewritten, so none could be broken by the change.
- **You work in one hotel at a time.** Even a group owner sees the hotel they have switched to — an
arrivals list, room board or tape chart with two hotels interleaved is unreadable and dangerous to act on.
Comparing hotels is what the group dashboard is for.
- **Natural keys are per-property.** Both hotels may have a room 101, a rate plan called BAR and an
invoice series that restarts each financial year. Twenty-two unique keys carry the property for that reason.
- **Child records follow their parent, not the open screen.** A trigger takes a folio entry's property from
its booking. This matters for the webhook and the nightly jobs, which run as the service role and are not
subject to row-level security at all.
- **Head office pushes standards down.** Brand wording, loyalty rules and the tax template are held once
and copied into the properties chosen. A copy rather than a link, because a hotel can still adjust locally
afterwards — which is what a standard is, as opposed to a lock.
- **The central dashboard** compares occupancy, ADR, RevPAR and revenue side by side. No group ADR is
shown: averaging averages across hotels of different sizes gives a number that means nothing.
- **Central reservation** shows rooms free at every hotel on the chosen dates from the new-booking screen.
Picking one moves the desk there; the booking is then made by the same availability rules, rate plans and
overbooking checks as any other.

### Housekeeping
- Check-outs create cleaning tasks automatically. Tasks are assigned by floor zone and workload, skipping staff on leave or rostered off.
- Status flow: **Dirty → Cleaning → Clean → Inspected**. Only inspected rooms can be checked into.
- Also included: a linen/amenities/minibar checklist, turnaround targets, deep-clean schedule, Do Not Disturb, and lost & found.

### Outlets (point of sale)
- **Seven outlet types** are set up out of the box: restaurant, bar, spa, gift shop, mini-bar, room service and
laundry. Each keeps its own menu, prices, tax rate and service charge.
- **Tax** is set on the outlet and can be overridden per category or per item, so one restaurant charges 5% on
food and 18% on a beer. The effective rate is shown on every menu row.
- **An order is the bill.** Splitting moves lines onto a second bill; merging moves them back and voids the empty
one — the same idea as moving a charge between folios.
- **Charge to room** posts to the guest's folio, one line per tax rate so the tax invoice's rate-wise summary stays
correct. It is refused unless the guest is checked in, and it respects both the property's outlet limit per stay
and, on a company-billed folio, that company's credit limit.
- **Paying at the outlet:** cash, card, UPI, or loyalty points at the guest's tier rate.
- **Kitchen tickets** mark each line as fired once, print from the browser, and can also be posted to a kitchen
display with `KOT_WEBHOOK_URL`. POS hardware is the hotel's to buy (SOW §2.2); this integrates with it.
- **Prices and tax are frozen onto every line** when it is ordered, so re-pricing the menu never rewrites a bill
that has already been served.
- Night audit totals the outlet takings, because a bill settled with cash never touches a folio and would
otherwise be missing from the day's revenue.

### Events and banquets
- **One hall, sold several ways.** The hall is a record rather than a constant, carrying its name, floor, area,
full-day, half-day and hourly rates, its minimum charge, and how long it is held either side of a function for
dressing and clearing. Each seating plan (theatre, banquet rounds, classroom, U-shape, boardroom, cluster) carries
its own capacity, and the screen warns when a plan is too small for the head count. Equipment can be tied to a
space or left to travel between rooms, and only what serves the chosen space is offered.
- **Catering is quoted per head**, which is how banquet business is actually priced, and the packages are kept
separate from the restaurant menus. What each package includes prints on the quotation, one line per entry.
- **The billed head count is the guarantee or the turnout, whichever is higher.** A client who guarantees 100 and
brings 60 pays for 100; one who brings 120 pays for 120. Closing the event off on the real number reprices the
catering.
- **The hall and the food are taxed at their own rates.** In India hall rental is 18% and banquet catering is
usually 5%, so one function's bill carries more than one rate. `event_tax_bands()` is the single definition of that
split and is used by the quotation, the invoice and the GST tax summary alike, so the three cannot disagree.
- **Only a confirmed function holds the hall.** Two enquiries for the same Saturday are ordinary business — the
hotel quotes several and wins one — so they may overlap and the diary shows them side by side with the days worth
a telephone call. Confirming a second function over a confirmed one is refused.
- **A quotation at or above a configurable value needs a second person's approval**, and whoever prepared it may
not approve it. Repricing a quotation withdraws its approval. Below the threshold no approval is needed at all.
The SOW puts this with the sales manager, so the **Sales & Marketing** role holds `events.approve` — banquet
business is sold, not taken at the desk.
- **Payment terms are recorded on the booking** and print on the quotation and the contract. A corporate client's
own account terms are filled in by default rather than typed again.
- **Three documents** print from the same figures: the **quotation** for the client, the **contract** with the
hotel's own terms and both signatures, and the **banquet event order** for the kitchen, the stewards and the
technicians — which deliberately carries no prices.
- **Billing is the main billing module, not a second one.** An event is settled in one of three ways: posted to a
resident guest's folio (a residential conference, one bill with the rooms), charged to a company on the city ledger
(where it ages and is chased with their other debt), or invoiced from the property's own GST invoice series — the
same run of numbers a room invoice takes, because the tax law wants one series for the whole business.
- **Once an event has been billed its price is fixed.** Changing the head count, the package, the hall charge or
the discount is refused, for the same reason an issued invoice cannot be edited.
- Event revenue is reported on its own under **Reports → Financial**, not folded into occupancy, ADR or RevPAR —
a function is not a room night, and mixing them would spoil all three.

### Maintenance
- Any staff member can raise a ticket for a room, an asset or a place, with photos.
- Priorities are Low, Medium, High and Urgent. Urgent tickets alert the engineering supervisor.
- A ticket can take a room out of order. Resolving the ticket returns the room to sale, marked dirty for housekeeping.
- Each priority has a resolution target; tickets past it are escalated. Assets keep their own history, and preventive schedules raise tickets when due.

### HR
- **Staff profiles:** employee ID, department, shift pattern.
- **Roster:** a weekly grid of shifts.
- **Attendance:** self clock-in (optionally only on site), manual entry by HR, or biometric devices.
- **Leave:** requests and approval.
- **Performance:** summary per staff member.
- **Payroll export:** CSV for payroll software.

### Guests
- **Profiles:** stay history, total spend, preferences, birthday and anniversary.
- **Tags:** VIP and Blacklisted (warned at booking and check-in). Repeat Guest and Corporate are added automatically.
- **Feedback:** requested with the final bill email.
- **Housekeeping of records:** duplicate merging, plus data export and erasure for privacy requests.

### Loyalty
- **Points are held as lots.** Each earning carries its own expiry date and how much of it is left. A
redemption eats the oldest lot first and expiry retires whatever is unused when a lot's date passes — so
the desk can always say which stay a point came from and when it dies, which a single running total
cannot.
- **Earning** happens automatically when an invoice is issued, at the earn rate of the tier the guest
held at the time, on the **taxable value** only: tax collected for the government is not spend with the
hotel. A company-billed invoice earns the company nothing for the guest, and reprinting an invoice never
earns twice.
- **Redeeming** posts a payment to the folio, so points settle a bill exactly as cash does. A redemption
can never exceed the balance, the property's minimum, or what is actually owed.
- **Tiers** (Silver, Gold, Platinum by default, all editable) need both the nights *and* the spend of a
rolling twelve months. Night audit re-checks every member and records each move with its reason.
- Erasing a guest's data removes the membership and its points history; the folio lines a redemption
produced are financial record and stay.

### Reports
- **Core KPIs** for any period: occupancy, ADR, RevPAR, GOPPAR, total revenue, outstanding balance, cancellation
rate and no-show rate. ADR divides by rooms *sold* and RevPAR by rooms *available* — that difference is why a
hotel quotes both.
- **Figures from a closed night audit never change.** Each day's row says whether it came from the stored audit
snapshot or was computed live, so a stay amended in March cannot silently rewrite January's revenue. That is what
makes the same report for the same dates give the same answer every time.
- **Financial reports** — daily revenue, tax summary by rate, payments and refunds, outlet-wise sales, outlet
settlement, and money owed — are restricted to management and finance. The restriction is enforced by the database
functions themselves, not just hidden in the interface, so it holds for the screen, the CSV export and the
scheduler alike.
- **Operational reports:** housekeeping performance per attendant, maintenance turnaround against SLA by priority,
and staff attendance against the roster.
- **Guest reports:** repeat guest ratio, feedback scores by category, and loyalty performance including how much
of the outstanding points liability guests are actually redeeming.
- **Build a report** from any of the above over a chosen period, then export to CSV (which Excel opens) or print
to PDF. It is a chooser over reports the system knows how to produce rather than an open query tool: every report
carries its own access rule, and the front desk should not be able to write SQL against the folio.
- **Scheduled email reports** go out daily, weekly on Monday, or monthly on the 1st — always covering a period
that has finished. A schedule already sent today is skipped, so a retrying scheduler cannot email the owner twice.
- **GOPPAR** needs the hotel's running cost, which this system does not hold: it has no expense ledger, and the
SOW leaves accounting to the hotel's own software. Enter a monthly figure under Settings and it is prorated across
the days reported; leave it at zero and GOPPAR is simply not reported rather than reported wrongly.

### Administration
- **Roles:** twelve built-in, all editable, and you can add your own. Permissions are set per module and
action — including the city ledger, loyalty enrolment, corrections and redemption, and the outlets (taking orders,
settling bills and managing menus are separate permissions), and reports (operational, financial and scheduling
are separate).
- **Audit log:** every change, with before/after values. Entries cannot be edited or deleted. Adding a hotel,
changing the group's standards and moving somebody between hotels are all logged — they are changes of access,
which is what the trail is for.
- **Message templates:** editable per property and per language with placeholders like `{GuestName}`, under
**Settings → Edit message templates**.
- **Activity & sessions:** see who is signed in and end someone's sessions, under **Staff → Activity & sessions**.
- **Properties:** compare hotels, add one, and push group standards, under **Properties**. Hidden for a
single-hotel installation, which is what every installation starts as.

---

## Security

Access is checked in three layers:
1. `proxy.ts` sends signed-out visitors to the login page.
2. Every page and server action checks the specific permission.
3. Database row-level security checks it again as the final safeguard.

A fourth applies once there is more than one hotel: a **restrictive** policy on every table holds reads and
writes to the property the person is working in. It is ANDed with the layers above rather than ORed with them,
so a page that forgets to filter shows too little, never too much.

Other protections:
- **2FA** for administrator and finance roles. Anyone can opt in.
- **Passwords:** complexity rules, expiry, and lockout after repeated failures.
- **Auto sign-out** after a period of inactivity.
- **ID scans** are private. Only authorised roles can view them, each view is logged, and scans are deleted after the retention period.
- **A guest login is not a staff login.** `has_permission()` reads the staff table and answers false for a
guest, so every policy refuses them by default; what a guest may see is granted explicitly and narrowly. The
sign-up trigger creates a staff row only to bootstrap an empty project, and browser-supplied metadata is only
ever read to *decline* that — never to grant it.

**Two things worth knowing before changing database code.** A `SECURITY DEFINER` function runs as its owner
and is therefore *not* subject to row-level security, so any such function that scans a whole table needs its
property filter written in by hand. And the service role bypasses row-level security entirely, which is why
child records get their property from a trigger rather than from a column default.

---

## Integration endpoints

| Endpoint | Used by | Auth |
|---|---|---|
| `POST /api/room-controls` | In-room controls (Do Not Disturb) | `Bearer ROOM_CONTROLS_SECRET` |
| `POST /api/attendance` | Biometric attendance devices | `Bearer ATTENDANCE_API_SECRET` |
| `GET /api/cron/maintenance` | Scheduler, every 15–30 min (e.g. Vercel Cron) | `Bearer CRON_SECRET` |
| `GET /api/cron/reports` | Scheduler, once each morning | `Bearer CRON_SECRET` |
| `GET /api/cron/notifications` | Scheduler, once each morning | `Bearer CRON_SECRET` |
| `POST /api/payments/razorpay/webhook` | Razorpay | `X-Razorpay-Signature` (HMAC, `RAZORPAY_WEBHOOK_SECRET`) |

Each endpoint is disabled until its secret is set. Request formats are documented at the top of each route file.

---

## Deployment

The site is deployed on **Vercel** from `master`. Every pull request gets its own preview deployment.

1. Run any new migrations in Supabase **before** merging.
2. Check the pull request's Vercel preview.
3. Merge to `master`; production deploys automatically.

**Scheduled jobs** are declared in `vercel.json`: report emails at 02:00 UTC (07:30 IST), the maintenance sweep
half an hour later, and guest messages at 03:00 UTC. All three need `CRON_SECRET`; Vercel sends it as a bearer
token automatically. The schedules are daily so they work on any Vercel plan — on Pro you can tighten the
maintenance sweep to `*/30 * * * *`, which is what its SLA escalation is really designed for. Night audit and the
maintenance board do the same work, so a daily sweep is a backstop rather than the only path.

> The Hobby plan caps the number of cron jobs. If a deploy complains about three,
> merge them into one endpoint that calls all three in turn rather than dropping one.

Cron requests carry no staff session, so the jobs walk **every active property** explicitly. Relying on the
default property would leave the group's other hotels with no escalations and no preventive work raised —
with no error to show for it.

**Vercel Cron only runs on production deployments**, so a preview URL will never fire these. Test them by
calling the endpoint yourself with the bearer token.

**`NEXT_PUBLIC_SUPABASE_URL` is read at build time** by `next.config.ts`, to put the Storage host on
`next/image`'s allow-list. If you add or change it after a deployment, redeploy — room photos will 404 until you
do.

**The canonical site address** is `PRODUCTION_URL` in `app/lib/site.ts`, overridden per deployment by
`NEXT_PUBLIC_SITE_URL`. The sitemap, `robots.txt` and every emailed link use it. A deployment whose address is
not the live domain also serves a `robots.txt` that disallows everything, so a staging copy of the hotel cannot
turn up in search results.

---

## Before go-live

- [ ] Switch 2FA to real mode: `TWO_FACTOR_MODE=totp`
- [ ] **Remove `GUEST_PASSWORD_LOGIN` from the production environment**, leaving the emailed
      one-time code as the only way into a guest account. It is off unless set, so simply not
      setting it in Production is enough
- [ ] **Leave `NEXT_PUBLIC_SITE_URL` unset in production**, and set it on every staging deployment
- [ ] Verify the hotel's domain in Resend and switch `NOTIFY_FROM_EMAIL` to a real address;
      `onboarding@resend.dev` only delivers to the Resend account owner
- [ ] Add `{{ .Token }}` to the Supabase **Magic Link** email template, or the portal sign-in code
      never reaches the guest. Set the OTP length under **Authentication** while you are there
- [ ] Review the pricing rules and the automatic-approval percentage under **Revenue** before the
      engine is allowed to move live rates; it ships with the threshold at 10%
- [ ] Decide the pre-arrival, check-in and post-stay message timings under **Settings**, and read
      each template through as the guest will receive it
- [ ] Swap Razorpay test keys for live keys, and re-point the webhook at the live site
- [ ] Confirm the invoice prefix and GSTIN with the hotel's accountant before the first invoice is issued
- [ ] Set real exchange rates under **Billing → Currencies** before turning multi-currency on; the seeded
      rates are indicative only
- [ ] Agree the loyalty earn and redemption rates, tier thresholds and points expiry with the owner, then
      turn the programme on under **Guests → Loyalty** (it ships switched off)
- [ ] Set each corporate client's credit limit and payment terms under **Companies**, or the city ledger
      will let an account run up without limit
- [ ] Confirm which outlets the hotel actually runs and close the rest under **Point of sale → Outlets &
      menus**; all seven ship set up, with only the restaurant, mini-bar, room service and laundry open
- [ ] Confirm every outlet's tax rate and service charge with the accountant, and load the real menus and prices
- [ ] Decide the outlet charge limit per stay under **Settings** (it ships at no limit)
- [ ] Set the hall's real rates, its floor, its seating-plan capacities, the per-head catering prices and the
      equipment hire charges under **Events & banquets → Hall & packages**; everything seeded there is a
      placeholder and the setup page says so until it is changed
- [ ] Decide who approves banquet quotations. **Sales & Marketing** and the **General Manager** hold the
      approval out of the box; give it to whoever actually sells functions
- [ ] Confirm the hall's and the catering's tax rates with the accountant — they are not the same rate
- [ ] Agree the quotation approval threshold, the service charge and the deposit percentage under
      **Settings → Events & banquets**, and write the hotel's function contract terms there
- [ ] Enter the monthly operating cost under **Settings** if the owner wants GOPPAR reported
- [ ] Point a daily scheduler at `/api/cron/reports` and set up who receives which report
- [ ] If the group runs more than one hotel: add each under **Properties**, assign every staff
      member to one, and reserve the head-office tick for people who genuinely need every hotel.
      Confirm which property the public website sells — only one can
- [ ] Add the email and SMS keys, then send a test message
- [ ] Connect door locks, if used, and test with the vendor
- [ ] Confirm the Supabase data region is acceptable to the hotel, and name it in the privacy policy
- [ ] Give every staff member their own login (no shared accounts)
- [ ] Remove or confirm the unverified website content below

**Unverified website content** that the owner has not confirmed:
- the footer awards bar
- the street address in `Footer.tsx`
- the "Palace & Resort" branding
- the Dining and Experiences sections, which use stock photos
- the legal pages, which are a first draft for the owner to review

---

## Known gaps

1. **Reports:** there is no expense ledger, so GOPPAR relies on a monthly operating cost entered by hand.
2. **POS stock:** recipe and ingredient deduction is out of scope (optional in the SOW), so the outlets sell
   without tracking stock.
3. **Tax summary and cash outlet bills:** the GST tax summary reads folio charges and event bills. An outlet bill
   settled with cash never touches a folio, so its tax is not in that report — night audit totals the outlet
   takings separately. Worth closing before the first GST return is filed from this system.
4. **OTA channels:** the room allocation for each channel is stored, but only the website enforces it until the
   channel manager exists (Module 9).
5. **The public website sells one property.** Multi-property is complete on the staff side, but the website has
   one address and one tariff page, so one property is marked as the one it sells. Selling several from one site
   would be a larger piece of work than Module 14 asks for.
6. **Competitor rates are entered by hand** — the SOW marks rate-shopping integration optional.
7. **Guest profiles are per property.** The SOW requires each property's guest data to be logically separated, so
   a guest who stays at two hotels in the group has a profile at each. Loyalty *rules* are pushed from head
   office, but the points are earned per property.
8. **The staff panel is English only.** Languages apply to guest messages and the guest portal.
9. **Room rates:** the Royal and Presidential Suites need rates from the owner before they can be added under **Rates**.
10. **Equipment is not held against a date.** How many of each item the hotel owns is shown to whoever is quoting,
    but with one hall two functions cannot overlap anyway, so no conflict check is enforced.
11. **One lint warning:** `<img>` in the homepage hero.

**Room rates** are managed under **Admin → Rates**. The published tariff is also kept in `app/lib/rates-fallback.ts` as a fallback for the website; keep the two in step.
