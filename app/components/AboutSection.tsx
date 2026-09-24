"use client";

import Image from "next/image";
import Link from "next/link";
import Reveal from "./Reveal";
import {
  Sparkles,
  MapPin,
  BedDouble,
  Utensils,
  Building2,
  ArrowUpRight,
} from "lucide-react";

/** Room counts, exactly as the hotel publishes them. */
const INVENTORY = [
  { count: "33", label: "Deluxe Rooms" },
  { count: "03", label: "Royal Suites" },
  { count: "02", label: "Presidential Suites" },
];

/** In-room amenities listed on the hotel's About page. */
const AMENITIES = [
  "LED TV",
  "Mini Bar",
  "Air Conditioning / Centralised Heating",
  "Tea & Coffee Maker",
  "Electronic Locks",
];

const FEATURES = [
  {
    icon: MapPin,
    title: "Prime Location",
    description: "1.5 km from Dal Lake and Lal Chowk, on the bank of the Jhelum.",
  },
  {
    icon: BedDouble,
    title: "Newly Refurbished",
    description: "Every room given a new look, with modern in-room amenities.",
  },
  {
    icon: Utensils,
    title: "Kashmiri Dining",
    description: "Traditional Wazwan and freshly brewed Kahwa.",
  },
  {
    icon: Building2,
    title: "Conference & Events",
    description: "Versatile meeting space for events and residential conferences.",
  },
];

export default function AboutSection() {
  return (
    <section id="about" className="py-14 sm:py-24 bg-[#f9f8f5] text-[#1c1b1a] relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 sm:gap-12 items-center">
          {/* Left Visual Column */}
          <Reveal className="lg:col-span-6 relative">
            <div className="relative rounded-xl overflow-hidden border border-[#e5e0d8] shadow-xl group">
              <Image
                src="/gallery/1.jpg"
                width={1560}
                height={1080}
                alt="Hotel Shamiyana building exterior and reception entrance in Srinagar"
                className="w-full h-[340px] sm:h-[520px] object-cover filter contrast-[1.03] group-hover:scale-105 transition-transform duration-700"
              />

              {/* Location Emblem */}
              <div className="absolute bottom-6 left-6 right-6 bg-white/90 backdrop-blur-md p-4 rounded-lg border border-[#e5e0d8] shadow-lg flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-widest text-[#a88956] font-semibold flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#a88956]" />
                    <span>Hotel Shamiyana</span>
                  </div>
                  <div className="text-sm font-serif text-[#1c1b1a] font-medium mt-0.5">
                    At the bank of the Jhelum River, Srinagar
                  </div>
                </div>
                <div className="text-right pl-4 border-l border-[#e5e0d8]">
                  <div className="font-serif text-xl font-bold text-[#a88956]">1.5 km</div>
                  <div className="text-[10px] text-[#7a7771] tracking-wider font-sans">
                    FROM DAL LAKE
                  </div>
                </div>
              </div>
            </div>

            {/* Secondary Accent Image Overlay */}
            <div className="hidden sm:block absolute -bottom-8 -right-8 w-56 h-56 rounded-xl overflow-hidden border-4 border-white shadow-2xl">
              <Image
                src="/gallery/8.jpg"
                fill
                sizes="224px"
                alt="Reception lobby and front desk at Hotel Shamiyana"
                className="w-full h-full object-cover"
              />
            </div>
          </Reveal>

          {/* Right Text Content Column */}
          <Reveal delay={120} className="lg:col-span-6 space-y-6">
            <p className="text-[#5a5854] text-sm sm:text-base font-light leading-relaxed tracking-wide">
              Hotel Shamiyana is situated at a prime location in the valley of
              Kashmir — suited to leisure and corporate travellers alike, and an ideal
              venue for a comfortable stay.
            </p>

            {/* Inventory, as published */}
            <div className="grid grid-cols-3 gap-3 py-2">
              {INVENTORY.map(({ count, label }) => (
                <div
                  key={label}
                  className="text-center px-2 py-3 rounded-lg bg-white border border-[#e5e0d8]"
                >
                  <div className="font-serif text-2xl sm:text-3xl font-light text-[#a88956] leading-none">
                    {count}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-[#7a7771] mt-1.5 leading-tight">
                    {label}
                  </div>
                </div>
              ))}
            </div>

            {/* In-room amenities */}
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#9a9490] font-semibold mb-2.5">
                In every room
              </p>
              <ul className="flex flex-wrap gap-2">
                {AMENITIES.map((item) => (
                  <li
                    key={item}
                    className="text-[11px] px-3 py-1.5 rounded-full bg-white border border-[#e5e0d8] text-[#5a5854]"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Feature Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              {FEATURES.map((feat) => {
                const IconComp = feat.icon;
                return (
                  <div
                    key={feat.title}
                    className="hover-lift p-4 rounded-lg bg-white border border-[#e5e0d8] hover:border-[#d9c3a3] shadow-sm group"
                  >
                    <div className="w-9 h-9 rounded-full bg-[#f5f3ef] flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                      <IconComp className="w-4 h-4 text-[#a88956]" />
                    </div>
                    <h3 className="font-serif text-base text-[#1c1b1a] font-medium mb-1">
                      {feat.title}
                    </h3>
                    <p className="text-xs text-[#7a7771] leading-relaxed font-light">
                      {feat.description}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Action link */}
            <div className="pt-2">
              <Link
                href="/rooms"
                className="inline-flex items-center space-x-2 text-xs uppercase tracking-[0.2em] text-[#1c1b1a] hover:text-[#a88956] transition-colors group font-semibold"
              >
                <span>Explore Our Rooms</span>
                <ArrowUpRight className="w-4 h-4 text-[#a88956] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </Link>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
