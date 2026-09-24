"use server";

import { createServiceClient } from "./supabase/server";
import { hasSupabaseConfig } from "./supabase/config";

export type FeedbackState = { error?: string; done?: boolean };

/**
 * A guest's feedback from the private link in their final bill email
 * (SOW Module 8: "feedback and review collection after check-out"). The link's
 * token is the only credential, so it works once and only for its stay.
 */
export async function submitGuestFeedback(_prev: FeedbackState, fd: FormData): Promise<FeedbackState> {
  const token = String(fd.get("token") ?? "").slice(0, 64);
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { error: "This feedback link is not valid." };
  if (!hasSupabaseConfig() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "Feedback is not available right now." };

  const score = (k: string) => {
    const v = Number(fd.get(k));
    return Number.isInteger(v) && v >= 1 && v <= 5 ? v : null;
  };
  const overall = score("overall");
  if (!overall) return { error: "Please choose an overall rating." };

  const { data, error } = await createServiceClient()
    .from("guest_feedback")
    .update({
      overall,
      room: score("room"),
      service: score("service"),
      cleanliness: score("cleanliness"),
      food: score("food"),
      comment: String(fd.get("comment") ?? "").trim().slice(0, 2000),
      submitted_at: new Date().toISOString(),
      source: "guest",
    })
    .eq("token", token)
    .is("submitted_at", null)
    .select("id");
  if (error) return { error: "We could not save your feedback. Please try again." };
  if (!data?.length) return { error: "This link has already been used or has expired." };
  return { done: true };
}
