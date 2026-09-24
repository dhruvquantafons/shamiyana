"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../lib/supabase/server";
import { requireSession, requirePermission } from "../lib/auth";
import { friendlyDbError } from "../lib/db-errors";
import { LANGUAGES } from "../lib/types";
import { CENTRAL_CONFIG_ITEMS, type CentralConfigItem } from "../lib/types";
import { type ActionState, str, int, bool } from "./form-utils";

/**
 * Module 14 — the group: switching between properties, adding one, and
 * pushing head office's standards down to them.
 *
 * Every one of these goes through a database function rather than writing the
 * tables directly. That is not ceremony: switching property decides what every
 * later query in the session can see, so the check that you actually work at
 * that property belongs next to the write, in one place, rather than in each
 * screen that offers the choice.
 */

/**
 * Moves the signed-in staff member to another property.
 *
 * set_active_property() refuses a property they do not work at, so a forged
 * form post changes nothing. Revalidates the whole admin layout because the
 * answer to "which property" changes every page under it.
 */
export async function switchProperty(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const id = str(fd, "property_id", 36);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Choose a property." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_active_property", { p_property: id });
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin", "layout");
  return { success: "Switched property." };
}

export async function createProperty(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("properties.manage");

  const code = str(fd, "code", 10).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const name = str(fd, "name", 200);
  if (!code) return { error: "Give the property a short code, such as DL." };
  if (!name) return { error: "Give the property a name." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_property", {
    p_code: code,
    p_name: name,
    p_brand: str(fd, "brand", 100),
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin", "layout");
  return { success: `${name} is set up. Add its rooms, rates and staff next.` };
}

/** Name, brand and whether the property is open for business. */
export async function saveProperty(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("properties.manage");

  const id = str(fd, "property_id", 36);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "We could not find that property." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("properties")
    .update({
      name: str(fd, "name", 200) || "Hotel",
      brand: str(fd, "brand", 100),
      is_active: bool(fd, "is_active"),
      sort_order: int(fd, "sort_order", 0, 0, 999),
    })
    .eq("id", id);
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin", "layout");
  return { success: "Saved." };
}

/**
 * Chooses which property the public website sells.
 *
 * Only one can, because the website has one address and one tariff page. It is
 * also the property that anything with no staff session behind it belongs to:
 * a booking request from the site, a payment webhook, a nightly job.
 */
export async function setDefaultProperty(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("properties.manage");

  const id = str(fd, "property_id", 36);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "We could not find that property." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_default_property", { p_property: id });
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin", "layout");
  revalidatePath("/", "layout");
  return { success: "The website now sells this property." };
}

/** Head office's own copy of the standards, before they are pushed anywhere. */
export async function saveGroupSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("properties.manage");

  const defaultLanguage = str(fd, "default_language", 2) in LANGUAGES ? str(fd, "default_language", 2) : "en";
  const languages = [
    ...new Set([defaultLanguage, ...fd.getAll("languages").map(String).filter((l) => l in LANGUAGES)]),
  ];

  const supabase = await createClient();
  const { data: row } = await supabase.from("group_settings").select("id").maybeSingle();
  if (!row) return { error: "Group settings are not set up yet." };

  const { error } = await supabase
    .from("group_settings")
    .update({
      group_name: str(fd, "group_name", 200) || "Group",
      best_rate_message: str(fd, "best_rate_message", 500),
      invoice_terms: str(fd, "invoice_terms", 1000),
      event_terms: str(fd, "event_terms", 4000),
      default_language: defaultLanguage,
      languages,
      loyalty_enabled: bool(fd, "loyalty_enabled"),
      loyalty_program_name: str(fd, "loyalty_program_name", 60) || "Rewards",
      loyalty_expiry_months: int(fd, "loyalty_expiry_months", 24, 0, 120),
      loyalty_min_redeem_points: int(fd, "loyalty_min_redeem_points", 500, 0, 1_000_000),
      tax_label: str(fd, "tax_label", 20) || "Tax",
      tax_inclusive: bool(fd, "tax_inclusive"),
    })
    .eq("id", row.id);
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin/properties");
  return { success: "Group standards saved. Push them when you are ready." };
}

/**
 * Copies the chosen standards from head office into the chosen properties.
 *
 * Deliberately a copy rather than a link: a property that has been pushed to
 * can still be adjusted locally afterwards, which is what a standard is, as
 * opposed to a lock. Pushing again overwrites the local change, which is how
 * head office wins an argument.
 */
export async function pushCentralConfig(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("properties.manage");

  const items = fd
    .getAll("items")
    .map(String)
    .filter((i): i is CentralConfigItem => i in CENTRAL_CONFIG_ITEMS);
  if (items.length === 0) return { error: "Choose at least one thing to push." };

  // No properties chosen means every active one, which is the common case and
  // what the SOW asks for ("pushed from head office to all properties").
  const chosen = fd
    .getAll("properties")
    .map(String)
    .filter((p) => /^[0-9a-f-]{36}$/i.test(p));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("push_central_config", {
    p_items: items,
    p_properties: chosen.length > 0 ? chosen : null,
  });
  if (error) return { error: friendlyDbError(error.message) };

  const n = Number(data ?? 0);
  revalidatePath("/admin", "layout");
  return { success: `Pushed to ${n} propert${n === 1 ? "y" : "ies"}.` };
}
