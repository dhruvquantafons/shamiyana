import type { Room, RoomType } from "../../../lib/types";
import { updateRoom, deleteRoom } from "../../rooms-actions";
import { dangerButtonClass } from "../../components/ui";
import ActionForm from "../../components/ActionForm";
import RoomFields from "./RoomFields";

export default function RoomEditForm({ room, roomTypes, rooms }: { room: Room; roomTypes: RoomType[]; rooms: Room[] }) {
  return (
    <div className="space-y-3">
      <ActionForm action={updateRoom} submitLabel="Save room">
        <input type="hidden" name="id" value={room.id} />
        <RoomFields room={room} roomTypes={roomTypes} rooms={rooms} />
      </ActionForm>
      <ActionForm
        action={deleteRoom}
        submitLabel="Remove room"
        submitClassName={dangerButtonClass}
        confirmMessage={`Remove room ${room.room_number}? Only possible if it has never been booked.`}
        className=""
      >
        <input type="hidden" name="id" value={room.id} />
      </ActionForm>
    </div>
  );
}
