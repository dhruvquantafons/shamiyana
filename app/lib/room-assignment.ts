/**
 * Room assignment (SOW Module 2, "Room Assignment Logic").
 *
 * A room is eligible when it is the booked type, vacant, inspected, not
 * blocked and not promised to another stay on any of these nights. Eligible
 * rooms are then ranked by how well they match the guest: requested floor and
 * view, occupancy, accessibility. VIP guests are steered to the best-ranked
 * room by giving a higher floor and a view match more weight.
 */
import type { Room } from "./types";

export type AssignableRoom = Pick<
  Room,
  | "id"
  | "room_number"
  | "room_type_id"
  | "floor"
  | "view"
  | "status"
  | "housekeeping_status"
  | "is_accessible"
  | "is_smoking"
  | "max_adults"
>;

export interface AssignmentRequest {
  roomTypeId: string | null;
  checkIn: string;
  checkOut: string;
  adults: number;
  preferredFloor: number | null;
  preferredView: string;
  isVip: boolean;
  needsAccessible?: boolean;
  /** When the room is needed now (check-in), it must be ready. */
  forImmediateCheckIn: boolean;
}

export interface StayOnRoom {
  room_id: string | null;
  check_in: string;
  check_out: string;
}

export interface BlockOnRoom {
  room_id: string;
  start_date: string;
  end_date: string | null;
}

export interface RankedRoom {
  room: AssignableRoom;
  score: number;
  reasons: string[];
}

export interface Ineligible {
  room: AssignableRoom;
  why: string;
}

function overlaps(aIn: string, aOut: string, bIn: string, bOut: string) {
  return aIn < bOut && aOut > bIn;
}

function blockedDuring(block: BlockOnRoom, checkIn: string, checkOut: string) {
  // Blocks are inclusive of end_date; stays exclude check-out.
  return block.start_date < checkOut && (block.end_date === null || block.end_date >= checkIn);
}

export function rankRooms(
  request: AssignmentRequest,
  rooms: AssignableRoom[],
  otherStays: StayOnRoom[],
  blocks: BlockOnRoom[],
): { ranked: RankedRoom[]; ineligible: Ineligible[] } {
  const ranked: RankedRoom[] = [];
  const ineligible: Ineligible[] = [];

  for (const room of rooms) {
    if (request.roomTypeId && room.room_type_id !== request.roomTypeId) continue;

    const clash = otherStays.find(
      (s) => s.room_id === room.id && overlaps(request.checkIn, request.checkOut, s.check_in, s.check_out),
    );
    if (clash) {
      ineligible.push({ room, why: "Promised to another stay" });
      continue;
    }
    if (blocks.some((b) => b.room_id === room.id && blockedDuring(b, request.checkIn, request.checkOut))) {
      ineligible.push({ room, why: "Blocked (out of order / service)" });
      continue;
    }

    if (request.forImmediateCheckIn) {
      if (room.status !== "available") {
        ineligible.push({ room, why: room.status === "occupied" ? "Occupied" : "Not available" });
        continue;
      }
      if (room.housekeeping_status !== "inspected") {
        ineligible.push({ room, why: `Not inspected (${room.housekeeping_status})` });
        continue;
      }
    }

    if (room.max_adults !== null && request.adults > room.max_adults) {
      ineligible.push({ room, why: `Sleeps ${room.max_adults}` });
      continue;
    }

    let score = 0;
    const reasons: string[] = [];

    if (request.preferredFloor !== null && room.floor !== null) {
      const distance = Math.abs(room.floor - request.preferredFloor);
      score += Math.max(0, 30 - distance * 10);
      if (distance === 0) reasons.push("Requested floor");
    }

    if (request.preferredView && room.view) {
      if (room.view.toLowerCase().includes(request.preferredView.toLowerCase())) {
        score += request.isVip ? 40 : 25;
        reasons.push("Requested view");
      }
    }

    if (request.needsAccessible) {
      if (room.is_accessible) {
        score += 100;
        reasons.push("Accessible");
      } else {
        score -= 100;
      }
    }

    if (request.isVip) {
      // Higher floors are quieter and have the better views.
      score += (room.floor ?? 0) * 3;
      if (room.view) score += 10;
    }

    if (room.is_smoking) score -= 5;
    if (room.housekeeping_status === "inspected") score += 5;

    ranked.push({ room, score, reasons });
  }

  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      a.room.room_number.localeCompare(b.room.room_number, undefined, { numeric: true }),
  );
  return { ranked, ineligible };
}
