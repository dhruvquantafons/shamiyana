import { createServiceClient } from "../../../lib/supabase/server";
import { hasBearer } from "../../../lib/bearer";
import { escalateOverdueTickets } from "../../../lib/staff-alerts";
import { todayIn } from "../../../lib/dates";

/**
 * Scheduled maintenance job (SOW Module 11): escalates tickets past their
 * resolution target and raises preventive tickets that have fallen due.
 * Call it every 15–30 minutes from a scheduler (e.g. Vercel Cron, which
 * sends "Authorization: Bearer <CRON_SECRET>"). Disabled until CRON_SECRET
 * is set. Night audit and the maintenance board also do this work.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "The maintenance job is not configured." }, { status: 503 });
  }
  if (!hasBearer(request, secret)) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const supabase = createServiceClient();

  // Every hotel in the group, not just the one the website sells (Module 14).
  // A cron request carries no staff session, so without naming the property
  // each job would quietly run for one hotel and leave the others' tickets to
  // rot — no error, just work that never happens.
  const { data: properties } = await supabase
    .from("properties")
    .select("id, timezone")
    .eq("is_active", true);

  let preventiveCreated = 0;
  let escalated = 0;

  for (const property of properties ?? []) {
    const { data: preventive, error } = await supabase.rpc("mt_generate_preventive", {
      p_date: todayIn(property.timezone ?? "Asia/Kolkata"),
      p_property: property.id,
    });
    if (error) return Response.json({ error: "Could not raise preventive tickets." }, { status: 500 });
    preventiveCreated += Number(preventive ?? 0);
    escalated += await escalateOverdueTickets(supabase, null, property.id);
  }

  return Response.json({
    properties: (properties ?? []).length,
    preventive_created: preventiveCreated,
    escalated,
  });
}
