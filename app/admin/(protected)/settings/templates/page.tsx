import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import { getSettings } from "../../../../lib/settings";
import { previewMessage } from "../../../../lib/notifications";
import { PLACEHOLDERS, TEMPLATE_LABELS, pickTemplate } from "../../../../lib/message-templates";
import type { MessageTemplate, MessageTemplateKey } from "../../../../lib/types";
import { LANGUAGES } from "../../../../lib/types";
import { resetTemplate, saveTemplate } from "../../../template-actions";
import { Card, Field, Notice, PageHeader, SectionTitle, Tag, inputClass, fmtDateTime } from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

const KEYS = Object.keys(TEMPLATE_LABELS) as MessageTemplateKey[];

/**
 * Guest message templates per language (SOW Module 15: "email templates";
 * Module 16: edit "without needing a developer, using placeholders").
 */
export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  await requirePermission("settings.manage");
  const settings = await getSettings();
  const { lang } = await searchParams;
  const language = lang && settings.languages.includes(lang) ? lang : settings.default_language;
  const supabase = await createClient();
  const { data } = await supabase.from("message_templates").select("*");
  const rows = (data ?? []) as MessageTemplate[];

  return (
    <>
      <Link href="/admin/settings" className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700 mb-4">
        <ArrowLeft className="w-3.5 h-3.5" /> Settings
      </Link>
      <PageHeader
        title="Message templates"
        description="The words of every email and SMS sent to guests. The booking details table is added automatically between the opening and closing paragraphs."
      />

      <div className="flex flex-wrap items-center gap-1 mb-4">
        {settings.languages.map((code) => (
          <Link
            key={code}
            href={`/admin/settings/templates?lang=${code}`}
            className={`text-xs px-2.5 py-1 rounded-md border ${code === language ? "bg-yellow-50 border-yellow-300 text-yellow-900" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
          >
            {LANGUAGES[code] ?? code}
            {code === settings.default_language && " (default)"}
          </Link>
        ))}
        <Link href="/admin/settings" className="text-xs text-yellow-800 ml-2">
          Add languages in Settings
        </Link>
      </div>

      <Card className="p-4 mb-6">
        <p className="text-xs font-medium text-slate-700 mb-2">Placeholders — type them with the braces</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(PLACEHOLDERS).map(([k, desc]) => (
            <span key={k} title={desc} className="text-[11px] font-mono bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-slate-700">
              {`{${k}}`}
            </span>
          ))}
        </div>
      </Card>

      <div className="space-y-6">
        {KEYS.map((key) => {
          const own = rows.find((r) => r.template === key && r.language === language);
          const effective = own ?? pickTemplate(rows, key, [settings.default_language]);
          const preview = previewMessage(key, effective, settings);
          return (
            <Card key={key} className="p-5">
              <SectionTitle
                action={
                  own ? (
                    <span className="text-[11px] text-slate-500">Edited {own.updated_at ? fmtDateTime(own.updated_at) : ""}</span>
                  ) : (
                    <Tag>{language === settings.default_language ? "Built-in text" : `Using ${LANGUAGES[settings.default_language]} until translated`}</Tag>
                  )
                }
              >
                {TEMPLATE_LABELS[key].name}
              </SectionTitle>
              <p className="text-xs text-slate-500 -mt-2 mb-4">Sent when: {TEMPLATE_LABELS[key].when}</p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ActionForm action={saveTemplate} submitLabel="Save" className="space-y-3">
                  <input type="hidden" name="template" value={key} />
                  <input type="hidden" name="language" value={language} />
                  <Field label="Email subject">
                    <input name="subject" required maxLength={200} defaultValue={effective.subject} className={inputClass} />
                  </Field>
                  <Field label="Opening paragraph">
                    <textarea name="body" rows={3} maxLength={4000} defaultValue={effective.body} className={inputClass} />
                  </Field>
                  <Field label="Closing paragraph" hint="After the booking details. A line whose placeholder is empty is left out.">
                    <textarea name="footer" rows={2} maxLength={4000} defaultValue={effective.footer} className={inputClass} />
                  </Field>
                  <Field label="SMS" hint="Keep under 160 characters for a single message.">
                    <textarea name="sms" rows={2} maxLength={480} defaultValue={effective.sms} className={inputClass} />
                  </Field>
                </ActionForm>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-700">Preview with a sample booking</p>
                  <p className="text-sm text-slate-900">
                    <span className="text-slate-500">Subject:</span> {preview.subject}
                  </p>
                  <iframe
                    title={`${TEMPLATE_LABELS[key].name} preview`}
                    srcDoc={preview.html}
                    sandbox=""
                    className="w-full h-80 border border-slate-200 rounded-md bg-white"
                  />
                  <p className="text-xs text-slate-600">
                    <span className="text-slate-500">SMS ({preview.sms.length} chars):</span> {preview.sms}
                  </p>
                  {own && (
                    <form action={resetTemplate}>
                      <input type="hidden" name="template" value={key} />
                      <input type="hidden" name="language" value={language} />
                      <button className="text-xs text-rose-700 cursor-pointer">
                        {language === settings.default_language ? "Restore the built-in text" : `Remove this translation`}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      <div className="mt-6">
        <Notice>Previews show saved text. Save to update them.</Notice>
      </div>
    </>
  );
}
