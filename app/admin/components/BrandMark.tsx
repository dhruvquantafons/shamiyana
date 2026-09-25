import { useId } from "react";

/**
 * The Shamiyana emblem: a ceremonial canopy (a shamiana) drawn in fine gold
 * line — finial, flared roof with seams, scalloped valance and two poles.
 *
 * The gradient id comes from useId because the sidebar renders the mark more
 * than once (mobile bar, drawer, desktop rail), and a gradient referenced by
 * a shared id stops painting when its first copy sits in a hidden subtree.
 */
export default function BrandMark({ className = "w-10 h-10" }: { className?: string }) {
  const gold = `brand-gold-${useId().replace(/:/g, "")}`;
  const stroke = `url(#${gold})`;
  return (
    <svg viewBox="0 0 40 40" className={className} role="img" aria-label="Shamiyana" fill="none">
      <defs>
        <linearGradient id={gold} x1="6" y1="4" x2="34" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f5dc7a" />
          <stop offset="0.45" stopColor="#d4af37" />
          <stop offset="1" stopColor="#a88216" />
        </linearGradient>
      </defs>
      <g stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {/* Roof */}
        <path d="M20 7C15.5 11 10 14.2 5 17h30C30 14.2 24.5 11 20 7Z" />
        {/* Seams */}
        <path d="M20 7.5c-2.6 3.4-5.6 6.6-8 9.5M20 7.5c2.6 3.4 5.6 6.6 8 9.5M20 7.5V17" strokeWidth="1" />
        {/* Scalloped valance */}
        <path d="M5 17q3 3.6 6 0q3 3.6 6 0q3 3.6 6 0q3 3.6 6 0q3 3.6 6 0" />
        {/* Poles and ground */}
        <path d="M8 20v14M32 20v14M4.5 34h31" />
      </g>
      {/* Finial */}
      <circle cx="20" cy="4.6" r="1.5" fill={stroke} />
    </svg>
  );
}
