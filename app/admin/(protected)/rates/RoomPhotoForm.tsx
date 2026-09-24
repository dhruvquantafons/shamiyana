"use client";

import { keepFormOnSubmit } from "../../components/useKeepForm";

import { useActionState, useRef, useState } from "react";
import Image from "next/image";
import { ImageUp, Upload } from "lucide-react";
import type { RoomType } from "../../../lib/types";
import { uploadRoomPhoto } from "../../rates-actions";
import type { ActionState } from "../../form-utils";
import { buttonClass, Banner } from "../../components/ui";

const MAX_BYTES = 5 * 1024 * 1024;

export default function RoomPhotoForm({ roomType }: { roomType: RoomType }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    uploadRoomPhoto,
    {},
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string>();

  // Shown until a new file is chosen, then replaced by the pending image.
  const current = roomType.image || null;

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setLocalError(undefined);
    setPreview(null);

    if (!file) return;

    if (file.size > MAX_BYTES) {
      setLocalError("That image is larger than 5 MB. Please compress it first.");
      e.target.value = "";
      return;
    }

    setPreview(URL.createObjectURL(file));
  }

  return (
    <form action={formAction} onSubmit={keepFormOnSubmit(formAction)} className="space-y-3">
      <input type="hidden" name="id" value={roomType.id} />

      <div className="flex items-center justify-between gap-3">
        <span className="block text-xs font-medium text-slate-600">
          Photos
        </span>
        <select name="target" defaultValue="cover" className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white">
          <option value="cover">Upload as main photo</option>
          <option value="gallery">Add to gallery</option>
        </select>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div className="relative w-44 h-32 rounded-lg overflow-hidden border border-slate-200 bg-slate-100 shrink-0">
          {preview ? (
            // Object URL from the file picker, so a plain img is correct here.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Selected photo preview" className="w-full h-full object-cover" />
          ) : current ? (
            <Image
              src={current}
              alt={`${roomType.name} photograph`}
              fill
              sizes="176px"
              className="object-cover"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-1">
              <ImageUp className="w-6 h-6" />
              <span className="text-[10px]">No photo</span>
            </div>
          )}

          {preview && (
            <span className="absolute bottom-0 inset-x-0 bg-yellow-400 text-slate-900 text-[9px] uppercase tracking-widest text-center py-0.5">
              Not saved yet
            </span>
          )}
        </div>

        <div className="flex-1 min-w-[220px] space-y-2">
          <input
            ref={inputRef}
            type="file"
            name="photo"
            accept="image/jpeg,image/png,image/webp,image/avif"
            onChange={handleChange}
            className="block w-full text-xs text-slate-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-yellow-50 file:text-yellow-800 hover:file:bg-yellow-100 file:cursor-pointer cursor-pointer"
          />

          <p className="text-[11px] text-slate-500 leading-relaxed">
            JPEG, PNG, WebP or AVIF, up to 5 MB. Landscape photographs around
            1600×1080 look best on the room cards.
          </p>

          <button
            type="submit"
            disabled={pending || !preview}
            className={`${buttonClass} flex items-center gap-1.5`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{pending ? "Uploading…" : "Upload photo"}</span>
          </button>
        </div>
      </div>

      <Banner error={localError ?? state.error} success={state.success} />
    </form>
  );
}
