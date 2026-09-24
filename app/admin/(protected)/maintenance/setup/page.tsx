import { requirePermission } from "../../../../lib/auth";
import { getSettings } from "../../../../lib/settings";
import type { MtPriority } from "../../../../lib/types";
import { MT_PRIORITIES, MT_PRIORITY_LABELS } from "../../../../lib/types";
import { saveSla } from "../../../maintenance-actions";
import { Card, Field, SectionTitle, inputClass } from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

export default async function MaintenanceSetupPage() {
  await requirePermission("maintenance.manage");
  const settings = await getSettings();
  const current: Record<MtPriority, number> = {
    low: settings.mt_sla_low_hours,
    medium: settings.mt_sla_medium_hours,
    high: settings.mt_sla_high_hours,
    urgent: settings.mt_sla_urgent_hours,
  };

  return (
    <Card className="p-5 max-w-xl">
      <SectionTitle>Resolution targets</SectionTitle>
      <p className="text-sm text-slate-600 mb-4">
        How long each priority has to be resolved, counted from when the ticket is raised. A ticket past its target is
        escalated once to everyone with the &ldquo;Assign tickets&rdquo; permission — shown on the board and dashboard, and sent
        by email and SMS when those are set up. Urgent tickets alert them as soon as they are raised.
      </p>
      <ActionForm action={saveSla} submitLabel="Save targets" className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...MT_PRIORITIES].reverse().map((p) => (
            <Field key={p} label={`${MT_PRIORITY_LABELS[p]} (hours)`}>
              <input type="number" name={p} min={1} max={2160} required defaultValue={current[p]} className={inputClass} />
            </Field>
          ))}
        </div>
      </ActionForm>
    </Card>
  );
}
