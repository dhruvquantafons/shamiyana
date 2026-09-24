"use client";

import { keepFormOnSubmit } from "../../components/useKeepForm";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import type { RoomType } from "../../../lib/types";
import { deleteRoomType } from "../../rates-actions";
import type { ActionState } from "../../form-utils";
import { Banner } from "../../components/ui";

export default function DeleteRoomTypeForm({ roomType }: { roomType: RoomType }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    deleteRoomType,
    {},
  );

  return (
    <form
      action={formAction}
          onSubmit={keepFormOnSubmit(formAction, `Delete "${roomType.name}"? This cannot be undone. It is refused if any rooms or bookings still use it.`)}
      className="space-y-2"
    >
      <input type="hidden" name="id" value={roomType.id} />

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-rose-700 transition-colors cursor-pointer disabled:opacity-50"
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span>{pending ? "Deleting…" : "Delete this room type"}</span>
      </button>

      <Banner error={state.error} success={state.success} />
    </form>
  );
}
