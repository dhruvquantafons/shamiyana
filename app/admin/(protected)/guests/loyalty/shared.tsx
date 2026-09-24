import type { LoyaltyTier } from "../../../../lib/types";
import { Tag } from "../../../components/ui";

/** The tier colours an administrator may choose, mapped onto the shared Tag
 *  tones. Anything unrecognised falls back to neutral rather than breaking. */
const TONES = {
  slate: "neutral",
  gold: "gold",
  amber: "amber",
  green: "green",
  red: "red",
  blue: "blue",
  violet: "violet",
} as const;

type Tone = (typeof TONES)[keyof typeof TONES];

export function TierTag({ tier }: { tier: LoyaltyTier | null }) {
  if (!tier) return <span className="text-slate-400">Not a member</span>;
  const tone: Tone = TONES[tier.colour as keyof typeof TONES] ?? "neutral";
  return <Tag tone={tone}>{tier.name}</Tag>;
}
