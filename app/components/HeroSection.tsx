"use client";

import { useState, useEffect } from "react";
import { Calendar, Users, ChevronRight, Sparkles, MapPin, Award } from "lucide-react";
import Link from "next/link";
import type { RoomType } from "../lib/types";
import { todayIso, isoPlusDays } from "../lib/dates";
import { useBooking } from "./SiteShell";

interface HeroSectionProps {
  rooms: RoomType[];
}

const HERO_SLIDES = [
  {
    id: 1,
    image: "https://images.unsplash.com/photo-1566073771259-6a8506099945?q=80&w=2070&auto=format&fit=crop",
    tagline: "HOTEL SHAMIYANA",
    heading: "Where Valley Serenity Meets Warm Hospitality",
    subtext: "Nestled in Srinagar near the scenic Jhelum River, experience refined rooms, authentic Kashmiri hospitality, and peaceful valley charm.",
  },
  {
    id: 2,
    image: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?q=80&w=2070&auto=format&fit=crop",
    tagline: "ELEGANT COMFORTS",
    heading: "Thoughtfully Designed Deluxe Accommodations",
    subtext: "Relax in rooms featuring handcrafted Kashmiri woodwork, comfortable bedding, modern conveniences, and dedicated round-the-clock service.",
  },
  {
    id: 3,
    image: "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?q=80&w=2070&auto=format&fit=crop",
    tagline: "EPICUREAN HAVEN",
    heading: "Authentic Kashmiri Dining Culinary Delights",
    subtext: "Savor exquisite Kashmiri Wazwan heritage recipes and international favorites crafted with the freshest local ingredients.",
  },
];

export default function HeroSection({ rooms }: HeroSectionProps) {
  const { openBooking } = useBooking();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const [takenOver, setTakenOver] = useState(false);

  // Quick reservation state
  const [checkIn, setCheckIn] = useState(todayIso);
  const [checkOut, setCheckOut] = useState(() => isoPlusDays(1));
  const [guests, setGuests] = useState(2);
  const [roomType, setRoomType] = useState(rooms[0]?.name ?? "");

  useEffect(() => {
    // Someone who asked for reduced motion gets a still hero, and anyone who
    // chooses a slide has taken control, so stop advancing under them.
    if (paused || takenOver) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % HERO_SLIDES.length);
    }, 7000);
    return () => clearInterval(interval);
  }, [paused, takenOver]);

  const handleQuickBook = (e: React.FormEvent) => {
    e.preventDefault();
    openBooking(roomType);
  };

  return (
    <section
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className="relative min-h-screen flex flex-col justify-between pt-24 sm:pt-32 pb-8 sm:pb-12 overflow-hidden bg-[#070c12]"
    >
      {/* Background Media Carousel */}
      <div className="absolute inset-0 z-0">
        {HERO_SLIDES.map((slide, index) => (
          <div
            key={slide.id}
            aria-hidden={index !== currentSlide}
            className={`absolute inset-0 transition-opacity duration-[1200ms] ease-in-out ${
              index === currentSlide ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
          >
            <img
              key={`${slide.id}-${index === currentSlide ? currentSlide : "idle"}`}
              src={slide.image}
              alt={slide.heading}
              className={`w-full h-full object-cover filter brightness-[0.68] contrast-[1.08] ${
                index === currentSlide ? "animate-ken-burns" : "scale-[1.06]"
              }`}
            />
            {/* Gradient Overlays for Readability & Depth */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#0b131b] via-[#0b131b]/40 to-black/60" />
            <div className="absolute inset-0 bg-radial from-transparent via-black/30 to-black/70" />
          </div>
        ))}
      </div>

      {/* Floating Controls Bar (Positioned below main sticky header) */}
      <div className="relative z-10 max-w-7xl mx-auto px-4 w-full flex items-center text-xs text-amber-100/80 mb-4 pt-4">
        <div className="flex items-center space-x-2 bg-black/50 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-amber-500/20 shadow-lg">
          <MapPin className="w-3.5 h-3.5 text-[#d4af37]" />
          <span className="tracking-wider uppercase text-[11px] font-medium text-slate-200">Srinagar • Kashmir</span>
        </div>
      </div>

      {/* Main Hero Content */}
      <div className="relative z-10 max-w-5xl mx-auto px-4 text-center my-auto py-6 sm:py-12">
        <div
          key={`tagline-${currentSlide}`}
          className="animate-fade-up inline-flex items-center space-x-2 px-3 sm:px-4 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-200 text-[10px] sm:text-xs tracking-[0.18em] sm:tracking-[0.3em] uppercase mb-4 sm:mb-6"
        >
          <Award className="w-3.5 h-3.5 text-[#d4af37]" />
          <span>{HERO_SLIDES[currentSlide].tagline}</span>
        </div>

        <h1
          key={`heading-${currentSlide}`}
          className="animate-fade-up font-serif text-3xl sm:text-5xl md:text-7xl font-light text-white tracking-normal sm:tracking-wide leading-[1.15] sm:leading-tight mb-4 sm:mb-6 drop-shadow-2xl"
          style={{ animationDelay: "80ms" }}
        >
          {HERO_SLIDES[currentSlide].heading.split(" ").map((word, i) => (
            <span key={i} className={word === "Majesty" || word === "Tranquility" || word === "Imperial" || word === "Fine" ? "gold-text-gradient font-normal italic" : ""}>
              {word}{" "}
            </span>
          ))}
        </h1>

        <p
          key={`subtext-${currentSlide}`}
          className="animate-fade-up max-w-2xl mx-auto text-xs sm:text-base text-slate-300 font-light tracking-wide sm:tracking-widest leading-relaxed mb-6 sm:mb-8 drop-shadow-md"
          style={{ animationDelay: "160ms" }}
        >
          {HERO_SLIDES[currentSlide].subtext}
        </p>

        {/* Action Buttons */}
        <div className="flex flex-row items-stretch justify-center gap-2.5 sm:gap-4">
          <button
            onClick={() => openBooking()}
            className="flex-1 sm:flex-initial px-4 sm:px-8 py-3 sm:py-3.5 text-[10px] sm:text-xs uppercase tracking-[0.12em] sm:tracking-[0.25em] font-semibold text-[#1c1b1a] bg-[#e6d7c3] hover:bg-[#d9c3a3] rounded-full shadow-lg transition-all transform hover:-translate-y-0.5 cursor-pointer flex items-center justify-center gap-1.5 sm:gap-2 sheen"
          >
            <span>Book Your Room</span>
            <ChevronRight className="w-4 h-4 text-[#1c1b1a]" />
          </button>

          <Link
            href="/rooms"
            className="flex-1 sm:flex-initial px-4 sm:px-8 py-3 sm:py-3.5 text-[10px] sm:text-xs uppercase tracking-[0.12em] sm:tracking-[0.25em] font-medium text-white hover:text-amber-100 bg-black/30 hover:bg-black/50 border border-white/30 rounded-full backdrop-blur-md transition-all flex items-center justify-center gap-2"
          >
            <span>View All Rooms</span>
          </Link>
        </div>

        {/* Slide Indicators */}
        <div className="flex items-center justify-center space-x-3 mt-6 sm:mt-10">
          {HERO_SLIDES.map((_, idx) => (
            <button
              key={idx}
              onClick={() => {
                setCurrentSlide(idx);
                setTakenOver(true);
              }}
              className={`h-1 transition-all duration-500 rounded-full ${
                idx === currentSlide ? "w-10 bg-[#e6d7c3]" : "w-3 bg-white/30 hover:bg-white/60"
              }`}
              aria-label={`Show slide ${idx + 1} of ${HERO_SLIDES.length}`}
              aria-current={idx === currentSlide}
            />
          ))}
        </div>
      </div>

      {/* Integrated Quick Reservation Bar at Hero Bottom */}
      <div className="relative z-20 max-w-6xl mx-auto px-4 w-full mt-4 sm:mt-6">
        <form
          onSubmit={handleQuickBook}
          className="bg-[#1c1b1a]/80 backdrop-blur-xl p-3 sm:p-5 rounded-xl shadow-2xl border border-white/10 grid grid-cols-2 lg:grid-cols-5 gap-2.5 sm:gap-4 items-end"
        >
          {/* Check-In */}
          <div className="flex flex-col space-y-1 sm:space-y-1.5">
            <label className="text-[9px] sm:text-[10px] uppercase tracking-wider sm:tracking-widest text-slate-300 font-medium flex items-center gap-1 sm:gap-1.5 truncate">
              <Calendar className="w-3 h-3 text-[#d9c3a3]" /> Check-In Date
            </label>
            <input
              type="date"
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
              className="bg-[#2a2927] border border-white/10 text-[11px] sm:text-xs text-white rounded-lg px-2.5 sm:px-3 py-2 sm:py-2.5 focus:outline-none focus:border-[#d9c3a3] w-full"
            />
          </div>

          {/* Check-Out */}
          <div className="flex flex-col space-y-1 sm:space-y-1.5">
            <label className="text-[9px] sm:text-[10px] uppercase tracking-wider sm:tracking-widest text-slate-300 font-medium flex items-center gap-1 sm:gap-1.5 truncate">
              <Calendar className="w-3 h-3 text-[#d9c3a3]" /> Check-Out Date
            </label>
            <input
              type="date"
              value={checkOut}
              onChange={(e) => setCheckOut(e.target.value)}
              className="bg-[#2a2927] border border-white/10 text-[11px] sm:text-xs text-white rounded-lg px-2.5 sm:px-3 py-2 sm:py-2.5 focus:outline-none focus:border-[#d9c3a3] w-full"
            />
          </div>

          {/* Guests */}
          <div className="flex flex-col space-y-1 sm:space-y-1.5">
            <label className="text-[9px] sm:text-[10px] uppercase tracking-wider sm:tracking-widest text-slate-300 font-medium flex items-center gap-1 sm:gap-1.5 truncate">
              <Users className="w-3 h-3 text-[#d9c3a3]" /> Guests & Rooms
            </label>
            <select
              value={guests}
              onChange={(e) => setGuests(Number(e.target.value))}
              className="bg-[#2a2927] border border-white/10 text-[11px] sm:text-xs text-white rounded-lg px-2.5 sm:px-3 py-2 sm:py-2.5 focus:outline-none focus:border-[#d9c3a3] w-full"
            >
              <option value={1}>1 Guest • 1 Room</option>
              <option value={2}>2 Guests • 1 Room</option>
              <option value={3}>3 Guests • 1 Family Room</option>
              <option value={4}>4 Guests • 2 Rooms</option>
            </select>
          </div>

          {/* Room Category */}
          <div className="col-span-2 lg:col-span-1 flex flex-col space-y-1 sm:space-y-1.5">
            <label className="text-[9px] sm:text-[10px] uppercase tracking-wider sm:tracking-widest text-slate-300 font-medium flex items-center gap-1 sm:gap-1.5 truncate">
              <Sparkles className="w-3 h-3 text-[#d9c3a3]" /> Room Category
            </label>
            <select
              value={roomType}
              onChange={(e) => setRoomType(e.target.value)}
              className="bg-[#2a2927] border border-white/10 text-[11px] sm:text-xs text-white rounded-lg px-2.5 sm:px-3 py-2 sm:py-2.5 focus:outline-none focus:border-[#d9c3a3] w-full truncate"
            >
              {rooms.map((room) => (
                <option key={room.id} value={room.name}>
                  {room.name}
                </option>
              ))}
            </select>
          </div>

          {/* Submit Search */}
          <button
            type="submit"
            className="col-span-2 lg:col-span-1 w-full py-2.5 px-4 bg-[#e6d7c3] hover:bg-[#d9c3a3] text-[#1c1b1a] font-semibold text-[11px] sm:text-xs uppercase tracking-wider sm:tracking-widest rounded-lg transition-all shadow-md flex items-center justify-center space-x-2 cursor-pointer h-[38px]"
          >
            <span>Check Rates</span>
            <ChevronRight className="w-4 h-4 text-[#1c1b1a]" />
          </button>
        </form>
      </div>
    </section>
  );
}
