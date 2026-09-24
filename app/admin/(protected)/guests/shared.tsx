import type { GuestTag } from "../../../lib/types";
import { Tag } from "../../components/ui";

const TONE: Record<GuestTag, "gold" | "red" | "blue" | "violet"> = {
  VIP: "gold",
  Blacklisted: "red",
  "Repeat Guest": "blue",
  Corporate: "violet",
};

export function GuestTags({ tags }: { tags: GuestTag[] }) {
  return (
    <>
      {tags.map((t) => (
        <Tag key={t} tone={TONE[t]}>
          {t}
        </Tag>
      ))}
    </>
  );
}

/** Digits only, last ten — so +91 98765 43210 and 09876543210 match. */
export const phoneKey = (phone: string | null) => (phone ?? "").replace(/\D/g, "").slice(-10);
