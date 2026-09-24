"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "../lib/supabase/server";
import { requirePermission } from "../lib/auth";
import { getSettings } from "../lib/settings";
import { getCurrentProperty } from "../lib/properties";
import { friendlyDbError } from "../lib/db-errors";
import { passwordProblems, describePasswordProblems } from "../lib/password-policy";
import { isPermission } from "../lib/permissions";
import { parseTaxSlabs } from "../lib/tax";
import { LANGUAGES } from "../lib/types";
import { isDemoTwoFactor, clearDemoVerified } from "../lib/two-factor";
import { type ActionState, str, num, int, bool, oneOf } from "./form-utils";

// ── Staff ──────────────────────────────────────────────────────────────────

async function roleExists(key: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("roles").select("key").eq("key", key).maybeSingle();
  return Boolean(data);
}

/**
 * Creates a login for a new staff member and fills in their details.
 *
 * Uses the service-role admin API because creating an auth user is privileged;
 * requirePermission above it means only someone with staff.manage reaches
 * this. The account is confirmed immediately, and must change the temporary
 * password at first sign-in.
 */
export async function createStaffMember(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("staff.manage");
  const settings = await getSettings();

  const email = str(fd, "email", 200).toLowerCase();
  const password = str(fd, "password", 200);
  const fullName = str(fd, "full_name", 200);
  const role = str(fd, "role", 40);

  if (!fullName) return { error: "Enter the person's name." };
  if (!email || !email.includes("@")) return { error: "Enter a valid email address." };
  const problems = passwordProblems(password, { minLength: settings.password_min_length, maxAgeDays: 0 }, email);
  if (problems.length) return { error: describePasswordProblems(problems) };
  if (!(await roleExists(role))) return { error: "Choose a role." };

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: "SUPABASE_SERVICE_ROLE_KEY is not set, so accounts cannot be created from here." };
  }

  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createError) {
    const alreadyExists = createError.status === 422 || /already/i.test(createError.message);
    return { error: alreadyExists ? `An account already exists for ${email}.` : createError.message };
  }

  // Which hotel this person works at (Module 14). Written explicitly because
  // this insert goes through the service role, whose current_property() is the
  // website's property rather than whichever one the administrator is working
  // in — so relying on the column default would quietly file new colleagues at
  // the wrong hotel.
  const property = await getCurrentProperty();
  const chosen = str(fd, "property_id", 36);
  const propertyId = /^[0-9a-f-]{36}$/i.test(chosen) ? chosen : (property?.id ?? null);

  // The staff row is written here rather than by a sign-up trigger. Since
  // 0021 that trigger only bootstraps the very first account, because the
  // booking portal now lets the public create logins and none of them may
  // become staff. Upserted because the bootstrap may have created this row.
  const { error: detailsError } = await admin.from("staff").upsert(
    {
      id: created.user.id,
      email,
      full_name: fullName,
      job_title: str(fd, "job_title", 120),
      phone: str(fd, "phone", 50),
      role,
      is_active: true,
      must_change_password: true,
      ...(propertyId ? { property_id: propertyId } : {}),
      all_properties: str(fd, "all_properties") === "true",
    },
    { onConflict: "id" },
  );
  if (detailsError) {
    // Without a staff row the login can do nothing and nobody can tidy it up
    // from the panel, so take the half-made account away again.
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: detailsError.message };
  }

  revalidatePath("/admin/staff");
  return { success: `${fullName} can now sign in with ${email}, and will be asked to choose a new password.` };
}

export async function deleteStaffMember(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("staff.manage");
  const id = str(fd, "id");

  if (id === session.staff.id) return { error: "You cannot delete your own account." };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "SUPABASE_SERVICE_ROLE_KEY is not set." };

  const { error } = await createAdminClient().auth.admin.deleteUser(id);
  if (error) return { error: error.message };

  revalidatePath("/admin/staff");
  return { success: "Staff account removed." };
}

/** Sets a temporary password for someone who has lost theirs. */
export async function resetStaffPassword(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("staff.manage");
  const settings = await getSettings();
  const id = str(fd, "id");
  const password = str(fd, "password", 200);

  const problems = passwordProblems(password, { minLength: settings.password_min_length, maxAgeDays: 0 });
  if (problems.length) return { error: describePasswordProblems(problems) };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "SUPABASE_SERVICE_ROLE_KEY is not set." };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) return { error: error.message };
  await admin.from("staff").update({ must_change_password: true }).eq("id", id);

  return { success: "Temporary password set. They will choose their own at next sign-in." };
}

/** Removes a lost authenticator so the person can enrol a new one. */
export async function resetStaffTwoFactor(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("staff.manage");
  const id = str(fd, "id");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "SUPABASE_SERVICE_ROLE_KEY is not set." };

  const admin = createAdminClient();
  if (isDemoTwoFactor()) {
    const { error } = await admin.auth.admin.updateUserById(id, { user_metadata: { demo_2fa: false } });
    if (error) return { error: error.message };
  } else {
    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: id });
    if (error) return { error: error.message };
    for (const factor of data.factors) {
      await admin.auth.admin.mfa.deleteFactor({ userId: id, id: factor.id });
    }
  }

  const supabase = await createClient();
  await supabase.rpc("log_event", {
    p_module: "staff",
    p_action: "2fa_reset",
    p_record_id: id,
    p_summary: "Two-factor authentication reset by an administrator",
  });

  revalidatePath("/admin/staff");
  return { success: "Two-factor authentication removed. They will be asked to set it up again if their role needs it." };
}

export async function updateStaffMember(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("staff.manage");
  const supabase = await createClient();
  const id = str(fd, "id");

  const fullName = str(fd, "full_name", 200);
  if (!fullName) return { error: "Name is required." };

  // Details anyone may have; role and access only for other people, so an
  // administrator cannot demote or suspend themselves and lock the team out.
  const details: Record<string, string | boolean> = {
    full_name: fullName,
    phone: str(fd, "phone", 50),
    job_title: str(fd, "job_title", 120),
  };

  if (id !== session.staff.id) {
    const role = str(fd, "role", 40);
    if (!(await roleExists(role))) return { error: "Choose a role." };
    details.role = role;
    details.is_active = str(fd, "is_active") === "true";

    // Where they work (Module 14). Only offered for other people, for the same
    // reason as role and active: an administrator who moved themselves to
    // another hotel and cleared their group access could not get back.
    const property = str(fd, "property_id", 36);
    if (/^[0-9a-f-]{36}$/i.test(property)) details.property_id = property;
    details.all_properties = str(fd, "all_properties") === "true";
  }

  const { error } = await supabase.from("staff").update(details).eq("id", id);
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin/staff");
  return { success: "Staff member updated." };
}

// ── Roles ──────────────────────────────────────────────────────────────────

export async function saveRole(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("roles.manage");
  const supabase = await createClient();

  const existingKey = str(fd, "key", 40);
  const isNew = !existingKey;
  const name = str(fd, "name", 80);
  if (!name) return { error: "Name the role." };

  const key = isNew
    ? name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40)
    : existingKey;
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(key)) return { error: "Start the name with a letter." };

  const permissions = fd.getAll("permissions").map(String).filter(isPermission);

  const { data: current } = await supabase.from("roles").select("is_superuser").eq("key", key).maybeSingle();
  if (!isNew && !current) return { error: "Role not found." };

  const payload = {
    name,
    description: str(fd, "description", 300),
    requires_2fa: bool(fd, "requires_2fa"),
  };

  const { error } = isNew
    ? await supabase.from("roles").insert({ key, ...payload, sort_order: 100 })
    : await supabase.from("roles").update(payload).eq("key", key);
  if (error) {
    return { error: error.code === "23505" ? "A role with that name already exists." : friendlyDbError(error.message) };
  }

  // The superuser role holds everything by definition; its list is not edited.
  if (!current?.is_superuser) {
    const { error: clearError } = await supabase.from("role_permissions").delete().eq("role_key", key);
    if (clearError) return { error: friendlyDbError(clearError.message) };
    if (permissions.length) {
      const { error: permError } = await supabase
        .from("role_permissions")
        .insert(permissions.map((permission) => ({ role_key: key, permission })));
      if (permError) return { error: friendlyDbError(permError.message) };
    }
  }

  revalidatePath("/admin/roles");
  revalidatePath("/admin/staff");
  return { success: isNew ? `${name} created.` : `${name} saved. Changes apply on each person's next page load.` };
}

export async function deleteRole(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("roles.manage");
  const supabase = await createClient();
  const key = str(fd, "key", 40);

  const { data: role } = await supabase.from("roles").select("is_system, name").eq("key", key).maybeSingle();
  if (!role) return { error: "Role not found." };
  if (role.is_system) return { error: "Built-in roles cannot be deleted; edit their permissions instead." };

  const { count } = await supabase
    .from("staff")
    .select("id", { count: "exact", head: true })
    .eq("role", key);
  if ((count ?? 0) > 0) return { error: `${count} staff member(s) still have this role.` };

  const { error } = await supabase.from("roles").delete().eq("key", key);
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin/roles");
  return { success: `${role.name} deleted.` };
}

// ── Property settings ─────────────────────────────────────────────────────

export async function saveSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("settings.manage");
  const supabase = await createClient();

  const time = (key: string, fallback: string) => {
    const v = str(fd, key, 5);
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : fallback;
  };

  // Tax slabs: one per line, "7500 5" meaning up to ₹7,500 at 5%, and a
  // final "* 18" for everything above.
  const slabs = str(fd, "tax_slabs", 1000)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [upTo, rate] = l.split(/[\s,:]+/);
      return { up_to: upTo === "*" ? null : Number(upTo), rate: Number(rate) };
    });
  const parsed = parseTaxSlabs(slabs);
  if (parsed.length !== slabs.length || parsed.some((s) => !Number.isFinite(s.rate) || (s.up_to !== null && !Number.isFinite(s.up_to)))) {
    return { error: 'Tax slabs: one per line as "ceiling rate", e.g. "7500 5", ending with "* 18".' };
  }
  if (parsed.length && parsed[parsed.length - 1].up_to !== null) {
    return { error: 'The last tax slab must be "* rate" to cover everything above.' };
  }

  const timezone = str(fd, "timezone", 60) || "Asia/Kolkata";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    return { error: "That timezone is not recognised (e.g. Asia/Kolkata)." };
  }

  const currency = str(fd, "currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { error: "Currency is a 3-letter code such as INR." };

  const fee = (key: string) => oneOf(fd, key, ["none", "percent", "flat"] as const, "percent");

  const defaultLanguage = str(fd, "default_language", 2) in LANGUAGES ? str(fd, "default_language", 2) : "en";
  const languages = [
    ...new Set([defaultLanguage, ...fd.getAll("languages").map(String).filter((l) => l in LANGUAGES)]),
  ];

  // Since 0024 property_settings is a view onto the one property this request
  // is about, and its id is that property's uuid rather than the old
  // singleton `true`. Reading it back keeps the update aimed at one row.
  const { data: current } = await supabase.from("property_settings").select("id").maybeSingle();
  if (!current) return { error: "Property settings are not set up yet." };

  const { error } = await supabase
    .from("property_settings")
    .update({
      name: str(fd, "name", 200) || "Hotel",
      legal_name: str(fd, "legal_name", 200),
      address: str(fd, "address", 500),
      city: str(fd, "city", 100),
      state: str(fd, "state", 100),
      country: str(fd, "country", 100),
      postcode: str(fd, "postcode", 20),
      phone: str(fd, "phone", 50),
      email: str(fd, "email", 200),
      gstin: str(fd, "gstin", 15).toUpperCase(),
      currency,
      timezone,
      check_in_time: time("check_in_time", "14:00"),
      check_out_time: time("check_out_time", "12:00"),
      tax_inclusive: bool(fd, "tax_inclusive"),
      tax_slabs: parsed,
      tax_label: str(fd, "tax_label", 20) || "Tax",
      early_checkin_fee_type: fee("early_checkin_fee_type"),
      early_checkin_fee_value: Math.max(0, num(fd, "early_checkin_fee_value") ?? 0),
      late_checkout_fee_type: fee("late_checkout_fee_type"),
      late_checkout_fee_value: Math.max(0, num(fd, "late_checkout_fee_value") ?? 0),
      hold_hours: int(fd, "hold_hours", 24, 1, 720),
      session_timeout_minutes: int(fd, "session_timeout_minutes", 30, 5, 720),
      password_min_length: int(fd, "password_min_length", 10, 8, 128),
      password_max_age_days: int(fd, "password_max_age_days", 90, 0, 3650),
      max_failed_logins: int(fd, "max_failed_logins", 5, 3, 50),
      lockout_minutes: int(fd, "lockout_minutes", 15, 1, 1440),
      id_document_retention_days: int(fd, "id_document_retention_days", 365, 30, 3650),
      hk_default_minutes: int(fd, "hk_default_minutes", 30, 5, 480),
      hk_deep_clean_days: int(fd, "hk_deep_clean_days", 30, 1, 365),
      default_language: defaultLanguage,
      languages,
      // The prefix goes into the invoice number, so keep it to letters and
      // digits: "INV/2026-27/0001".
      invoice_prefix: str(fd, "invoice_prefix", 10).toUpperCase().replace(/[^A-Z0-9]/g, "") || "INV",
      invoice_terms: str(fd, "invoice_terms", 1000),
      refund_approval_threshold: Math.max(0, num(fd, "refund_approval_threshold") ?? 5000),
      online_payments_enabled: bool(fd, "online_payments_enabled"),
      multi_currency_enabled: bool(fd, "multi_currency_enabled"),
      ar_reminder_days: int(fd, "ar_reminder_days", 7, 0, 180),
      pos_room_charge_limit: Math.max(0, num(fd, "pos_room_charge_limit") ?? 0),
      event_quote_approval_threshold: Math.max(0, num(fd, "event_quote_approval_threshold") ?? 100000),
      event_service_charge_percent: Math.min(100, Math.max(0, num(fd, "event_service_charge_percent") ?? 0)),
      event_advance_percent: Math.min(100, Math.max(0, num(fd, "event_advance_percent") ?? 25)),
      event_terms: str(fd, "event_terms", 4000),
      monthly_operating_cost: Math.max(0, num(fd, "monthly_operating_cost") ?? 0),
      best_rate_message: str(fd, "best_rate_message", 500),
      notify_pre_arrival_days: int(fd, "notify_pre_arrival_days", 3, 0, 30),
      notify_checkin_days: int(fd, "notify_checkin_days", 1, 0, 30),
      notify_post_stay_days: int(fd, "notify_post_stay_days", 1, 0, 30),
      notify_staff_new_booking: bool(fd, "notify_staff_new_booking"),
      notify_staff_vip_arrival: bool(fd, "notify_staff_vip_arrival"),
      notify_staff_ticket_assigned: bool(fd, "notify_staff_ticket_assigned"),
      revenue_auto_approve_percent: Math.min(100, Math.max(0, num(fd, "revenue_auto_approve_percent") ?? 10)),
      revenue_forecast_days: int(fd, "revenue_forecast_days", 60, 7, 365),
      revenue_floor_rate: Math.max(0, num(fd, "revenue_floor_rate") ?? 0),
      revenue_ceiling_rate: Math.max(0, num(fd, "revenue_ceiling_rate") ?? 0),
    })
    .eq("id", current.id);
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin", "layout");
  return { success: "Settings saved." };
}

/**
 * Ends every session a staff member has open (Module 15: session
 * management). Their next page load signs them out; signing in again works.
 */
export async function endStaffSessions(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("staff.manage");
  const id = str(fd, "id", 36);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Staff member not found." };
  if (id === session.staff.id) return { error: "Use Sign out to end your own session." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff")
    .update({ sessions_revoked_at: new Date().toISOString() })
    .eq("id", id)
    .select("full_name, email")
    .single();
  if (error) return { error: friendlyDbError(error.message) };
  await supabase.rpc("log_event", {
    p_module: "staff",
    p_action: "end_sessions",
    p_record_id: id,
    p_summary: `Ended the sessions of ${data.full_name || data.email}`,
  });
  revalidatePath("/admin/staff/activity");
  return { success: `${data.full_name || data.email} is signed out everywhere.` };
}

// ── Session ─────────────────────────────────────────────────────────────────

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  await clearDemoVerified();
  redirect("/admin/login");
}

/** Called by the inactivity timer. */
export async function signOutIdle() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  await clearDemoVerified();
  redirect("/admin/login?reason=idle");
}
