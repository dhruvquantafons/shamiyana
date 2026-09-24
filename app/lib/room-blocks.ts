import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Taking a room out of inventory and putting it back, shared by the Rooms
 * page (Module 3) and maintenance tickets (Module 11).
 */

/** Stays assigned to the room that a block from start to end (inclusive; null = open) would overlap. */
export async function blockClashes(
  supabase: SupabaseClient,
  roomId: string,
  start: string,
  end: string | null,
): Promise<string[]> {
  let query = supabase
    .from("bookings")
    .select("reference, check_in, check_out")
    .eq("room_id", roomId)
    .in("status", ["tentative", "confirmed", "checked_in"])
    .gt("check_out", start);
  if (end) query = query.lte("check_in", end);
  const { data } = await query;
  return (data ?? []).map((b) => `${b.reference} (${b.check_in} → ${b.check_out})`);
}

/** A block starting today takes the room off the board now rather than at night audit. */
export async function applyBlockNow(
  supabase: SupabaseClient,
  roomId: string,
  kind: "out_of_order" | "out_of_service",
  start: string,
  today: string,
) {
  if (start <= today) {
    await supabase.from("rooms").update({ status: kind }).eq("id", roomId).neq("status", "occupied");
  }
}

/**
 * Releases open blocks (one by id, or every block of a ticket). The room goes
 * back into inventory — marked dirty, so it is cleaned and inspected before a
 * guest — unless another block still covers today.
 */
export async function releaseBlocks(
  supabase: SupabaseClient,
  match: { id: string } | { ticketId: string },
  staffId: string,
  note: string,
  today: string,
): Promise<{ released: number; stillBlocked: boolean; error?: string }> {
  let query = supabase
    .from("room_blocks")
    .update({ released_at: new Date().toISOString(), released_by: staffId, release_note: note })
    .is("released_at", null);
  query = "id" in match ? query.eq("id", match.id) : query.eq("ticket_id", match.ticketId);
  const { data: released, error } = await query.select("room_id");
  if (error) return { released: 0, stillBlocked: false, error: error.message };

  let stillBlocked = false;
  for (const roomId of new Set((released ?? []).map((b) => b.room_id as string))) {
    const { data: others } = await supabase
      .from("room_blocks")
      .select("id, end_date")
      .eq("room_id", roomId)
      .is("released_at", null)
      .lte("start_date", today);
    const blocked = (others ?? []).some((b) => b.end_date === null || b.end_date >= today);
    stillBlocked ||= blocked;
    if (!blocked) {
      await supabase
        .from("rooms")
        .update({ status: "available", housekeeping_status: "dirty", housekeeping_updated_at: new Date().toISOString() })
        .eq("id", roomId)
        .in("status", ["out_of_order", "out_of_service"]);
    }
  }

  return { released: released?.length ?? 0, stillBlocked };
}
