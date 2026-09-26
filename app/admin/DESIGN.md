# Admin panel design notes

The staff panel (everything under `app/admin`) has a light SaaS look:

- a white page
- white cards with a hairline border and a very faint shadow
- a soft brand green, used sparingly
- a near-black green for the primary action
- borderless tinted status pills

The public site has its own "Sand & Gold" theme and shares none of this.

Use this file when you move a page onto the new look, or when you add
search, filters or pagination to a list. In most cases the work is swapping
hand-written markup for the primitives in `components/ui.tsx`.

## How the theme works

The tokens live in the `.admin-theme` block of `app/globals.css`. Pages use
Tailwind's standard colour names, and that block redefines the variables
behind them. So a class such as `text-yellow-700` or `bg-emerald-100` inside
the admin gets the admin palette without renaming anything. Do not add a
`tailwind.config`, and do not hard-code hex values in pages. The one
exception is chart colours (see Charts).

| Tailwind name | Role | Key steps |
|---|---|---|
| `slate` (also `stone`, `gray`) | Neutrals | 50 `#F7F8F8` subtle fill · 100 `#F2F4F3` segmented track · 200 `#ECEEED` hairline · 400 section labels · 500 `#6F7371` muted text · 900 `#111412` ink |
| `yellow` | The accent, a soft green (the name is historic) | 50–200 mint tints · 700 `#2E7035` links |
| `emerald` (also `green`) | Success and charts | 50 `#F4FCF5` hero card · 100 `#EAF7EC` active nav, selected chip, success pill · 500 `#53AC58` brand · 900 `#1C2C1D` primary button |
| `lime` | Confirmed or arriving | 100 `#F5FCD0` pill · 400 `#DBF35D` swatch · 900 text |
| `amber` | Pending or warning, and the revenue line | 100 `#FEF5DA` pill · 600 `#C98F1B` line |
| `rose` (also `red`) | Error or cancelled | 100 tint · 500 `#D36C5F` · 800 text |
| `blue` / `orange` / `violet` | Info / no-show / waitlist | 100 tint · 800 text |

### Why the accent is called `yellow`

In the earlier gold theme the accent really was yellow, and about 180 links
across the panel are still written as `text-yellow-700` or
`text-yellow-800`. Keeping the name lets all of them turn green without
editing each page. New code can use either name.

### How to use green

Keep green sparing. Most of the UI should be white and grey. Use green only
for:

- the active nav item
- selected chips
- one hero `StatCard` per row
- success pills
- chart marks
- links

Colour rules:

- **Primary action:** `buttonClass`, near-black green with white text. Use it
  for one per view.
- **Secondary action:** `secondaryButtonClass`, white with a hairline border.
- **Links:** `text-emerald-700 hover:text-emerald-900`. Older pages write
  `text-yellow-700`, which renders the same.
- **Row hover:** `hover:bg-slate-50` (`tableRowClass`).
- **Keyboard focus:** a green outline, set globally. Inputs show their own
  soft green ring.

## Type

Inter carries everything. `fonts.ts` loads it for the admin only, and the
theme points `--font-admin-display` at the same font. I chose it by
rendering Inter, Geist, Plus Jakarta Sans and Public Sans against the
reference: Inter matched its letterforms, including the double-storey "a",
the flagged "1" and the proportions.

| Element | Style |
|---|---|
| `h1` (page title) | 26px, semibold, −0.025em tracking |
| `h2` (card title) | 16px, semibold |
| `h3` | 15px, semibold |
| `.admin-display` (KPI figures, the wordmark) | semibold, −0.03em tracking |
| `.admin-eyebrow` (small uppercase labels: sidebar groups, floor names, filter labels) | 10.5px, 0.09em tracking, `slate-400` |
| Body text | regular weight, `text-sm` |
| Muted text | `text-slate-500` |

The global rules set heading sizes, so a page doesn't need size classes on
`h1`, `h2` or `h3`. Tables and `.admin-display` get tabular figures
automatically.

## Motion

Keep motion small, and use CSS only (no animation library).

- **Route change:** `template.tsx` wraps each page in `.page-enter`, which in
  the admin fades it up by 6px over 240ms.
- **Hover and focus:** `transition-colors duration-150` on rows, chips,
  buttons and nav items. Clickable cards use `transition duration-200
  ease-out` with a slightly stronger border and shadow on hover. Never scale
  or bounce.
- **Sidebar:** one highlight element glides to the active item over 300ms
  (`NavList` in `Sidebar.tsx`).
- **Reduced motion:** the global `prefers-reduced-motion` rule turns all of
  it off, so you don't need to handle this per component.

## Shell

- **Sidebar** (`Sidebar.tsx`)
  - A white rail with grouped nav under `.admin-eyebrow` headings.
  - The active item has a mint highlight, with `emerald-800` text and an
    `emerald-600` icon.
  - `NAV` and the `allowed()` permission filter decide which items appear.
    This restyle didn't change them.
- **Top bar** (`TopBar.tsx`, desktop only)
  - **Breadcrumb:** the nav group and item, taken from `NAV`.
  - **Search box:** the Bookings search (or the Guests search for staff
    without booking access). It is a plain GET form, focused with ⌘K /
    Ctrl+K.
  - **Bell:** a link to the notification log, shown only to roles that can
    open it.
  - There is no help icon, because the app has no help section to link to.

## Components (`components/ui.tsx`)

| Primitive | Use |
|---|---|
| `PageHeader` | Page title, optional description and a right-aligned action |
| `Card` | Every boxed surface, including tables. Tables always sit inside a card |
| `SectionTitle` | An `h2` with an optional action |
| `StatCard` | A KPI tile. `highlight` makes it the mint hero card; `icon` adds a circle on the right. Use one hero per row and put the icon only on the hero |
| `StatusPill` | Booking status: tentative is amber, confirmed is lime, checked-in is green |
| `Tag` | Any other pill: tones `neutral`, `gold` (lime), `green`, `red`, `amber`, `blue`, `violet` |
| `Avatar` | Initials in a soft tint (the tint follows the name), beside the person a row is about: guest or staff |
| `Banner`, `Notice` | Inline messages |
| `EmptyState` | Centred muted line inside a card |
| `Field`, `Check` | A form label with hint, and a checkbox row |
| `inputClass`, `buttonClass`, `secondaryButtonClass`, `dangerButtonClass` | Class strings for form controls and buttons |
| `tableHeadClass`, `tableRowClass` | The table header row (white, muted labels, one hairline) and body rows |
| `SearchInput`, `FilterChips`, `Pagination` | List controls (see below) |

Every pill carries the `admin-pill` class, which drops its border. Add it to
any pill you write by hand.

## Adding search, filters and pagination to a list

Everything is driven by the URL and done in the server component. There is
no client state and no API route. `rooms/page.tsx` is the complete worked
example; `bookings/page.tsx` shows the same pieces on a simpler list.

### 1. Read the params

Read and sanitise the params, and fall back to defaults when they are
missing or invalid:

```ts
const params = await searchParams; // { q?, status?, page? }
const page = pageParam(params.page);
const status = STATUSES.includes(params.status) ? params.status : "all";
const term = (params.q ?? "").replace(/[%,()]/g, "").trim(); // commas and parentheses break .or()
```

### 2. Build the query

Apply the filters and the page range to the Supabase query itself:

```ts
let q = supabase.from("rooms").select("*", { count: "exact" })
  .order("room_number")
  .range(...pageRange(page));
if (status !== "all") q = q.eq("status", status);
if (term) q = q.or(`name.ilike.%${term}%,code.ilike.%${term}%`);
const { data, error, count } = await q;
```

- **Joined columns:** `.or()` cannot reach a column on a joined table.
  Resolve the matching ids with a separate query first, then add
  `col.in.(…)` to the `.or()`.
- **Headline figures:** if a count or total on the page was computed from
  the fetched rows, give it its own query before you add `.range()`.
  Otherwise it silently turns into a per-page figure.

### 3. Handle a stale page number

```ts
const listParams = { q: term, status: status === "all" ? null : status };
if (outOfRange(error)) redirect(pageHref("/admin/rooms", listParams, 1));
```

### 4. Render the controls

```tsx
<FilterChips path="/admin/rooms" param="status" current={status}
  params={{ q: term }} options={[{ value: "all", label: "All" }, …]} />
<SearchInput action="/admin/rooms" defaultValue={term}
  keep={{ status: status === "all" ? null : status }} />
…table…
<Pagination page={page} total={count ?? 0} path="/admin/rooms" params={listParams} />
```

- Put `Pagination` as the last child of the list's `Card`. It renders
  nothing when everything fits on one page.
- Each control carries the others' params (`params`, `keep`) and always
  drops `page`, so a new search or filter starts on page 1.
- The `"all"` option clears its param.

### 5. When a list is sorted or filtered in JS

Some lists can't page in the database, such as the maintenance open view
(sorted by urgency) and Events (filtered in JS). For those, load the full
list, slice it with `pageRange(clampPage(page, total))`, and pass
`total={list.length}`.

### When to add each control

- **Pagination:** when a list can plausibly grow past a screenful.
- **Search:** when rows have an obvious text field, such as a name, number or
  item.
- **Filter chips:** when there is a status, category or type column. Add
  counts when they come for free from data already loaded. A `swatch` lets
  the chips double as a colour legend.
- **None:** skip them on settings forms and on short fixed lists.

## Charts (`components/charts.tsx`, recharts)

- **Data:** charts are client components that take plain data props. The
  page fetches the data on the server.
- **Colours:** recharts writes colours as SVG attributes, which cannot read
  CSS variables. So the chart colours are hex constants, each named after the
  palette step it copies.
- **One axis per chart, never two.** The reference's "Occupancy & Revenue"
  chart used two y-scales. We draw it as two small multiples on a shared day
  axis, with a synced crosshair and tooltip.
- **Legends:** a chart with two or more series has a legend, and its panels
  carry labels. Every chart has a tooltip and a visually hidden (`sr-only`)
  data table.
- **Categorical palettes:** check them with the dataviz validator. Slice
  order matters: the room-status donut keeps the greens away from the red.

## Migrating a page

1. Wrap each table in a `<Card>`. Use `tableHeadClass` on the header row and
   `tableRowClass` on body rows.
2. Replace hand-rolled pills with `Tag` or `StatusPill`, or add `admin-pill`.
3. Add an `Avatar` beside a person's name when that person is the row's
   subject.
4. Replace hand-rolled search forms and chip rows with `SearchInput` and
   `FilterChips`, then add pagination as described above.
5. Change appearance only. Keep the copy, data and behaviour exactly as they
   are.
