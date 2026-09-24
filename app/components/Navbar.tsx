"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Phone, Menu, X, Calendar } from "lucide-react";
import { useBooking } from "./SiteShell";

export default function Navbar() {
  const { openBooking } = useBooking();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href;

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 30);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Hold the page still behind the open drawer, and close it on Escape.
  useEffect(() => {
    if (!mobileMenuOpen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileMenuOpen]);

  const navLinks = [
    { name: "Rooms", href: "/rooms" },
    { name: "Dining", href: "/dining" },
    { name: "Gallery", href: "/gallery" },
    { name: "About", href: "/about" },
    // Reachable whether or not anyone is signed in; the page itself decides
    // between the sign-in form and the guest's bookings, which keeps every
    // other public page statically rendered.
    { name: "My Bookings", href: "/account" },
  ];

  return (
    <>
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled
          ? "bg-[#f9f8f5]/95 backdrop-blur-md shadow-sm py-4 border-b border-[#e5e0d8]"
          : "bg-gradient-to-b from-black/80 via-black/40 to-transparent py-5"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3">
        {/* Brand Logo */}
        <Link href="/" className="group flex flex-col items-start focus:outline-none">
          <span
            className={`font-serif text-lg sm:text-2xl lg:text-3xl font-bold tracking-[0.12em] sm:tracking-[0.2em] uppercase whitespace-nowrap group-hover:opacity-80 transition-all duration-300 ${
              scrolled ? "text-[#1c1b1a]" : "text-white"
            }`}
          >
            SHAMIYANA
          </span>
          <span
            className={`text-[8px] sm:text-[9px] tracking-[0.2em] sm:tracking-[0.3em] uppercase -mt-0.5 font-light whitespace-nowrap ${
              scrolled ? "text-[#7a7771]" : "text-amber-100/80"
            }`}
          >
            HOTEL &bull; SRINAGAR
          </span>
        </Link>

        {/* Center Nav Links */}
        <nav className="hidden md:flex items-center space-x-8">
          {navLinks.map((link) => (
            <Link
              key={link.name}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={`link-underline text-xs uppercase tracking-[0.2em] transition-colors duration-300 font-medium py-1 ${
                isActive(link.href)
                  ? scrolled
                    ? "text-[#a88956]"
                    : "text-amber-200"
                  : scrolled
                    ? "text-[#2c2b29] hover:text-[#a88956]"
                    : "text-slate-100 hover:text-amber-200"
              }`}
            >
              {link.name}
            </Link>
          ))}
        </nav>

        {/* Right Action */}
        <div className="hidden sm:flex items-center space-x-6">
          <a
            href="tel:+919070090713"
            className={`flex items-center space-x-2 text-xs transition-colors group ${
              scrolled ? "text-[#4a4843] hover:text-[#1c1b1a]" : "text-slate-200 hover:text-white"
            }`}
          >
            <Phone className="w-3.5 h-3.5 text-[#b89c72]" />
            <span className="hidden xl:inline text-[11px] tracking-wider font-mono">+91 90700 90713</span>
          </a>

          <button
            onClick={() => openBooking()}
            className="px-6 py-2.5 text-xs uppercase tracking-[0.2em] font-semibold text-[#1c1b1a] transition-all duration-300 rounded-full bg-[#e6d7c3] hover:bg-[#d9c3a3] shadow-md cursor-pointer flex items-center gap-2 sheen"
          >
            <Calendar className="w-3.5 h-3.5 text-[#1c1b1a]" />
            <span>Book Stay</span>
          </button>
        </div>

        {/* Mobile Menu Trigger */}
        <div className="flex md:hidden items-center space-x-3">
          <button
            onClick={() => openBooking()}
            className="px-3.5 py-1.5 text-[10px] uppercase tracking-widest font-semibold text-[#1c1b1a] bg-[#e6d7c3] rounded-full"
          >
            Book
          </button>

          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className={`p-1 focus:outline-none ${scrolled ? "text-[#1c1b1a]" : "text-white"}`}
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

    </header>

    {/* Mobile Drawer */}
    {mobileMenuOpen && (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className="fixed inset-0 z-[60] bg-[#0b131b] flex flex-col justify-between p-6 overflow-y-auto md:hidden animate-fade-in"
      >
        <div>
          <div className="flex items-center justify-between mb-8 pb-4 border-b border-amber-500/20">
            <div>
              <div className="font-serif text-2xl font-bold tracking-widest gold-text-gradient">
                SHAMIYANA
              </div>
              <div className="text-[9px] tracking-widest text-amber-200/60 uppercase">
                Hotel &bull; Srinagar
              </div>
            </div>
            <button
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close menu"
              className="text-amber-200 hover:text-white p-2 cursor-pointer"
            >
              <X className="w-7 h-7" />
            </button>
          </div>

          <nav className="flex flex-col space-y-5">
            {navLinks.map((link, i) => (
              <Link
                key={link.name}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                aria-current={isActive(link.href) ? "page" : undefined}
                style={{ animationDelay: `${i * 60}ms` }}
                className={`animate-fade-up font-serif text-xl tracking-wider transition-colors border-b border-white/5 pb-2 ${
                  isActive(link.href)
                    ? "text-[#d4af37]"
                    : "text-slate-200 hover:text-[#d4af37]"
                }`}
              >
                {link.name}
              </Link>
            ))}
          </nav>
        </div>

        <div className="space-y-4 pt-6 border-t border-amber-500/20">
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span>Direct Concierge:</span>
            <a href="tel:+919070090713" className="text-[#d4af37] font-mono font-medium">
              +91 90700 90713
            </a>
          </div>

          <button
            onClick={() => {
              setMobileMenuOpen(false);
              openBooking();
            }}
            className="w-full py-3.5 text-xs uppercase tracking-[0.2em] font-semibold text-black bg-gradient-to-r from-[#f3e5ab] via-[#d4af37] to-[#aa771c] rounded-sm text-center shadow-lg cursor-pointer"
          >
            Reserve A Room
          </button>
        </div>
      </div>
    )}
    </>
  );
}
