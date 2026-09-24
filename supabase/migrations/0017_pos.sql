-- ============================================================================
-- Module 6 — Point of Sale: Restaurant, Bar, Spa, Gift Shop, Mini-Bar,
--                           Room Service and Laundry
--
--   • Each outlet keeps its own menu, prices and tax treatment. Tax can be set
--     on the outlet and overridden per category or per item, which is what the
--     SOW's "multiple tax types applied per outlet or item category" asks for.
--   • An order *is* the bill. Splitting a bill moves lines onto a second
--     order; merging moves them back and voids the empty one — the same shape
--     as moving a charge between folios in Module 7, so there is one idea to
--     learn rather than two.
--   • "Charge to Room" posts to the guest's folio, one entry per tax rate so
--     the GST rate-wise summary on the invoice stays correct. It is refused
--     unless the guest is actually checked in, and it respects both the
--     property's room-charge limit and, on a company-billed folio, the
--     company's credit limit (SOW "Charge-to-Room Validation").
--   • Loyalty points may settle a bill, reusing the lot consumption built for
--     Module 8.
--
-- The stock module (recipe and ingredient deduction) is marked optional in the
-- SOW and is deliberately not built.
--
-- Run after 0016_loyalty.sql.
-- ============================================================================

-- ── Permissions ─────────────────────────────────────────────────────────────

insert into role_permissions (role_key, permission)
select r, p from (values
  ('pos_cashier', 'pos.view'), ('pos_cashier', 'pos.order'), ('pos_cashier', 'pos.pay'),
  ('manager', 'pos.view'), ('manager', 'pos.order'), ('manager', 'pos.pay'), ('manager', 'pos.manage'),
  ('front_office_manager', 'pos.view'), ('front_office_manager', 'pos.order'),
  ('front_office_manager', 'pos.pay'),
  ('front_desk', 'pos.view'), ('front_desk', 'pos.order'), ('front_desk', 'pos.pay'),
  ('finance', 'pos.view'), ('finance', 'pos.manage')
) as seed (r, p)
where exists (select 1 from roles where key = seed.r)
on conflict do nothing;

-- ── Settings ────────────────────────────────────────────────────────────────

-- The most an unpaid outlet balance may reach on one stay before the desk has
-- to take payment. Zero means no limit (SOW "Charge-to-Room Validation").
alter table property_settings add column if not exists pos_room_charge_limit numeric(12,2) not null default 0
  check (pos_room_charge_limit >= 0);

-- ── Outlets ─────────────────────────────────────────────────────────────────

create table if not exists pos_outlets (
  id            uuid primary key default gen_random_uuid(),
  -- Short code, used to build order numbers: RST/000123.
  code          text not null unique check (code ~ '^[A-Z0-9]{2,6}$'),
  name          text not null check (length(trim(name)) > 0),
  -- The seven outlet types the SOW names.
  kind          text not null check (kind in (
                  'restaurant', 'bar', 'spa', 'gift_shop', 'mini_bar', 'room_service', 'laundry')),
  -- Default tax for this outlet's items. A category or item may override it.
  tax_rate      numeric(5,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  -- Whether the menu prices already include that tax.
  tax_inclusive boolean not null default false,
  -- Added to every bill as a taxable line, at the outlet's own tax rate.
  service_charge_percent numeric(5,2) not null default 0
                  check (service_charge_percent >= 0 and service_charge_percent <= 100),
  -- Guides the order screen: a table number, a room, or either.
  orders_by     text not null default 'either' check (orders_by in ('table', 'room', 'either')),
  -- Whether a kitchen ticket is meaningful here.
  sends_kot     boolean not null default false,
  is_active     boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- All seven, so the property can switch on whichever it actually runs. Tax
-- rates are India's usual treatment and must be confirmed with the hotel's
-- accountant before the first bill.
insert into pos_outlets (code, name, kind, tax_rate, service_charge_percent, orders_by, sends_kot, is_active, sort_order) values
  ('RST', 'Shamiyana Restaurant', 'restaurant',   5, 10, 'either', true,  true,  1),
  ('BAR', 'Bar',              'bar',         18, 10, 'either', true,  false, 2),
  ('SPA', 'Spa & Wellness',   'spa',         18,  0, 'either', false, false, 3),
  ('SHP', 'Gift Shop',        'gift_shop',   12,  0, 'either', false, false, 4),
  ('MIN', 'Mini-Bar',         'mini_bar',    18,  0, 'room',   false, true,  5),
  ('RMS', 'Room Service',     'room_service',  5, 10, 'room',   true,  true,  6),
  ('LDY', 'Laundry',          'laundry',     18,  0, 'room',   false, true,  7)
on conflict (code) do nothing;

-- ── Menu ────────────────────────────────────────────────────────────────────

create table if not exists pos_categories (
  id         uuid primary key default gen_random_uuid(),
  outlet_id  uuid not null references pos_outlets on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  -- Null inherits the outlet's rate.
  tax_rate   numeric(5,2) check (tax_rate >= 0 and tax_rate <= 100),
  is_active  boolean not null default true,
  sort_order int not null default 0
);

create index if not exists pos_categories_outlet_idx on pos_categories (outlet_id, sort_order);
create unique index if not exists pos_categories_name_idx on pos_categories (outlet_id, lower(name));

create table if not exists pos_items (
  id          uuid primary key default gen_random_uuid(),
  outlet_id   uuid not null references pos_outlets on delete cascade,
  category_id uuid references pos_categories on delete set null,
  code        text not null default '',
  name        text not null check (length(trim(name)) > 0),
  description text not null default '',
  price       numeric(12,2) not null check (price >= 0),
  -- Null inherits the category's rate, then the outlet's.
  tax_rate    numeric(5,2) check (tax_rate >= 0 and tax_rate <= 100),
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists pos_items_outlet_idx on pos_items (outlet_id, sort_order);
create unique index if not exists pos_items_name_idx on pos_items (outlet_id, lower(name));

-- Modifiers belong to the outlet so one "No ice" serves every drink on the
-- menu, and are attached to the items they may be used on.
create table if not exists pos_modifiers (
  id          uuid primary key default gen_random_uuid(),
  outlet_id   uuid not null references pos_outlets on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  price_delta numeric(12,2) not null default 0,
  is_active   boolean not null default true,
  sort_order  int not null default 0
);

create unique index if not exists pos_modifiers_name_idx on pos_modifiers (outlet_id, lower(name));

create table if not exists pos_item_modifiers (
  item_id     uuid not null references pos_items on delete cascade,
  modifier_id uuid not null references pos_modifiers on delete cascade,
  primary key (item_id, modifier_id)
);

-- The rate an item is taxed at: its own, else its category's, else the
-- outlet's. Kept in one place so the order screen and the bill never disagree.
create or replace function pos_item_tax_rate(p_item uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(i.tax_rate, c.tax_rate, o.tax_rate, 0)
    from pos_items i
    join pos_outlets o on o.id = i.outlet_id
    left join pos_categories c on c.id = i.category_id
   where i.id = p_item;
$$;

-- ── Orders ──────────────────────────────────────────────────────────────────

-- One counter per outlet, advanced only by next_pos_order_number(), so two
-- waiters opening a bill at the same moment cannot take the same number.
create table if not exists pos_order_series (
  outlet_id uuid primary key references pos_outlets on delete cascade,
  last_seq  int not null default 0 check (last_seq >= 0)
);

create or replace function next_pos_order_number(p_outlet uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_seq int;
begin
  insert into pos_order_series (outlet_id, last_seq)
  values (p_outlet, 1)
  on conflict (outlet_id) do update set last_seq = pos_order_series.last_seq + 1
  returning last_seq into v_seq;
  return v_seq;
end;
$$;

create table if not exists pos_orders (
  id          uuid primary key default gen_random_uuid(),
  number      text not null unique,
  outlet_id   uuid not null references pos_outlets on delete restrict,
  -- Where it is being served. A table, a room, or neither for a counter sale.
  table_no    text not null default '',
  room_id     uuid references rooms on delete set null,
  -- Set when the bill is tied to a stay, which is what makes a room charge
  -- and a points redemption possible.
  booking_id  uuid references bookings on delete set null,
  guest_name  text not null default '',
  covers      int not null default 1 check (covers >= 0),
  status      text not null default 'open'
              check (status in ('open', 'billed', 'settled', 'void')),
  -- Frozen totals, recomputed by pos_recalc_order() whenever a line changes,
  -- so reports and the outlet dashboard do not re-add every line.
  net_total   numeric(12,2) not null default 0,
  tax_total   numeric(12,2) not null default 0,
  service_net numeric(12,2) not null default 0,
  service_tax numeric(12,2) not null default 0,
  tip_amount  numeric(12,2) not null default 0 check (tip_amount >= 0),
  grand_total numeric(12,2) not null default 0,
  notes       text not null default '',
  -- Set when this order was split off another, for the audit trail.
  split_from_id uuid references pos_orders on delete set null,
  opened_by   uuid references staff on delete set null,
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz,
  voided_at   timestamptz,
  voided_by   uuid references staff on delete set null,
  void_reason text not null default ''
);

create index if not exists pos_orders_outlet_idx on pos_orders (outlet_id, opened_at desc);
create index if not exists pos_orders_open_idx on pos_orders (outlet_id, status) where status = 'open';
create index if not exists pos_orders_booking_idx on pos_orders (booking_id) where booking_id is not null;

create table if not exists pos_order_lines (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references pos_orders on delete cascade,
  -- Kept as a reference only: the name and price are frozen below, so
  -- retiring a menu item never rewrites a bill that has already been served.
  item_id     uuid references pos_items on delete set null,
  name        text not null,
  qty         numeric(10,3) not null default 1 check (qty > 0),
  unit_price  numeric(12,2) not null check (unit_price >= 0),
  -- The modifiers chosen, frozen: [{"name": "Extra cheese", "price_delta": 50}]
  modifiers   jsonb not null default '[]',
  notes       text not null default '',
  -- Computed on insert from qty, unit_price, modifiers and the tax rate.
  net_amount  numeric(12,2) not null default 0,
  tax_rate    numeric(5,2) not null default 0,
  tax_amount  numeric(12,2) not null default 0,
  -- Kitchen Order Ticket: when this line was sent to the kitchen.
  kot_sent_at timestamptz,
  voided_at   timestamptz,
  voided_by   uuid references staff on delete set null,
  void_reason text not null default '',
  created_by  uuid references staff on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists pos_order_lines_order_idx on pos_order_lines (order_id, created_at);

create table if not exists pos_payments (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references pos_orders on delete cascade,
  -- POS keeps its own short list rather than the folio's payment_method enum,
  -- because "charge to room" is a payment here and a charge on the folio.
  kind        text not null check (kind in ('cash', 'card', 'upi', 'room_charge', 'loyalty_points', 'other')),
  amount      numeric(12,2) not null check (amount > 0),
  -- Room charges: the folio entries this produced, and the stay it went to.
  booking_id  uuid references bookings on delete set null,
  folio_id    uuid references folios on delete set null,
  -- Points redemptions: how many points were taken.
  points      int check (points > 0),
  reference   text not null default '',
  voided_at   timestamptz,
  voided_by   uuid references staff on delete set null,
  void_reason text not null default '',
  created_by  uuid references staff on delete set null,
  created_at  timestamptz not null default now(),
  constraint pos_payment_points_only_on_loyalty
    check (kind = 'loyalty_points' or points is null),
  constraint pos_payment_loyalty_has_points
    check (kind <> 'loyalty_points' or points is not null)
);

create index if not exists pos_payments_order_idx on pos_payments (order_id, created_at);

-- ── Totals ──────────────────────────────────────────────────────────────────

-- Recomputes and freezes an order's totals. Called by a trigger on the lines,
-- so nothing can leave the order and its lines disagreeing.
create or replace function pos_recalc_order(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_net      numeric(12,2);
  v_tax      numeric(12,2);
  v_pct      numeric(5,2);
  v_rate     numeric(5,2);
  v_svc_net  numeric(12,2);
  v_svc_tax  numeric(12,2);
  v_tip      numeric(12,2);
begin
  select coalesce(sum(net_amount), 0), coalesce(sum(tax_amount), 0)
    into v_net, v_tax
    from pos_order_lines
   where order_id = p_order and voided_at is null;

  select o.service_charge_percent, o.tax_rate, po.tip_amount
    into v_pct, v_rate, v_tip
    from pos_orders po join pos_outlets o on o.id = po.outlet_id
   where po.id = p_order;

  -- Service charge is part of the supply, so it carries the outlet's tax.
  v_svc_net := round(v_net * coalesce(v_pct, 0) / 100, 2);
  v_svc_tax := round(v_svc_net * coalesce(v_rate, 0) / 100, 2);

  update pos_orders
     set net_total   = v_net,
         tax_total   = v_tax,
         service_net = v_svc_net,
         service_tax = v_svc_tax,
         grand_total = v_net + v_tax + v_svc_net + v_svc_tax + coalesce(v_tip, 0)
   where id = p_order;
end;
$$;

create or replace function pos_lines_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pos_recalc_order(coalesce(new.order_id, old.order_id));
  -- A split moves a line between two orders; both need recomputing.
  if tg_op = 'UPDATE' and new.order_id is distinct from old.order_id then
    perform pos_recalc_order(old.order_id);
  end if;
  return null;
end;
$$;

drop trigger if exists pos_order_lines_recalc on pos_order_lines;
create trigger pos_order_lines_recalc after insert or update or delete on pos_order_lines
  for each row execute function pos_lines_recalc();

-- What is still owed on a bill.
create or replace function pos_order_balance(p_order uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select grand_total from pos_orders where id = p_order), 0)
       - coalesce((select sum(amount) from pos_payments
                    where order_id = p_order and voided_at is null), 0);
$$;

-- ── Opening an order and adding to it ──────────────────────────────────────

create or replace function pos_open_order(
  p_outlet   uuid,
  p_table    text default '',
  p_room     uuid default null,
  p_booking  uuid default null,
  p_guest    text default '',
  p_covers   int default 1
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_code   text;
  v_seq    int;
  v_order  uuid;
begin
  if not has_permission('pos.order') then
    raise exception 'not permitted';
  end if;

  select code into v_code from pos_outlets where id = p_outlet and is_active;
  if v_code is null then
    raise exception 'POS_NO_OUTLET' using hint = 'Choose an outlet that is open for business.';
  end if;

  v_seq := next_pos_order_number(p_outlet);

  insert into pos_orders (number, outlet_id, table_no, room_id, booking_id, guest_name, covers, opened_by)
  values (v_code || '/' || lpad(v_seq::text, 6, '0'), p_outlet, coalesce(p_table, ''), p_room,
          p_booking, coalesce(p_guest, ''), greatest(coalesce(p_covers, 1), 0), auth.uid())
  returning id into v_order;

  return v_order;
end;
$$;

-- Adds an item to an open bill, freezing its name, price, chosen modifiers and
-- tax rate onto the line.
create or replace function pos_add_line(
  p_order     uuid,
  p_item      uuid,
  p_qty       numeric,
  p_modifiers uuid[] default '{}',
  p_notes     text default ''
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_item   record;
  v_status text;
  v_rate   numeric(5,2);
  v_delta  numeric(12,2) := 0;
  v_mods   jsonb := '[]';
  v_unit   numeric(12,2);
  v_gross  numeric(12,2);
  v_net    numeric(12,2);
  v_tax    numeric(12,2);
  v_incl   boolean;
  v_line   uuid;
begin
  if not has_permission('pos.order') then
    raise exception 'not permitted';
  end if;
  if coalesce(p_qty, 0) <= 0 then
    raise exception 'POS_QTY_INVALID' using hint = 'Enter how many.';
  end if;

  select status into v_status from pos_orders where id = p_order;
  if v_status is null then
    raise exception 'POS_NO_ORDER' using hint = 'That bill no longer exists.';
  end if;
  if v_status <> 'open' then
    raise exception 'POS_ORDER_CLOSED'
      using hint = 'This bill is no longer open. Open a new one for anything else ordered.';
  end if;

  select i.*, o.tax_inclusive into v_item
    from pos_items i join pos_outlets o on o.id = i.outlet_id
   where i.id = p_item and i.is_active;
  if v_item is null then
    raise exception 'POS_NO_ITEM' using hint = 'That item is not on the menu.';
  end if;
  if not exists (select 1 from pos_orders where id = p_order and outlet_id = v_item.outlet_id) then
    raise exception 'POS_ITEM_WRONG_OUTLET'
      using hint = 'That item belongs to another outlet''s menu.';
  end if;

  v_incl := v_item.tax_inclusive;
  v_rate := pos_item_tax_rate(p_item);

  -- Only modifiers that belong to this item may be applied.
  select coalesce(sum(m.price_delta), 0),
         coalesce(jsonb_agg(jsonb_build_object('name', m.name, 'price_delta', m.price_delta)), '[]')
    into v_delta, v_mods
    from pos_modifiers m
    join pos_item_modifiers im on im.modifier_id = m.id and im.item_id = p_item
   where m.id = any(coalesce(p_modifiers, '{}')) and m.is_active;

  v_unit  := v_item.price + coalesce(v_delta, 0);
  v_gross := round(v_unit * p_qty, 2);

  -- A tax-inclusive menu price has the tax taken back out of it, so the folio
  -- and the invoice always show net and tax separately.
  if v_incl and v_rate > 0 then
    v_net := round(v_gross / (1 + v_rate / 100), 2);
    v_tax := v_gross - v_net;
  else
    v_net := v_gross;
    v_tax := round(v_gross * v_rate / 100, 2);
  end if;

  insert into pos_order_lines (
    order_id, item_id, name, qty, unit_price, modifiers, notes,
    net_amount, tax_rate, tax_amount, created_by
  ) values (
    p_order, p_item, v_item.name, p_qty, v_unit, coalesce(v_mods, '[]'), coalesce(p_notes, ''),
    v_net, v_rate, v_tax, auth.uid()
  )
  returning id into v_line;

  return v_line;
end;
$$;

-- ── Split and merge ─────────────────────────────────────────────────────────

-- Moves lines onto another open bill in the same outlet. Splitting passes a
-- fresh order; merging passes the bill to keep and then voids the empty one.
create or replace function pos_move_lines(p_lines uuid[], p_target uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_outlet uuid;
  v_status text;
  v_moved  int;
begin
  if not has_permission('pos.order') then
    raise exception 'not permitted';
  end if;

  select outlet_id, status into v_outlet, v_status from pos_orders where id = p_target;
  if v_outlet is null then
    raise exception 'POS_NO_ORDER' using hint = 'That bill no longer exists.';
  end if;
  if v_status <> 'open' then
    raise exception 'POS_ORDER_CLOSED' using hint = 'Lines can only move onto an open bill.';
  end if;

  -- Every line must come from an open bill in the same outlet, and a bill that
  -- has taken money cannot give its lines away — the payment would be orphaned.
  if exists (
    select 1 from pos_order_lines l join pos_orders o on o.id = l.order_id
     where l.id = any(p_lines)
       and (o.outlet_id <> v_outlet or o.status <> 'open'
            or exists (select 1 from pos_payments p where p.order_id = o.id and p.voided_at is null))
  ) then
    raise exception 'POS_MOVE_NOT_ALLOWED'
      using hint = 'Lines can only move between open bills in the same outlet that have taken no payment yet.';
  end if;

  update pos_order_lines set order_id = p_target
   where id = any(p_lines) and voided_at is null and order_id <> p_target;
  get diagnostics v_moved = row_count;

  return v_moved;
end;
$$;

-- ── Charge to room ──────────────────────────────────────────────────────────

-- Posts an outlet bill to a guest's folio (SOW Module 6 "Charge to Room").
--
-- One folio entry per tax rate, because a folio entry carries a single rate
-- and a GST invoice has to show what was charged at each. The service charge
-- and any tip go on as their own lines.
--
-- Refused unless the guest is checked in — that is the authorisation the SOW
-- asks for — and refused if it would breach the property's room-charge limit
-- or, on a company-billed folio, the company's credit limit.
create or replace function pos_charge_to_room(p_order uuid, p_booking uuid, p_folio uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_order    record;
  v_outlet   record;
  v_booking  record;
  v_folio    uuid := p_folio;
  v_company  uuid;
  v_owing    numeric(12,2);
  v_limit    numeric(12,2);
  v_posted   numeric(12,2);
  v_band     record;
  v_payment  uuid;
  v_label    text;
  v_staff    uuid := auth.uid();
begin
  if not has_permission('pos.pay') then
    raise exception 'not permitted';
  end if;

  select * into v_order from pos_orders where id = p_order;
  if v_order is null then
    raise exception 'POS_NO_ORDER' using hint = 'That bill no longer exists.';
  end if;
  if v_order.status = 'void' then
    raise exception 'POS_ORDER_VOID' using hint = 'That bill has been voided.';
  end if;

  v_owing := pos_order_balance(p_order);
  if v_owing <= 0 then
    raise exception 'POS_NOTHING_OWED' using hint = 'This bill is already settled.';
  end if;

  select * into v_outlet from pos_outlets where id = v_order.outlet_id;

  select b.*, g.full_name as guest_full_name
    into v_booking
    from bookings b left join guests g on g.id = b.guest_id
   where b.id = p_booking;
  if v_booking is null then
    raise exception 'POS_NO_BOOKING' using hint = 'Choose the room the guest is staying in.';
  end if;
  if v_booking.status <> 'checked_in' then
    raise exception 'POS_NOT_CHECKED_IN'
      using hint = 'Only a guest who is checked in may charge to their room. Take payment at the outlet instead.';
  end if;

  if v_folio is null then
    v_folio := master_folio(p_booking);
  end if;
  if not exists (select 1 from folios where id = v_folio and booking_id = p_booking) then
    raise exception 'FOLIO_BOOKING_MISMATCH' using hint = 'That folio belongs to a different booking.';
  end if;

  -- The property's cap on how much outlet spend one stay may carry unpaid.
  select pos_room_charge_limit into v_limit from property_settings limit 1;
  if coalesce(v_limit, 0) > 0 then
    select coalesce(sum(p.amount), 0) into v_posted
      from pos_payments p
     where p.kind = 'room_charge' and p.voided_at is null and p.booking_id = p_booking;
    if v_posted + v_owing > v_limit then
      raise exception 'POS_ROOM_CHARGE_LIMIT: this stay carries % of a % outlet limit; this bill adds %',
        v_posted, v_limit, v_owing;
    end if;
  end if;

  -- A folio billed to a company is the company's debt, so its limit applies.
  select company_id into v_company from folios where id = v_folio;
  if v_company is not null then
    if exists (
      select 1 from companies
       where id = v_company and credit_limit is not null
         and company_balance(v_company) + v_owing > credit_limit
    ) then
      raise exception 'CITY_LEDGER_CREDIT_LIMIT: this bill of % would take the company past its credit limit',
        v_owing;
    end if;
  end if;

  v_label := v_outlet.name || ' — ' || v_order.number;

  -- The goods and services, grouped by tax rate.
  for v_band in
    select tax_rate, sum(net_amount) as net, sum(tax_amount) as tax
      from pos_order_lines
     where order_id = p_order and voided_at is null
     group by tax_rate
     having sum(net_amount) + sum(tax_amount) > 0
     order by tax_rate
  loop
    insert into folio_entries (booking_id, folio_id, kind, description, amount, tax_amount, tax_rate, reference, created_by)
    values (p_booking, v_folio, 'extra', v_label, v_band.net, v_band.tax, v_band.tax_rate, v_order.number, v_staff);
  end loop;

  if v_order.service_net > 0 then
    insert into folio_entries (booking_id, folio_id, kind, description, amount, tax_amount, tax_rate, reference, created_by)
    values (p_booking, v_folio, 'extra', v_label || ' — service charge',
            v_order.service_net, v_order.service_tax, v_outlet.tax_rate, v_order.number, v_staff);
  end if;

  if v_order.tip_amount > 0 then
    insert into folio_entries (booking_id, folio_id, kind, description, amount, tax_amount, tax_rate, reference, created_by)
    values (p_booking, v_folio, 'extra', v_label || ' — tip', v_order.tip_amount, 0, 0, v_order.number, v_staff);
  end if;

  insert into pos_payments (order_id, kind, amount, booking_id, folio_id, reference, created_by)
  values (p_order, 'room_charge', v_owing, p_booking, v_folio,
          coalesce(v_booking.reference, ''), v_staff)
  returning id into v_payment;

  update pos_orders
     set booking_id = coalesce(booking_id, p_booking),
         guest_name = case when guest_name = '' then coalesce(v_booking.guest_full_name, v_booking.contact_name, '') else guest_name end,
         status = 'settled',
         closed_at = now()
   where id = p_order;

  return v_payment;
end;
$$;

-- ── Settling at the outlet ─────────────────────────────────────────────────

-- Cash, card or UPI taken at the till.
create or replace function pos_take_payment(p_order uuid, p_kind text, p_amount numeric, p_reference text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_owing numeric(12,2);
  v_status text;
  v_id    uuid;
begin
  if not has_permission('pos.pay') then
    raise exception 'not permitted';
  end if;
  if p_kind not in ('cash', 'card', 'upi', 'other') then
    raise exception 'POS_PAYMENT_KIND'
      using hint = 'Use charge to room or a points redemption for those.';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'POS_AMOUNT_INVALID' using hint = 'Enter the amount taken.';
  end if;

  select status into v_status from pos_orders where id = p_order;
  if v_status is null then
    raise exception 'POS_NO_ORDER' using hint = 'That bill no longer exists.';
  end if;
  if v_status = 'void' then
    raise exception 'POS_ORDER_VOID' using hint = 'That bill has been voided.';
  end if;

  v_owing := pos_order_balance(p_order);
  if v_owing <= 0 then
    raise exception 'POS_NOTHING_OWED' using hint = 'This bill is already settled.';
  end if;
  if p_amount > v_owing then
    raise exception 'POS_OVERPAYMENT: % is owed but % was entered', v_owing, p_amount;
  end if;

  insert into pos_payments (order_id, kind, amount, reference, created_by)
  values (p_order, p_kind, p_amount, coalesce(p_reference, ''), auth.uid())
  returning id into v_id;

  if pos_order_balance(p_order) <= 0 then
    update pos_orders set status = 'settled', closed_at = now() where id = p_order;
  else
    update pos_orders set status = 'billed' where id = p_order and status = 'open';
  end if;

  return v_id;
end;
$$;

-- Loyalty points against an outlet bill (SOW Module 6 "Wallet/Points
-- redemption"). Reuses the lot consumption from Module 8, so points come off
-- the batch expiring soonest exactly as they do on a folio.
create or replace function pos_redeem_points(p_order uuid, p_guest uuid, p_points int)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_tier  record;
  v_min   int;
  v_value numeric(12,2);
  v_owing numeric(12,2);
  v_status text;
begin
  if not (has_permission('pos.pay') and has_permission('loyalty.redeem')) then
    raise exception 'not permitted';
  end if;

  select status into v_status from pos_orders where id = p_order;
  if v_status is null then
    raise exception 'POS_NO_ORDER' using hint = 'That bill no longer exists.';
  end if;
  if v_status = 'void' then
    raise exception 'POS_ORDER_VOID' using hint = 'That bill has been voided.';
  end if;

  select loyalty_min_redeem_points into v_min from property_settings limit 1;
  if p_points < coalesce(v_min, 0) then
    raise exception 'LOYALTY_BELOW_MINIMUM: the smallest redemption is % points', coalesce(v_min, 0);
  end if;

  select t.* into v_tier
    from guests g join loyalty_tiers t on t.key = g.loyalty_tier
   where g.id = p_guest and g.loyalty_opt_in;
  if v_tier is null then
    raise exception 'LOYALTY_NOT_A_MEMBER' using hint = 'Enrol the guest in the loyalty programme first.';
  end if;
  if v_tier.redeem_rate <= 0 then
    raise exception 'LOYALTY_NO_REDEEM_RATE' using hint = 'This tier has no redemption rate set.';
  end if;

  v_value := round(p_points * v_tier.redeem_rate, 2);
  v_owing := pos_order_balance(p_order);
  if v_owing <= 0 then
    raise exception 'POS_NOTHING_OWED' using hint = 'This bill is already settled.';
  end if;
  if v_value > v_owing then
    raise exception 'LOYALTY_OVER_BALANCE: % is worth % but only % is owed', p_points, v_value, v_owing;
  end if;

  perform loyalty_consume(p_guest, p_points);

  insert into pos_payments (order_id, kind, amount, points, reference, created_by)
  values (p_order, 'loyalty_points', v_value, p_points,
          (select loyalty_member_no from guests where id = p_guest), auth.uid());

  insert into loyalty_transactions (guest_id, kind, points, base_amount, tier, description, created_by)
  values (p_guest, 'redeem', -p_points, v_value, v_tier.key,
          'Redeemed at ' || (select o.name from pos_orders po join pos_outlets o on o.id = po.outlet_id where po.id = p_order)
            || ' — ' || (select number from pos_orders where id = p_order),
          auth.uid());

  if pos_order_balance(p_order) <= 0 then
    update pos_orders set status = 'settled', closed_at = now() where id = p_order;
  else
    update pos_orders set status = 'billed' where id = p_order and status = 'open';
  end if;

  return v_value;
end;
$$;

-- ── Kitchen Order Tickets ──────────────────────────────────────────────────

-- Marks every unsent line as sent and returns how many. The ticket itself is
-- printed from the browser, or posted to a kitchen display by the app; this
-- only records that it went, so a line is never fired twice.
create or replace function pos_send_kot(p_order uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if not has_permission('pos.order') then
    raise exception 'not permitted';
  end if;

  update pos_order_lines
     set kot_sent_at = now()
   where order_id = p_order and voided_at is null and kot_sent_at is null;
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

-- ── Voiding ─────────────────────────────────────────────────────────────────

create or replace function pos_void_order(p_order uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_permission('pos.manage') then
    raise exception 'not permitted';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'POS_VOID_REASON' using hint = 'Give a reason for voiding this bill.';
  end if;
  if exists (select 1 from pos_payments where order_id = p_order and voided_at is null) then
    raise exception 'POS_ORDER_PAID'
      using hint = 'This bill has taken payment. Reverse the payment before voiding it.';
  end if;

  update pos_orders
     set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason, closed_at = now()
   where id = p_order and status <> 'void';
end;
$$;

-- ── Row level security ──────────────────────────────────────────────────────

alter table pos_outlets        enable row level security;
alter table pos_categories     enable row level security;
alter table pos_items          enable row level security;
alter table pos_modifiers      enable row level security;
alter table pos_item_modifiers enable row level security;
alter table pos_orders         enable row level security;
alter table pos_order_lines    enable row level security;
alter table pos_payments       enable row level security;
alter table pos_order_series   enable row level security;

-- The menu is readable by any member of staff: the front desk quotes from it
-- and housekeeping restocks the mini-bar from it.
do $$
declare
  t text;
begin
  foreach t in array array['pos_outlets', 'pos_categories', 'pos_items', 'pos_modifiers', 'pos_item_modifiers']
  loop
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (is_staff())', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format(
      'create policy %I on %I for all using (has_permission(''pos.manage'')) with check (has_permission(''pos.manage''))',
      t || '_write', t);
  end loop;
end;
$$;

-- Bills are for the people who work the outlets, plus anyone who can read a
-- folio, since an outlet charge lands there.
drop policy if exists pos_orders_select on pos_orders;
drop policy if exists pos_orders_write  on pos_orders;
create policy pos_orders_select on pos_orders for select
  using (has_permission('pos.view') or has_permission('folio.view'));
create policy pos_orders_write on pos_orders for all
  using (has_permission('pos.order') or has_permission('pos.manage'))
  with check (has_permission('pos.order') or has_permission('pos.manage'));

drop policy if exists pos_order_lines_select on pos_order_lines;
drop policy if exists pos_order_lines_write  on pos_order_lines;
create policy pos_order_lines_select on pos_order_lines for select
  using (has_permission('pos.view') or has_permission('folio.view'));
create policy pos_order_lines_write on pos_order_lines for all
  using (has_permission('pos.order') or has_permission('pos.manage'))
  with check (has_permission('pos.order') or has_permission('pos.manage'));

drop policy if exists pos_payments_select on pos_payments;
drop policy if exists pos_payments_write  on pos_payments;
create policy pos_payments_select on pos_payments for select
  using (has_permission('pos.view') or has_permission('folio.view'));
create policy pos_payments_write on pos_payments for all
  using (has_permission('pos.pay')) with check (has_permission('pos.pay'));

-- Counters move only through next_pos_order_number(), which is definer.
drop policy if exists pos_order_series_select on pos_order_series;
create policy pos_order_series_select on pos_order_series for select using (has_permission('pos.view'));

-- ── Audit ───────────────────────────────────────────────────────────────────

do $$
declare
  t record;
begin
  for t in select * from (values
    ('pos_outlets', 'pos'), ('pos_categories', 'pos'), ('pos_items', 'pos'),
    ('pos_modifiers', 'pos'), ('pos_orders', 'pos'), ('pos_payments', 'pos')
  ) as x (tbl, module) loop
    execute format('drop trigger if exists %I on %I', t.tbl || '_audit', t.tbl);
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function audit_row(%L)',
      t.tbl || '_audit', t.tbl, t.module);
  end loop;
end;
$$;
