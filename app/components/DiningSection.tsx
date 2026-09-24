"use client";

import Image from "next/image";
import { UtensilsCrossed, Coffee, Clock } from "lucide-react";
import Reveal from "./Reveal";
import { useBooking } from "./SiteShell";

const FACTS = [
  { icon: UtensilsCrossed, label: "Kashmiri Wazwan & multi-cuisine" },
  { icon: Coffee, label: "Breakfast, Kahwa & all-day snacks" },
  { icon: Clock, label: "In-room dining around the clock" },
];

export default function DiningSection() {
  const { openBooking } = useBooking();
  return (
    <section id="dining" className="py-14 sm:py-20 bg-[#141312] text-slate-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          {/* Photograph */}
          <div className="relative h-72 sm:h-80 rounded-xl overflow-hidden border border-white/10 shadow-2xl group">
            <Image
              src="/gallery/10.jpg"
              alt="Dining room laid for service at Hotel Shamiyana"
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover group-hover:scale-[1.06] transition-transform duration-[900ms] ease-out"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          </div>

          {/* Copy */}
          <div className="space-y-5">
            <p className="text-sm text-slate-400 font-light leading-relaxed max-w-md">
              Traditional Kashmiri Wazwan alongside familiar international dishes,
              served through the day.
            </p>

            <ul className="space-y-2.5 pt-1">
              {FACTS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2.5 text-sm text-slate-300">
                  <Icon className="w-4 h-4 text-[#e6d7c3] shrink-0" />
                  <span className="font-light">{label}</span>
                </li>
              ))}
            </ul>

            <button
              onClick={() => openBooking()}
              className="mt-2 px-6 py-3 text-xs uppercase tracking-[0.2em] font-semibold text-[#1c1b1a] bg-[#e6d7c3] hover:bg-[#d9c3a3] rounded-full transition-colors cursor-pointer sheen"
            >
              Enquire about a table
            </button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
