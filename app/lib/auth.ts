import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { hasSupabaseConfig } from "./supabase/config";
import type { Role, Staff } from "./types";
import { can, canAny, type Access, type Permission } from "./permissions";
import { getSettings } from "./settings";
import { passwordExpired } from "./password-policy";
import { isDemoTwoFactor, isDemoVerified } from "./two-factor";

export interface Session extends Access {
  staff: Staff;
  role: Role;
  /** Supabase authenticator assurance: aal2 once a second factor is verified. */
  aal: { current: string | null; next: string | null };
  hasTotp: boolean;
  /** An administrator ended this person's sessions after they signed in. */
  revoked: boolean;
}

/** How often last_seen_at is refreshed; any finer is needless writes. */
const SEEN_THROTTLE_MS = 5 * 60 * 1000;

/**
 * Resolves the signed-in staff member with their role and permissions, or
 * null. Does not redirect.
 *
 * Wrapped in React's cache() so the layout and the page it renders share a
 * single lookup per request.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  if (!hasSupabaseConfig()) return null;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("staff")
    .select("*, roles(*)")
    .eq("id", user.id)
    .single();

  if (!data || !data.is_active || !data.roles) return null;

  const { roles: role, ...staff } = data as Staff & { roles: Role };

  const { data: perms } = await supabase
    .from("role_permissions")
    .select("permission")
    .eq("role_key", role.key);
  const permissions = new Set((perms ?? []).map((p) => p.permission as string));

  // Sessions end when an administrator revokes them (Module 15). The sign-in
  // time comes from the token's authentication methods, which survive token
  // refreshes, so refreshing does not bring an ended session back.
  let revoked = false;
  if (staff.sessions_revoked_at) {
    const { data: jwt } = await supabase.auth.getClaims();
    const amr = (jwt?.claims?.amr ?? []) as { timestamp?: number }[];
    const stamps = amr.map((a) => a.timestamp).filter((t): t is number => typeof t === "number");
    const signedInAt = (stamps.length ? Math.min(...stamps) : Number(jwt?.claims?.iat ?? 0)) * 1000;
    revoked = signedInAt < Date.parse(staff.sessions_revoked_at);
  }

  if (isDemoTwoFactor()) {
    // Demo: roles that require 2FA always have it; others opt in on the
    // security page. The "assurance level" comes from the signed cookie.
    const hasTotp = role.requires_2fa || user.user_metadata?.demo_2fa === true;
    const verified = hasTotp && (await isDemoVerified(user.id));
    return {
      staff,
      role,
      isSuperuser: role.is_superuser,
      permissions,
      aal: { current: verified ? "aal2" : "aal1", next: hasTotp ? "aal2" : "aal1" },
      hasTotp,
      revoked,
    };
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const hasTotp = (user.factors ?? []).some(
    (f) => f.factor_type === "totp" && f.status === "verified",
  );

  return {
    staff,
    role,
    isSuperuser: role.is_superuser,
    permissions,
    aal: { current: aal?.currentLevel ?? null, next: aal?.nextLevel ?? null },
    hasTotp,
    revoked,
  };
});

/** Kept for callers that only need the staff row. */
export async function getStaff(): Promise<Staff | null> {
  return (await getSession())?.staff ?? null;
}

/**
 * Guard for every admin page and server action. proxy.ts already redirects
 * unauthenticated traffic, but authorization is re-checked here so a missed
 * matcher can never expose data.
 *
 * Also enforces the account rules that must hold before anything else:
 * a second factor when one is enrolled or the role requires it, and a
 * password within its maximum age.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  if (session.revoked) redirect("/admin/signout?reason=ended");

  if (session.aal.next === "aal2" && session.aal.current !== "aal2") {
    redirect("/admin/login/verify");
  }
  if (session.role.requires_2fa && !session.hasTotp) {
    redirect("/admin/security?required=2fa");
  }

  const settings = await getSettings();
  if (
    session.staff.must_change_password ||
    passwordExpired(session.staff.password_changed_at, settings.password_max_age_days)
  ) {
    redirect("/admin/security?required=password");
  }

  const lastSeen = session.staff.last_seen_at ? Date.parse(session.staff.last_seen_at) : 0;
  if (Date.now() - lastSeen > SEEN_THROTTLE_MS) {
    const supabase = await createClient();
    await supabase.rpc("touch_staff_seen");
  }

  return session;
}

/** Kept for callers that only need the staff row. */
export async function requireStaff(): Promise<Staff> {
  return (await requireSession()).staff;
}

export async function requirePermission(permission: Permission): Promise<Session> {
  const session = await requireSession();
  if (!can(session, permission)) redirect("/admin?denied=1");
  return session;
}

export async function requireAnyPermission(permissions: Permission[]): Promise<Session> {
  const session = await requireSession();
  if (!canAny(session, permissions)) redirect("/admin?denied=1");
  return session;
}

/** Serializable form of the session's access, for Client Components. */
export function accessForClient(session: Session) {
  return { isSuperuser: session.isSuperuser, permissions: [...session.permissions] };
}
