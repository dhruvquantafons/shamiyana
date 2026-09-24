import { createServiceClient } from "../../lib/supabase/server";
import { hasBearer } from "../../lib/bearer";

/**
 * Integration hook for biometric attendance devices (SOW Module 12:
 * "biometric integration-ready"). The device or its middleware posts:
 *
 *   POST /api/attendance
 *   Authorization: Bearer <ATTENDANCE_API_SECRET>
 *   { "employee_code": "EMP-003", "event": "in" | "out", "time": "2026-09-19T08:58:00+05:30" }
 *
 * "time" is optional (defaults to now). Staff are matched by the employee ID
 * on their HR profile. Disabled until ATTENDANCE_API_SECRET is set.
 */
export async function POST(request: Request) {
  const secret = process.env.ATTENDANCE_API_SECRET;
  if (!secret || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Attendance integration is not configured." }, { status: 503 });
  }
  if (!hasBearer(request, secret)) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { employee_code?: unknown; event?: unknown; time?: unknown } | null;
  const code = typeof body?.employee_code === "string" ? body.employee_code.trim().slice(0, 30) : "";
  const event = body?.event === "in" || body?.event === "out" ? body.event : null;
  let at = new Date();
  if (typeof body?.time === "string") at = new Date(body.time);
  if (!code || !event || Number.isNaN(at.getTime())) {
    return Response.json({ error: 'Send {"employee_code": string, "event": "in" | "out", "time"?: ISO 8601}.' }, { status: 400 });
  }
  // Devices may queue punches while offline, but not from the future.
  if (at.getTime() > Date.now() + 5 * 60000 || at.getTime() < Date.now() - 7 * 86400000) {
    return Response.json({ error: "time must be within the last 7 days." }, { status: 400 });
  }

  const { data, error } = await createServiceClient().rpc("attendance_device_event", {
    p_code: code,
    p_event: event,
    p_at: at.toISOString(),
  });
  if (error) return Response.json({ error: "Could not record attendance." }, { status: 500 });

  const status = data as string;
  const http = status === "unknown_employee" ? 404 : status === "already_in" || status === "not_in" ? 409 : 200;
  return Response.json({ employee_code: code, result: status }, { status: http });
}
