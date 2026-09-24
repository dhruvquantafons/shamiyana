"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/client";

/**
 * Re-renders the page when another desk changes bookings, rooms or blocks
 * (SOW §3.2: "room status, bookings and dashboards update live across all
 * connected users without a page refresh").
 *
 * Uses Supabase Realtime, which applies row level security to the events it
 * delivers. Bursts of changes (night audit, a group booking) are coalesced
 * into one refresh.
 */
export default function LiveRefresh({ tables = ["bookings", "rooms", "room_blocks"] }: { tables?: string[] }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = tables.join(",");

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`live:${key}:${Math.random().toString(36).slice(2)}`);

    for (const table of key.split(",")) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => router.refresh(), 800);
      });
    }
    channel.subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [key, router]);

  return null;
}
