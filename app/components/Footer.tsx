"use client";

import Link from "next/link";
import { MapPin, Phone, Mail, Send } from "lucide-react";
import Reveal from "./Reveal";
import type { RoomType } from "../lib/types";

export default function Footer({ rooms }: { rooms: RoomType[] }) {
  return (
    <footer className="bg-[#141312] border-t border-white/10 text-slate-400 font-sans relative overflow-hidden">
      {/* Main Footer Links & Newsletter */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <Reveal className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Brand Info Column */}
          <div className="lg:col-span-4 space-y-4">
            <div>
              <span className="font-serif text-3xl font-bold tracking-[0.25em] text-[#e6d7c3] uppercase">
                SHAMIYANA
              </span>
              <div className="text-[10px] tracking-[0.3em] text-slate-400 font-sans uppercase">
                HOTEL &bull; SRINAGAR
              </div>
            </div>

            <p className="text-xs text-slate-400 font-light leading-relaxed">
Warm Kashmiri hospitality on the bank of the Jhelum, 1.5 km from Dal Lake.
            </p>

            <div className="space-y-2 text-xs text-slate-300 pt-2">
              <div className="flex items-center space-x-2">
                <MapPin className="w-4 h-4 text-[#e6d7c3] shrink-0" />
                <span>Dal Lake, Boulevard Road, Srinagar 190001, Jammu & Kashmir, India</span>
              </div>
              <div className="flex items-center space-x-2">
                <Phone className="w-4 h-4 text-[#e6d7c3] shrink-0" />
                <span>0194-3500113 &nbsp;|&nbsp; +91 90700 90713 &nbsp;|&nbsp; 0194-3517164</span>
              </div>
              <div className="flex items-center space-x-2">
                <Mail className="w-4 h-4 text-[#e6d7c3] shrink-0" />
                <a href="mailto:info@hotelshamiyana.com" className="hover:text-[#e6d7c3] transition-colors">info@hotelshamiyana.com</a>
              </div>
            </div>
          </div>

          {/* Quick Links Column */}
          <div className="lg:col-span-2 space-y-3">
            <h4 className="font-serif text-base text-white font-medium border-b border-white/10 pb-2">
              Our Rooms
            </h4>
            <ul className="space-y-2 text-xs">
              {rooms.map((room) => (
                <li key={room.id}>
                  <Link href="/rooms" className="hover:text-[#e6d7c3] transition-colors">
                    {room.name} – ₹{Number(room.base_rate).toLocaleString("en-IN")}/night
                  </Link>
                </li>
              ))}
              <li><Link href="/rooms" className="hover:text-[#e6d7c3] transition-colors">All Accommodations</Link></li>
            </ul>
          </div>

          {/* Dining & Experiences Links Column */}
          <div className="lg:col-span-2 space-y-3">
            <h4 className="font-serif text-base text-white font-medium border-b border-white/10 pb-2">
              Hotel
            </h4>
            <ul className="space-y-2 text-xs">
              <li><Link href="/dining" className="hover:text-[#e6d7c3] transition-colors">Shamiyana Restaurant</Link></li>
              <li><Link href="/gallery" className="hover:text-[#e6d7c3] transition-colors">Photo Gallery</Link></li>
              <li><Link href="/about" className="hover:text-[#e6d7c3] transition-colors">Conference &amp; Events</Link></li>
            </ul>
          </div>

          {/* Newsletter Column */}
          <div className="lg:col-span-4 space-y-4">
            <h4 className="font-serif text-base text-white font-medium border-b border-white/10 pb-2">
              The Royal Gazette
            </h4>
            <p className="text-xs text-slate-400 font-light">
Seasonal rates and offers, occasionally.
            </p>

            <form onSubmit={(e) => { e.preventDefault(); alert("Thank you for subscribing to The Royal Gazette."); }} className="space-y-2">
              <div className="flex items-center">
                <input
                  type="email"
                  required
                  placeholder="Enter your email address"
                  className="bg-[#222120] border border-white/10 text-xs text-white px-3.5 py-2.5 rounded-l-full focus:outline-none focus:border-[#e6d7c3] flex-1"
                />
                <button
                  type="submit"
                  className="bg-[#e6d7c3] hover:bg-[#d9c3a3] text-[#1c1b1a] px-4 py-2.5 rounded-r-full font-semibold transition-opacity"
                  aria-label="Subscribe"
                >
                  <Send className="w-4 h-4 text-[#1c1b1a]" />
                </button>
              </div>
              <p className="text-[10px] text-slate-500 italic">
                We honor your privacy. Unsubscribe at any time.
              </p>
            </form>
          </div>
        </Reveal>

        {/* Bottom Copyright */}
        <div className="mt-10 sm:mt-16 pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-4">
          <div>
            © {new Date().getFullYear()} Hotel Shamiyana. All rights reserved.
          </div>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            <Link href="/privacy" className="hover:text-[#e6d7c3] transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-[#e6d7c3] transition-colors">Terms of Service</Link>
            <Link href="/accessibility" className="hover:text-[#e6d7c3] transition-colors">Accessibility</Link>
            <a href="/sitemap.xml" className="hover:text-[#e6d7c3] transition-colors">Sitemap</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
