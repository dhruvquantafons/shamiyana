import { NextResponse } from "next/server";
import { createClient } from "../../lib/supabase/server";
import { clearDemoVerified } from "../../lib/two-factor";

/**
 * Signs the browser out and returns to the login page. Pages redirect here
 * when an administrator has ended the person's sessions, since a page
 * cannot clear cookies itself.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  await clearDemoVerified();
  const reason = new URL(request.url).searchParams.get("reason") === "ended" ? "ended" : "";
  return NextResponse.redirect(new URL(`/admin/login${reason ? `?reason=${reason}` : ""}`, request.url));
}
