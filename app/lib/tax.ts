/**
 * Tax on room charges.
 *
 * Indian accommodation GST is charged by slab on the value of one room for one
 * night, so the rate depends on the price itself. Slabs are configured in
 * property settings; the seeded ones are the rates in force from
 * 22 September 2025 (5% up to ₹7,500, 18% above).
 */

export interface TaxSlab {
  /** Highest nightly value (before tax) in this slab. Null for the top slab. */
  up_to: number | null;
  /** Percent. */
  rate: number;
}

export interface TaxSplit {
  net: number;
  tax: number;
  rate: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function sortedSlabs(slabs: TaxSlab[]) {
  return [...slabs].sort((a, b) => (a.up_to ?? Infinity) - (b.up_to ?? Infinity));
}

/**
 * Splits one room-night's price into net and tax.
 *
 * When prices are tax-inclusive the slab has to be found from the net value,
 * which depends on the slab — so each slab is tried in turn and the first one
 * whose implied net value fits is used.
 */
export function splitRoomTax(amount: number, slabs: TaxSlab[], inclusive: boolean): TaxSplit {
  if (amount <= 0 || slabs.length === 0) return { net: round2(Math.max(amount, 0)), tax: 0, rate: 0 };

  const ordered = sortedSlabs(slabs);

  if (!inclusive) {
    const slab = ordered.find((s) => s.up_to === null || amount <= s.up_to) ?? ordered[ordered.length - 1];
    return { net: round2(amount), tax: round2((amount * slab.rate) / 100), rate: slab.rate };
  }

  for (const slab of ordered) {
    const net = amount / (1 + slab.rate / 100);
    if (slab.up_to === null || net <= slab.up_to) {
      const netRounded = round2(net);
      return { net: netRounded, tax: round2(amount - netRounded), rate: slab.rate };
    }
  }

  const top = ordered[ordered.length - 1];
  const net = round2(amount / (1 + top.rate / 100));
  return { net, tax: round2(amount - net), rate: top.rate };
}

/** Parses the jsonb column defensively; a bad value means no tax, not a crash. */
export function parseTaxSlabs(value: unknown): TaxSlab[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (s): s is TaxSlab =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as TaxSlab).rate === "number" &&
        ((s as TaxSlab).up_to === null || typeof (s as TaxSlab).up_to === "number"),
    )
    .map((s) => ({ up_to: s.up_to, rate: s.rate }));
}
