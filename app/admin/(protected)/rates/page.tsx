import Image from "next/image";
import { createClient } from "../../../lib/supabase/server";
import { requireAnyPermission } from "../../../lib/auth";
import { can } from "../../../lib/permissions";
import type { RoomType, ExtraCharge } from "../../../lib/types";
import { removeGalleryPhoto } from "../../rates-actions";
import { Card, Notice, fmtMoney } from "../../components/ui";
import ActionForm from "../../components/ActionForm";
import RoomTypeForm from "./RoomTypeForm";
import RoomPhotoForm from "./RoomPhotoForm";
import NewRoomTypeForm from "./NewRoomTypeForm";
import DeleteRoomTypeForm from "./DeleteRoomTypeForm";
import ExtraChargeForm from "./ExtraChargeForm";

export default async function RatesPage() {
  const session = await requireAnyPermission(["rates.view", "rates.manage"]);
  const supabase = await createClient();
  const manage = can(session, "rates.manage");

  const [{ data: roomTypes }, { data: charges }] = await Promise.all([
    supabase.from("room_types").select("*").order("sort_order"),
    supabase.from("extra_charges").select("*").order("sort_order"),
  ]);
  const types = (roomTypes ?? []) as RoomType[];

  if (!manage) {
    return (
      <Card className="p-5">
        <ul className="divide-y divide-slate-100 text-sm">
          {types.map((t) => (
            <li key={t.id} className="py-2 flex justify-between">
              <span>{t.name}</span>
              <span>
                {fmtMoney(t.base_rate)}
                {t.weekend_rate ? ` · weekend ${fmtMoney(t.weekend_rate)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <NewRoomTypeForm />
      </Card>

      {types.map((rt) => (
        <Card key={rt.id} className="p-5 space-y-5">
          <RoomTypeForm roomType={rt} />
          <div className="pt-5 border-t border-slate-100 space-y-3">
            <RoomPhotoForm roomType={rt} />
            {rt.gallery.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {rt.gallery.map((url) => (
                  <div key={url} className="w-28">
                    <div className="relative w-28 h-20 rounded-md overflow-hidden border border-slate-200">
                      <Image src={url} alt={`${rt.name} gallery photo`} fill sizes="112px" className="object-cover" />
                    </div>
                    <ActionForm
                      action={removeGalleryPhoto}
                      submitLabel="Remove"
                      pendingLabel="…"
                      submitClassName="text-[11px] text-slate-500 hover:text-rose-700 cursor-pointer"
                      className=""
                    >
                      <input type="hidden" name="id" value={rt.id} />
                      <input type="hidden" name="url" value={url} />
                    </ActionForm>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="pt-4 border-t border-slate-100">
            <DeleteRoomTypeForm roomType={rt} />
          </div>
        </Card>
      ))}

      <Card className="p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Additional charges</h2>
        <p className="text-xs text-slate-600 mb-4">
          Per person, per night. The extra-occupant charge is added automatically for each adult beyond a room
          type&apos;s included adults.
        </p>
        <div className="space-y-3">
          {((charges ?? []) as ExtraCharge[]).map((charge) => (
            <ExtraChargeForm key={charge.id} charge={charge} />
          ))}
        </div>
      </Card>

      <Notice>
        Room rates are published on the <strong className="font-medium">CPAI plan</strong> — accommodation with
        breakfast, inclusive of applicable taxes. Rate plans adjust from these base rates.
      </Notice>
    </div>
  );
}
