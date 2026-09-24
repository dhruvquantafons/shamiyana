import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "../../lib/supabase/server";

/**
 * Integration hook for in-room controls (SOW Module 5: "DND flagging synced
 * from guest room controls"). The room-control system posts:
 *
 *   POST /api/room-controls
 *   Authorization: Bearer <ROOM_CONTROLS_SECRET>
 *   { "room_number": "203", "dnd": true }
 *
 * Disabled until ROOM_CONTROLS_SECRET is set.
 */
export async function POST(request: Request) {
  const secret = process.env.ROOM_CONTROLS_SECRET;
  if (!secret || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Room controls integration is not configured." }, { status: 503 });
  }

  const given = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { room_number?: unknown; dnd?: unknown } | null;
  const roomNumber = typeof body?.room_number === "string" ? body.room_number.trim().slice(0, 20) : "";
  if (!roomNumber || typeof body?.dnd !== "boolean") {
    return Response.json({ error: 'Send {"room_number": string, "dnd": boolean}.' }, { status: 400 });
  }

  const { data, error } = await createServiceClient()
    .from("rooms")
    .update({ dnd: body.dnd, dnd_updated_at: new Date().toISOString() })
    .eq("room_number", roomNumber)
    .select("room_number, dnd");
  if (error) return Response.json({ error: "Could not update the room." }, { status: 500 });
  if (!data?.length) return Response.json({ error: "Unknown room." }, { status: 404 });

  return Response.json({ room_number: data[0].room_number, dnd: data[0].dnd });
}
