"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../lib/supabase/server";
import { requirePermission } from "../lib/auth";
import { getCurrentProperty } from "../lib/properties";
import { friendlyDbError } from "../lib/db-errors";
import { LANGUAGES, type MessageTemplateKey } from "../lib/types";
import { TEMPLATE_LABELS, unknownPlaceholders } from "../lib/message-templates";
import { type ActionState, str, oneOf } from "./form-utils";

const KEYS = Object.keys(TEMPLATE_LABELS) as MessageTemplateKey[];

/** Module 15: guest message templates, edited without a developer. */
export async function saveTemplate(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("settings.manage");
  const supabase = await createClient();
  const template = oneOf(fd, "template", KEYS, "confirmation");
  const language = str(fd, "language", 2);
  if (!(language in LANGUAGES)) return { error: "Unknown language." };

  const row = {
    template,
    language,
    subject: str(fd, "subject", 200),
    body: str(fd, "body", 4000),
    footer: str(fd, "footer", 4000),
    sms: str(fd, "sms", 480),
    updated_by: session.staff.id,
    updated_at: new Date().toISOString(),
  };
  if (!row.subject) return { error: "The subject cannot be empty." };
  const unknown = unknownPlaceholders([row.subject, row.body, row.footer, row.sms].join("\n"));
  if (unknown.length) {
    return { error: `Unknown placeholder${unknown.length > 1 ? "s" : ""}: ${unknown.map((u) => `{${u}}`).join(", ")}. Use the ones listed.` };
  }

  // Templates are per property since 0024 ("Customizable message templates per
  // property and per language"), so the conflict target carries the property.
  const property = await getCurrentProperty();
  const { error } = await supabase
    .from("message_templates")
    .upsert(
      { ...row, ...(property ? { property_id: property.id } : {}) },
      { onConflict: "property_id,template,language" },
    );
  if (error) return { error: friendlyDbError(error.message) };
  revalidatePath("/admin/settings/templates");
  return { success: `${TEMPLATE_LABELS[template].name} (${LANGUAGES[language]}) saved.` };
}

/** Removes a language's version, so the default language's is used instead. */
export async function resetTemplate(fd: FormData) {
  await requirePermission("settings.manage");
  const supabase = await createClient();
  const template = oneOf(fd, "template", KEYS, "confirmation");
  const language = str(fd, "language", 2);
  await supabase.from("message_templates").delete().eq("template", template).eq("language", language);
  revalidatePath("/admin/settings/templates");
}
