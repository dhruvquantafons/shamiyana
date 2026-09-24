import type { Room, RoomType } from "../../../lib/types";
import { createRoom } from "../../rooms-actions";
import ActionForm from "../../components/ActionForm";
import RoomFields from "./RoomFields";

export default function AddRoomForm({ roomTypes, rooms }: { roomTypes: RoomType[]; rooms: Room[] }) {
  return (
    <ActionForm action={createRoom} submitLabel="Add room" pendingLabel="Adding…">
      <RoomFields roomTypes={roomTypes} rooms={rooms} />
    </ActionForm>
  );
}
