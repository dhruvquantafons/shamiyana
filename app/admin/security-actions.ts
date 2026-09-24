"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, createServiceClient, createEphemeralClient } from "../lib/supabase/server";
import { getSession } from "../lib/auth";
import { getSettings, DEFAULT_SETTINGS } from "../lib/settings";
import { passwordProblems, describePasswordProblems, isLockedOut } from "../lib/password-policy";
import type { PropertySettings } from "../lib/types";
import { isDemoTwoFactor, checkDemoCode, setDemoVerified, clearDemoVerified } from "../lib/two-factor";
import { type ActionState, str } from "./form-utils";

/** Settings readable before anyone is signed in, via the service role. */
async function publicSecuritySettings(): Promise<PropertySettings> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return DEFAULT_SETTINGS;
  const { data } = await createServiceClient().from("property_settings").select("*").maybeSingle();
  return data ? ({ ...DEFAULT_SETTINGS, ...data } as PropertySettings) : DEFAULT_SETTINGS;
}

function safeNext(next: string) {
  return next.startsWith("/admin") && !next.startsWith("//") ? next : "/admin";
}

/**
 * Password sign-in with account lockout (SOW Module 15: "lockout after
 * repeated failed attempts"). Attempts are recorded with the service role,
 * so the count cannot be read or reset by the person signing in.
 */
export async function signIn(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = str(fd, "email", 200).toLowerCase();
  const password = String(fd.get("password") ?? "");
  const next = safeNext(str(fd, "next", 500));
  if (!email || !password) return { error: "Enter your email and password." };

  const hdrs = await headers();
  const ip = (hdrs.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64);
  const tracking = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const settings = await publicSecuritySettings();

  if (tracking) {
    const since = new Date(Date.now() - settings.lockout_minutes * 60000).toISOString();
    const { data: recent } = await createServiceClient()
      .from("login_attempts")
      .select("attempted_at, succeeded")
      .ilike("email", email)
      .gte("attempted_at", since)
      .order("attempted_at", { ascending: false })
      .limit(settings.max_failed_logins + 1);
    if (isLockedOut(recent ?? [], settings.max_failed_logins, settings.lockout_minutes)) {
      return {
        error: `Too many failed attempts. This account is locked for ${settings.lockout_minutes} minutes.`,
      };
    }
  }

  const supabase = await createClient();
  // A new sign-in always has to pass the second step again.
  await clearDemoVerified();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (tracking) {
    await createServiceClient().from("login_attempts").insert({ email, succeeded: !error, ip });
  }

  if (error) {
    return {
      error:
        error.message === "Invalid login credentials"
          ? "That email and password combination was not recognised."
          : error.message,
    };
  }

  // In demo mode the verify page decides; it waves through anyone who
  // does not need a second step.
  const verified = isDemoTwoFactor() || (data.user.factors ?? []).some((f) => f.status === "verified");
  redirect(verified ? `/admin/login/verify?next=${encodeURIComponent(next)}` : next);
}

/** Second step of sign-in for anyone with an authenticator enrolled. */
export async function verifyTotp(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const code = str(fd, "code", 10).replace(/\s/g, "");
  const next = safeNext(str(fd, "next", 500));
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code from your authenticator app." };

  if (isDemoTwoFactor()) {
    const session = await getSession();
    if (!session) redirect("/admin/login");
    if (!checkDemoCode(code)) return { error: "That code was not accepted." };
    await setDemoVerified(session.staff.id);
    redirect(next);
  }

  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.find((f) => f.status === "verified");
  if (!factor) redirect("/admin");

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return { error: "That code was not accepted. Codes change every 30 seconds — try the current one." };

  redirect(next);
}

// ── Enrolment (from /admin/security) ───────────────────────────────────────

export interface EnrolState extends ActionState {
  factorId?: string;
  qr?: string;
  secret?: string;
}

export async function startTotpEnrolment(): Promise<EnrolState> {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  if (isDemoTwoFactor()) return { factorId: "demo", qr: "demo", secret: "" };
  const supabase = await createClient();

  // Clear any half-finished enrolment first; Supabase refuses duplicates.
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const f of existing?.all ?? []) {
    if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error) {
    return {
      error: /disabled/i.test(error.message)
        ? "TOTP multi-factor authentication is switched off for this Supabase project (Authentication → Multi-Factor)."
        : error.message,
    };
  }
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmTotpEnrolment(prev: EnrolState, fd: FormData): Promise<EnrolState> {
  const code = str(fd, "code", 10).replace(/\s/g, "");
  const factorId = str(fd, "factor_id", 64);
  if (!/^\d{6}$/.test(code)) return { ...prev, error: "Enter the 6-digit code shown in the app." };

  const supabase = await createClient();
  if (isDemoTwoFactor()) {
    if (!checkDemoCode(code)) return { ...prev, error: "That code was not accepted." };
    const { error } = await supabase.auth.updateUser({ data: { demo_2fa: true } });
    if (error) return { ...prev, error: error.message };
    const session = await getSession();
    if (session) await setDemoVerified(session.staff.id);
  } else {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) return { ...prev, error: "That code was not accepted. Check the time on your phone and try again." };
  }

  await supabase.rpc("log_event", {
    p_module: "staff",
    p_action: "2fa_enrolled",
    p_record_id: (await getSession())?.staff.id ?? null,
    p_summary: "Two-factor authentication enabled",
  });
  return { success: "Two-factor authentication is on. You will be asked for a code at each sign-in." };
}

export async function removeTotp(): Promise<ActionState> {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  if (session.role.requires_2fa) {
    return { error: "Your role requires two-factor authentication. Ask an administrator to reset it if you lost your device." };
  }
  const supabase = await createClient();
  if (isDemoTwoFactor()) {
    const { error } = await supabase.auth.updateUser({ data: { demo_2fa: false } });
    if (error) return { error: error.message };
    await clearDemoVerified();
    return { success: "Two-factor authentication removed." };
  }
  const { data } = await supabase.auth.mfa.listFactors();
  for (const f of data?.all ?? []) await supabase.auth.mfa.unenroll({ factorId: f.id });
  return { success: "Two-factor authentication removed." };
}

// ── Own password ────────────────────────────────────────────────────────────

export async function changeOwnPassword(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  const settings = await getSettings();

  const current = String(fd.get("current_password") ?? "");
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");

  if (password !== confirm) return { error: "The two new passwords do not match." };
  if (password === current) return { error: "Choose a password different from the current one." };
  const problems = passwordProblems(
    password,
    { minLength: settings.password_min_length, maxAgeDays: settings.password_max_age_days },
    session.staff.email,
  );
  if (problems.length) return { error: describePasswordProblems(problems) };

  // Re-authenticate so a walked-away session cannot change the password.
  const probe = createEphemeralClient();
  const { error: reauthError } = await probe.auth.signInWithPassword({
    email: session.staff.email,
    password: current,
  });
  if (reauthError) return { error: "Your current password is not correct." };
  await probe.auth.signOut({ scope: "local" });

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  await supabase.rpc("mark_password_changed");

  return { success: "Password changed." };
}
