import type { Metadata } from "next";
import { connection } from "next/server";
import { createServiceClient } from "../../lib/supabase/server";
import { hasSupabaseConfig } from "../../lib/supabase/config";
import { SITE } from "../../lib/site";
import FeedbackForm from "./FeedbackForm";

export const metadata: Metadata = {
  title: "Your stay",
  robots: { index: false, follow: false },
};

/** The guest's feedback form, reached from the link in their final bill. */
export default async function FeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  let state: "form" | "done" | "invalid" = "invalid";
  let firstName = "";

  if (/^[A-Za-z0-9_-]{20,64}$/.test(token) && hasSupabaseConfig() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { data } = await createServiceClient()
      .from("guest_feedback")
      .select("submitted_at, bookings(contact_name)")
      .eq("token", token)
      .maybeSingle();
    if (data) {
      state = data.submitted_at ? "done" : "form";
      firstName = ((data.bookings as unknown as { contact_name: string } | null)?.contact_name ?? "").split(" ")[0];
    }
  }

  return (
    <main className="min-h-screen bg-[#f9f8f5] text-[#1c1b1a]">
      <header className="bg-[#141312] text-[#e6d7c3]">
        <div className="max-w-xl mx-auto px-4 sm:px-6 py-10">
          <p className="text-[11px] uppercase tracking-[0.25em] text-[#a88956]">{SITE.name}</p>
          <h1 className="font-serif text-3xl sm:text-4xl font-light mt-3">
            {state === "form" ? `How was your stay${firstName ? `, ${firstName}` : ""}?` : "Thank you"}
          </h1>
        </div>
      </header>
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-10">
        {state === "form" && <FeedbackForm token={token} />}
        {state === "done" && (
          <p className="text-sm text-[#5a5854] leading-relaxed">
            We have your feedback for this stay. Thank you for taking the time — we hope to welcome you back to Srinagar soon.
          </p>
        )}
        {state === "invalid" && (
          <p className="text-sm text-[#5a5854] leading-relaxed">
            This feedback link is not valid. If you stayed with us recently, you are welcome to write to{" "}
            <a href={`mailto:${SITE.email}`} className="text-[#a88956] underline">
              {SITE.email}
            </a>
            .
          </p>
        )}
      </div>
    </main>
  );
}
