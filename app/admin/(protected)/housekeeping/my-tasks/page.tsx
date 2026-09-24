import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import { getSettings } from "../../../../lib/settings";
import { todayIn, minutesSince } from "../../../../lib/dates";
import type { HkChecklistItem, HousekeepingTask } from "../../../../lib/types";
import { HK_KIND_LABELS, HK_STATUS_LABELS, CHECKLIST_CATEGORY_LABELS } from "../../../../lib/types";
import { startTask, completeTask } from "../../../housekeeping-actions";
import { Card, Check, EmptyState, Tag, inputClass, checkboxClass, buttonClass } from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

/**
 * The housekeeper's list, built for a phone or tablet: one card per room,
 * big buttons, and the linen / amenities / minibar checklist to finish.
 */
export default async function MyTasksPage() {
  const session = await requirePermission("housekeeping.tasks");
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);

  const [{ data: taskRows }, { data: itemRows }] = await Promise.all([
    supabase
      .from("housekeeping_tasks")
      .select("*, rooms(id, room_number, floor, status, housekeeping_status, dnd)")
      .eq("assigned_to", session.staff.id)
      .lte("task_date", today)
      .in("status", ["pending", "in_progress", "cleaned"])
      .order("priority")
      .order("created_at"),
    supabase.from("hk_checklist_items").select("*").eq("is_active", true).order("sort_order"),
  ]);

  const tasks = (taskRows ?? []) as HousekeepingTask[];
  const items = (itemRows ?? []) as HkChecklistItem[];
  // Work in progress first, then urgent, then the rest.
  const order = { in_progress: 0, pending: 1, cleaned: 2, inspected: 3, cancelled: 4 };
  tasks.sort((a, b) => order[a.status] - order[b.status] || (a.priority === "high" ? -1 : 0) - (b.priority === "high" ? -1 : 0));

  if (tasks.length === 0) {
    return (
      <Card>
        <EmptyState message="No tasks assigned to you right now." />
      </Card>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {tasks.map((t) => {
        const elapsed = t.started_at ? minutesSince(t.started_at) : 0;
        const late = t.status === "in_progress" && elapsed > t.target_minutes;
        return (
          <Card key={t.id} className={`p-4 ${t.status === "in_progress" ? "border-yellow-400 ring-1 ring-yellow-400" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-2xl font-semibold text-slate-900">Room {t.rooms?.room_number}</p>
                <p className="text-sm text-slate-600">
                  {HK_KIND_LABELS[t.kind]} · floor {t.rooms?.floor ?? "—"} · target {t.target_minutes} min
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Tag tone={t.status === "in_progress" ? "blue" : t.status === "cleaned" ? "amber" : "neutral"}>
                  {HK_STATUS_LABELS[t.status]}
                </Tag>
                {t.priority === "high" && <Tag tone="red">Guest arriving today</Tag>}
                {t.rooms?.dnd && <Tag tone="violet">Do Not Disturb</Tag>}
              </div>
            </div>

            {t.inspection_note && t.status === "pending" && (
              <p className="mt-3 text-sm bg-rose-50 border border-rose-200 text-rose-900 rounded-md px-3 py-2">
                Supervisor: {t.inspection_note}
              </p>
            )}
            {t.notes && <p className="mt-2 text-sm text-slate-600">{t.notes}</p>}

            {t.status === "pending" && (
              <ActionForm
                action={startTask}
                submitLabel="Start cleaning"
                pendingLabel="Starting…"
                submitClassName={`${buttonClass} w-full !py-3 !text-base`}
                className="mt-4 space-y-2"
              >
                <input type="hidden" name="id" value={t.id} />
              </ActionForm>
            )}

            {t.status === "in_progress" && (
              <>
                <p className={`mt-3 text-sm ${late ? "text-rose-700 font-medium" : "text-slate-600"}`}>
                  {elapsed} of {t.target_minutes} minutes{late ? " — over target" : ""}
                </p>
                <ActionForm
                  action={completeTask}
                  submitLabel="Mark done"
                  pendingLabel="Saving…"
                  submitClassName={`${buttonClass} w-full !py-3 !text-base`}
                  className="mt-4 space-y-4"
                >
                  <input type="hidden" name="id" value={t.id} />
                  {(["linen", "amenities", "minibar"] as const).map((cat) => {
                    const catItems = items.filter((i) => i.category === cat);
                    if (catItems.length === 0) return null;
                    return (
                      <fieldset key={cat}>
                        <legend className="text-sm font-semibold text-slate-900 mb-2">
                          {CHECKLIST_CATEGORY_LABELS[cat]}
                          {cat === "minibar" && <span className="font-normal text-slate-500"> — enter what you restocked</span>}
                        </legend>
                        <div className="divide-y divide-slate-100 border border-slate-200 rounded-md">
                          {catItems.map((i) => (
                            <label key={i.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer">
                              <input type="checkbox" name={`done_${i.id}`} className={`${checkboxClass} !w-5 !h-5`} />
                              <span className="flex-1 text-sm text-slate-800">{i.label}</span>
                              <input
                                type="number"
                                name={`qty_${i.id}`}
                                min={0}
                                max={99}
                                defaultValue={cat === "minibar" ? 0 : i.par_qty}
                                aria-label={`${i.label} quantity`}
                                className={`${inputClass} !w-16 !py-1 text-center`}
                              />
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    );
                  })}
                  <Check name="confirm_incomplete" label="Finish even though some items are not ticked" />
                </ActionForm>
              </>
            )}

            {t.status === "cleaned" && (
              <p className="mt-3 text-sm text-slate-600">Done — waiting for the supervisor to inspect.</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
