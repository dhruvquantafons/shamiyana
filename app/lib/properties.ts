import "server-only";
import { cache } from "react";
import { createClient } from "./supabase/server";
import { hasSupabaseConfig } from "./supabase/config";
import type { GroupAvailability, GroupPerformance, GroupSettings, Property } from "./types";

/**
 * The group of hotels this installation runs (SOW Module 14).
 *
 * One idea underpins all of it: the database, not the browser, decides which
 * property a request is about. current_property() reads the signed-in staff
 * member's selection from their own row, every property_id column defaults to
 * it, and a restrictive row level security policy on every table holds reads
 * and writes to the properties that person works at. So a page that forgets to
 * filter shows too little, never too much.
 *
 * What lives here is the group-level view of that: listing properties,
 * switching between them, and the two functions that deliberately look across
 * all of them at once.
 */

/**
 * Every property the signed-in staff member may work at, in display order.
 *
 * Scoped by the properties_select policy, so this is already "theirs" — a
 * general manager gets one row, a group owner gets all of them.
 */
export const getProperties = cache(async (): Promise<Property[]> => {
  if (!hasSupabaseConfig()) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("properties")
    .select("*")
    .order("sort_order")
    .order("name");
  return (data ?? []) as Property[];
});

/** The property the staff member is currently working in, or null. */
export const getCurrentProperty = cache(async (): Promise<Property | null> => {
  if (!hasSupabaseConfig()) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("current_property");
  if (!data) return null;
  const properties = await getProperties();
  return properties.find((p) => p.id === data) ?? null;
});

/**
 * True when there is more than one property to choose between.
 *
 * Used to keep the property switcher and the group screens out of the way of a
 * single hotel, which is what every installation starts as. Nothing is
 * disabled by this — it is presentation only, and the database enforces the
 * separation either way.
 */
export const isMultiProperty = cache(async (): Promise<boolean> => {
  return (await getProperties()).length > 1;
});

/** Head office's copy of the settings it can push down. */
export const getGroupSettings = cache(async (): Promise<GroupSettings | null> => {
  if (!hasSupabaseConfig()) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("group_settings").select("*").maybeSingle();
  return (data as GroupSettings) ?? null;
});

/**
 * Each property's performance side by side.
 *
 * SOW Module 14: "Central dashboard showing all properties' performance side
 * by side" and "compare occupancy/revenue across properties in one report".
 */
export async function loadGroupPerformance(from: string, to: string): Promise<GroupPerformance[]> {
  if (!hasSupabaseConfig()) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("group_dashboard", { p_from: from, p_to: to });
  return (data ?? []) as GroupPerformance[];
}

/**
 * Rooms free at every property for a set of dates, so the desk can place a
 * guest at whichever hotel has space (SOW Module 14: "Central reservation
 * option — book any property from one screen").
 */
export async function loadGroupAvailability(
  checkIn: string,
  checkOut: string,
): Promise<GroupAvailability[]> {
  if (!hasSupabaseConfig()) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("group_availability", {
    p_check_in: checkIn,
    p_check_out: checkOut,
  });
  return (data ?? []) as GroupAvailability[];
}
