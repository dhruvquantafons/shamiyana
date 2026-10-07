-- What a Supabase project provides around the app's own migrations, for the
-- desktop demo. Runs after Supabase Auth has created the auth schema and
-- before supabase/migrations/*.sql. Idempotent: it runs on every start.
--
-- The roles themselves (anon, authenticated, service_role, authenticator,
-- supabase_auth_admin) are created by desktop/lib/database.js, because their
-- passwords are generated per installation.

grant usage on schema public, auth to anon, authenticated, service_role;
grant all on all tables in schema auth to service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- The app's migrations reference storage.buckets and storage.objects; the
-- desktop gateway (desktop/lib/storage.js) keeps files on disk and writes one
-- row here per object, as the signed-in user, so the app's own storage
-- policies decide who may upload, read and delete — as Supabase Storage does.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- Applied app migrations, so an updated installer only runs the new ones.
create schema if not exists desktop;
create table if not exists desktop.migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

-- The database's sealed copy of the demo's trial state (desktop/lib/license.js).
create table if not exists desktop.license (
  id int primary key default 1 check (id = 1),
  state text not null,
  updated_at timestamptz not null default now()
);
revoke all on schema desktop from public;
