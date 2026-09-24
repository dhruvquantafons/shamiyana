#!/bin/bash
# Applies every migration to a throwaway Postgres database — each file in its
# own transaction, as `supabase db push` does — after seeding data the way a
# pre-upgrade production database looks, then runs the behaviour checks.
#
#   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres supabase/tests/run.sh
#
# Needs a local Postgres 15+ superuser. It creates and drops a database named
# pms_test; it never touches a Supabase project. Lines marked EXPECT in the
# output are deliberate refusals (overbooking, RLS, room clashes).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
MIGRATIONS="$HERE/../migrations"
DB=${PMS_TEST_DB:-pms_test}
P="psql -v ON_ERROR_STOP=1 -q"

$P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
$P -d "$DB" -1 -f "$HERE/supabase_stub.sql" 2>/dev/null
for f in "$MIGRATIONS"/*.sql; do
  echo "== $(basename "$f")"
  $P -d "$DB" -1 -f "$f" 2>&1 | grep -v -E "NOTICE|wal_level|HINT" || true
  if [ "$(basename "$f")" = "0004_staff_roles.sql" ]; then
    $P -d "$DB" -1 -f "$HERE/seed_before_upgrade.sql"
  fi
done
echo "All migrations applied."
psql -d "$DB" -f "$HERE/behaviour.sql"
