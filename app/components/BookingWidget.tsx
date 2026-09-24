"use client";

import { keepFormOnSubmit } from "../admin/components/useKeepForm";

import { useState, useRef, useEffect, useActionState } from "react";
import {
  X,
  Calendar,
  Users,
  Tag,
  ChevronDown,
  Minus,
  Plus,
  Phone,
  Sparkles,
  Languages,
  Building2,
  CheckCircle2,
  Send,
  Loader2,
} from "lucide-react";
import type { RoomType } from "../lib/types";
import { LANGUAGES } from "../lib/types";
import { stringsFor, isRtl } from "../lib/portal-i18n";
import { toLocalIso } from "../lib/dates";
import {
  submitBookingRequest,
  quoteStayRequest,
  type RequestState,
  type StayQuote,
} from "../lib/booking-request";

interface BookingWidgetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Room types offered in the picker, driven by the admin panel. */
  roomTypes: RoomType[];
  /** Pre-selects a room when the guest arrived from a specific room card. */
  preselectedRoom?: string;
  /** The hotel's best-rate guarantee wording, from Settings. */
  bestRateMessage?: string;
  /** Languages the property offers, and which one to open in. */
  languages?: string[];
  defaultLanguage?: string;
}

const MAX_ROOMS = 5;

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const fmtDate = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

// Local calendar date, not a UTC instant — see app/lib/dates.ts.
const toIso = toLocalIso;

export default function BookingWidget({
  isOpen,
  onClose,
  roomTypes,
  preselectedRoom = "",
  bestRateMessage = "",
  languages = ["en"],
  defaultLanguage = "en",
}: BookingWidgetProps) {
  /**
   * The language is held here rather than in the URL so the marketing pages
   * stay statically rendered — a ?lang= the server had to read would make
   * every one of them dynamic and cost the SOW's three-second page load.
   * Remembered per browser, so a returning guest opens where they left off.
   */
  // Read in the initialiser rather than an effect: this panel is only mounted
  // after the visitor opens it, so it never renders on the server and there
  // is no hydration to mismatch.
  const [lang, setLang] = useState(() => {
    try {
      const saved = window.localStorage.getItem("samci.lang");
      return saved && languages.includes(saved) ? saved : defaultLanguage;
    } catch {
      // Private browsing, or storage turned off. The default is fine.
      return defaultLanguage;
    }
  });

  const chooseLang = (next: string) => {
    setLang(next);
    try {
      window.localStorage.setItem("samci.lang", next);
    } catch {
      // Not being able to remember it is not worth failing over.
    }
  };

  const t = stringsFor(lang, languages);

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const [checkIn, setCheckIn] = useState(toIso(today));
  const [checkOut, setCheckOut] = useState(toIso(tomorrow));
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [rooms, setRooms] = useState(1);
  const [roomTypeId, setRoomTypeId] = useState(
    () => roomTypes.find((rt) => rt.name === preselectedRoom)?.id ?? roomTypes[0]?.id ?? "",
  );
  const [planId, setPlanId] = useState("");
  const [quote, setQuote] = useState<{ key: string; value: StayQuote } | null>(null);

  // Each room type takes only so many guests per room.
  const roomType = roomTypes.find((rt) => rt.id === roomTypeId);
  const maxAdults = Math.max(1, (roomType?.max_adults ?? 2) * rooms);
  const maxChildren = Math.max(0, (roomType?.max_children ?? 0) * rooms);
  const guestsAdults = Math.min(adults, maxAdults);
  const guestsChildren = Math.min(children, maxChildren);

  const [state, formAction, pending] = useActionState<RequestState, FormData>(
    submitBookingRequest,
    {},
  );

  const [guestOpen, setGuestOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  // Live price and availability, fetched a moment after the guest stops changing things.
  const queryKey = [checkIn, checkOut, guestsAdults, guestsChildren, rooms, roomTypeId].join("|");
  useEffect(() => {
    if (!isOpen || !roomTypeId) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const value = await quoteStayRequest({
        checkIn,
        checkOut,
        adults: guestsAdults,
        children: guestsChildren,
        rooms,
        roomTypeId,
      });
      if (!cancelled) setQuote({ key: queryKey, value });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, queryKey, checkIn, checkOut, guestsAdults, guestsChildren, rooms, roomTypeId]);

  const current = quote?.key === queryKey ? quote.value : null;
  const checking = !!roomTypeId && !current;
  const offers = current?.plans ?? [];
  const selectedPlan = offers.find((p) => p.id === planId) ?? offers[0];

  const widgetRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (widgetRef.current && !widgetRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, onClose]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const nights = Math.max(
    1,
    Math.ceil(
      (new Date(checkOut + "T00:00:00").getTime() - new Date(checkIn + "T00:00:00").getTime()) /
        86400000
    )
  );

  const guestSummary = `${guestsAdults} Adult${guestsAdults !== 1 ? "s" : ""}${
    guestsChildren > 0 ? `, ${guestsChildren} Child${guestsChildren !== 1 ? "ren" : ""}` : ""
  } \u2013 ${rooms} Room${rooms !== 1 ? "s" : ""}`;

  const renderCounter = (
    label: string,
    hint: string,
    val: number,
    min: number,
    max: number,
    set: (v: number) => void
  ) => (
    <div className="flex items-center justify-between py-3 border-b border-[#f5f2ed] last:border-none">
      <div>
        <p className="text-sm font-medium text-[#1c1b1a] leading-none">{label}</p>
        {hint && <p className="text-[11px] text-[#9a9490] mt-1">{hint}</p>}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => set(Math.max(min, val - 1))}
          disabled={val <= min}
          className="w-8 h-8 rounded-full border border-[#d9c3a3] flex items-center justify-center text-[#a88956] hover:bg-[#fdf6ec] disabled:opacity-25 transition cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="w-6 text-center font-serif text-lg font-semibold text-[#1c1b1a] leading-none">
          {val}
        </span>
        <button
          type="button"
          onClick={() => set(Math.min(max, val + 1))}
          disabled={val >= max}
          className="w-8 h-8 rounded-full border border-[#d9c3a3] flex items-center justify-center text-[#a88956] hover:bg-[#fdf6ec] disabled:opacity-25 transition cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      {/* Full-screen backdrop overlay */}
      <div
        className="fixed inset-0 bg-black/75 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Booking Popup Card Container */}
      <div
        ref={widgetRef}
        dir={isRtl(lang) ? "rtl" : undefined}
        className="relative z-10 w-full max-w-lg bg-white rounded-2xl shadow-[0_25px_80px_rgba(0,0,0,0.5)] overflow-hidden animate-panel border border-[#e5e0d8] my-auto"
      >
        {/* ── CARD HEADER with prominent CROSS (X) BUTTON at Top Right ── */}
        <div className="bg-[#1c1b1a] px-6 py-4 flex items-center justify-between border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#a88956]/20 border border-[#a88956]/40 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-[#e6d7c3]" />
            </div>
            <div>
              <h3 className="font-serif text-base text-[#e6d7c3] font-medium tracking-wide uppercase">
                Hotel Shamiyana
              </h3>
              <p className="text-[10px] text-[#9a9490] tracking-widest uppercase">
                Hotel &bull; Srinagar
              </p>
            </div>
          </div>

          {/* ✖ CROSS BUTTON AT TOP RIGHT ✖ */}
          <button
            onClick={onClose}
            aria-label="Close booking popup"
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-[#a88956] text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer group shadow-sm shrink-0"
          >
            <X className="w-5 h-5 transition-transform group-hover:rotate-90 duration-200" />
          </button>
        </div>

        {state.success ? (
          <div className="p-8 flex flex-col items-center text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-200">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h4 className="font-serif text-xl text-[#1c1b1a] font-medium">Request received</h4>
            <p className="text-xs text-[#7a7771] leading-relaxed max-w-xs">{state.success}</p>

            {state.payUrl && (
              <div className="w-full pt-1 space-y-2">
                <a
                  href={state.payUrl}
                  rel="noreferrer"
                  className="block w-full bg-[#a88956] hover:bg-[#8f7343] text-white text-xs font-medium rounded-xl px-4 py-3 transition-colors"
                >
                  Pay the deposit now
                  {state.payAmount ? ` — ${rupees(state.payAmount)}` : ""}
                </a>
                <p className="text-[10px] text-[#9a9490] leading-relaxed">
                  Secured by Razorpay. Your card details are entered on their page and never reach
                  us. You can also simply pay at the hotel.
                </p>
              </div>
            )}

            <a
              href="tel:+919070090713"
              className="inline-flex items-center gap-2 text-xs text-[#a88956] hover:text-[#8f7343] transition-colors pt-2"
            >
              <Phone className="w-3.5 h-3.5" />
              <span>Or call us now on +91 90700 90713</span>
            </a>
            <button type="button" onClick={onClose} className="text-[11px] text-[#9a9490] underline pt-1 cursor-pointer">
              Close
            </button>
          </div>
        ) : (
        <form action={formAction} onSubmit={keepFormOnSubmit(formAction)} className="p-6 space-y-4">
          {/* Direct booking benefit, and the hotel's own best-rate wording
              underneath it (SOW Module 17: "best-rate guarantee messaging"). */}
          <div className="bg-[#faf8f5] border border-[#eee8df] rounded-xl px-4 py-2.5 text-xs text-[#5a5854]">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-medium text-[#1c1b1a]">
                <Sparkles className="w-3.5 h-3.5 text-[#a88956]" /> Direct Reservation
              </span>
              <span className="text-[#a88956] font-semibold text-[11px]">Best Rate Guaranteed</span>
            </div>
            {bestRateMessage && (
              <p className="text-[10px] text-[#7a7771] leading-relaxed mt-1.5 pt-1.5 border-t border-[#eee8df]">
                {bestRateMessage}
              </p>
            )}
            {languages.length > 1 && (
              <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-[#eee8df]">
                <Languages className="w-3 h-3 text-[#a88956] shrink-0" />
                <label htmlFor="booking-lang" className="sr-only">
                  Language
                </label>
                <select
                  id="booking-lang"
                  value={lang}
                  onChange={(e) => chooseLang(e.target.value)}
                  className="text-[10px] bg-transparent text-[#5a5854] focus:outline-none cursor-pointer"
                >
                  {languages.map((code) => (
                    <option key={code} value={code}>
                      {LANGUAGES[code] ?? code}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Form Fields Stack */}
          <div className="border border-[#ede9e2] rounded-xl overflow-hidden divide-y divide-[#ede9e2] bg-white shadow-sm">
            {/* ── Field 1: Check-In & Check-Out Dates ── */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setDateOpen(!dateOpen);
                  setGuestOpen(false);
                }}
                className="w-full px-4 py-3.5 flex items-center gap-3.5 hover:bg-[#fdfcfa] transition-colors text-left group"
              >
                <Calendar className="w-4 h-4 text-[#a88956] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-[#9a9490] font-semibold">
                    Dates of Stay ({nights} Night{nights !== 1 ? "s" : ""})
                  </p>
                  <p className="text-sm font-medium text-[#1c1b1a] mt-0.5">
                    {fmtDate(checkIn)} &nbsp;<span className="text-[#a88956]">—</span>&nbsp; {fmtDate(checkOut)}
                  </p>
                </div>
                <ChevronDown
                  className={`w-4 h-4 text-[#9a9490] group-hover:text-[#a88956] transition-transform ${
                    dateOpen ? "rotate-180 text-[#a88956]" : ""
                  }`}
                />
              </button>

              {/* Date Selection Popover */}
              {dateOpen && (
                <div className="p-4 bg-[#faf8f5] border-t border-[#ede9e2] animate-slide-down">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-[#7a7771] font-semibold block mb-1">
                        {t.checkIn}
                      </label>
                      <input
                        type="date"
                        value={checkIn}
                        min={toIso(today)}
                        onChange={(e) => {
                          setCheckIn(e.target.value);
                          if (e.target.value >= checkOut) {
                            const d = new Date(e.target.value + "T00:00:00");
                            d.setDate(d.getDate() + 1);
                            setCheckOut(toIso(d));
                          }
                        }}
                        className="w-full text-xs font-medium text-[#1c1b1a] bg-white border border-[#e5e0d8] rounded-lg px-3 py-2 focus:outline-none focus:border-[#a88956]"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-[#7a7771] font-semibold block mb-1">
                        {t.checkOut}
                      </label>
                      <input
                        type="date"
                        value={checkOut}
                        min={checkIn}
                        onChange={(e) => setCheckOut(e.target.value)}
                        className="w-full text-xs font-medium text-[#1c1b1a] bg-white border border-[#e5e0d8] rounded-lg px-3 py-2 focus:outline-none focus:border-[#a88956]"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDateOpen(false)}
                    className="mt-3 w-full py-1.5 text-center text-xs font-semibold text-[#a88956] hover:text-[#1c1b1a] transition-colors"
                  >
                    Done Selecting Dates
                  </button>
                </div>
              )}
            </div>

            {/* ── Field 2: Guests & Rooms Counter ── */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setGuestOpen(!guestOpen);
                  setDateOpen(false);
                }}
                className="w-full px-4 py-3.5 flex items-center gap-3.5 hover:bg-[#fdfcfa] transition-colors text-left group"
              >
                <Users className="w-4 h-4 text-[#a88956] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-[#9a9490] font-semibold">
                    Guests & Accommodations
                  </p>
                  <p className="text-sm font-medium text-[#1c1b1a] mt-0.5 truncate">
                    {guestSummary}
                  </p>
                </div>
                <ChevronDown
                  className={`w-4 h-4 text-[#9a9490] group-hover:text-[#a88956] transition-transform ${
                    guestOpen ? "rotate-180 text-[#a88956]" : ""
                  }`}
                />
              </button>

              {/* Guests Counter Popover */}
              {guestOpen && (
                <div className="p-4 bg-[#faf8f5] border-t border-[#ede9e2] animate-slide-down">
                  {renderCounter(t.adults, "Age 11+ years", guestsAdults, 1, maxAdults, setAdults)}
                  {renderCounter(t.children, "Age 5–10 years", guestsChildren, 0, maxChildren, setChildren)}
                  {renderCounter(t.rooms, "Number of rooms required", rooms, 1, MAX_ROOMS, setRooms)}
                  {roomType && (
                    <p className="text-[11px] text-[#9a9490] pt-2">
                      {roomType.name}: up to {roomType.max_adults} adult{roomType.max_adults !== 1 ? "s" : ""}
                      {roomType.max_children > 0
                        ? ` and ${roomType.max_children} child${roomType.max_children !== 1 ? "ren" : ""}`
                        : ", no children"}{" "}
                      per room. Add a room for more guests.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setGuestOpen(false)}
                    className="mt-3 w-full py-2 bg-[#a88956] hover:bg-[#8f7343] text-white text-xs uppercase tracking-widest font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    Confirm Guest Count
                  </button>
                </div>
              )}
            </div>

            {/* ── Field 3: Promo code ── */}
            <label className="px-4 py-3.5 flex items-center gap-3.5 hover:bg-[#fdfcfa] transition-colors cursor-text">
              <Tag className="w-4 h-4 text-[#a88956] shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-[10px] uppercase tracking-wider text-[#9a9490] font-semibold">
                  {t.promoCodeOptional}
                </span>
                <input
                  name="promo_code"
                  maxLength={40}
                  autoComplete="off"
                  placeholder="Have a code? Our team applies it when confirming"
                  className="w-full text-sm font-medium text-[#1c1b1a] mt-0.5 bg-transparent uppercase placeholder:normal-case placeholder:font-normal placeholder:text-[#b5afa7] focus:outline-none"
                />
              </span>
            </label>
          </div>

          {/* Values chosen in the pickers above */}
          <input type="hidden" name="check_in" value={checkIn} />
          <input type="hidden" name="check_out" value={checkOut} />
          <input type="hidden" name="adults" value={guestsAdults} />
          <input type="hidden" name="children" value={guestsChildren} />
          <input type="hidden" name="rooms_count" value={rooms} />
          <input type="hidden" name="rate_plan_id" value={selectedPlan?.id ?? ""} />

          {/* ── Room & contact details ── */}
          <div className="space-y-3 pt-1">
            {roomTypes.length > 0 && (
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider text-[#9a9490] font-semibold mb-1">
                  Room
                </span>
                <select
                  name="room_type_id"
                  value={roomTypeId}
                  onChange={(e) => setRoomTypeId(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#ede9e2] rounded-xl text-[#1c1b1a] focus:outline-none focus:border-[#a88956]"
                >
                  {roomTypes.map((rt) => (
                    <option key={rt.id} value={rt.id}>
                      {rt.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {/* ── Live availability and rate plans ── */}
            {checking && (
              <p className="flex items-center gap-2 text-xs text-[#9a9490] px-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking availability…
              </p>
            )}
            {current?.status === "closed" && (
              <p className="text-xs bg-rose-50 text-rose-800 border border-rose-200 rounded-lg px-3 py-2">{current.message}</p>
            )}
            {current && offers.length > 0 && (
              <div className="space-y-2">
                <p
                  className={`text-xs rounded-lg px-3 py-2 border ${
                    current.status === "waitlist"
                      ? "bg-amber-50 text-amber-900 border-amber-200"
                      : "bg-emerald-50 text-emerald-800 border-emerald-200"
                  }`}
                >
                  {current.status === "waitlist" ? current.message : `Available for your dates · ${current.nights} night${current.nights !== 1 ? "s" : ""}`}
                </p>
                <div role="radiogroup" aria-label="Rate" className="space-y-2">
                  {offers.map((p) => {
                    const active = p.id === selectedPlan?.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setPlanId(p.id)}
                        className={`w-full text-left rounded-xl border px-4 py-3 transition-colors cursor-pointer ${
                          active ? "border-[#a88956] bg-[#fdf6ec]" : "border-[#ede9e2] bg-white hover:border-[#d9c3a3]"
                        }`}
                      >
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-[#1c1b1a]">{p.name}</span>
                            <span className="block text-[11px] text-[#7a7771] mt-0.5">
                              {p.meal} ·{" "}
                              {p.refundable
                                ? p.freeCancellationHours > 0
                                  ? `Free cancellation up to ${p.freeCancellationHours} h before arrival`
                                  : "Refundable"
                                : "Non-refundable"}
                            </span>
                          </span>
                          <span className="text-right shrink-0">
                            <span className="block font-serif text-lg font-semibold text-[#1c1b1a] leading-tight">
                              {rupees(p.total)}
                            </span>
                            <span className="block text-[10px] text-[#9a9490]">
                              {rupees(p.perNight)} / room / {t.night}
                            </span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-[#9a9490] px-1">
                  Total for {rooms} room{rooms !== 1 ? "s" : ""}, including {current.taxLabel || "taxes"}.
                  {selectedPlan && selectedPlan.deposit > 0 && ` A deposit of ${rupees(selectedPlan.deposit)} is due on confirmation.`}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider text-[#9a9490] font-semibold mb-1">
                  {t.yourName}
                </span>
                <input
                  name="contact_name"
                  required
                  autoComplete="name"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#ede9e2] rounded-xl text-[#1c1b1a] focus:outline-none focus:border-[#a88956]"
                />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider text-[#9a9490] font-semibold mb-1">
                  {t.yourPhone}
                </span>
                <input
                  name="contact_phone"
                  type="tel"
                  autoComplete="tel"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#ede9e2] rounded-xl text-[#1c1b1a] focus:outline-none focus:border-[#a88956]"
                />
              </label>
            </div>

            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-[#9a9490] font-semibold mb-1">
                Email
              </span>
              <input
                name="contact_email"
                type="email"
                autoComplete="email"
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#ede9e2] rounded-xl text-[#1c1b1a] focus:outline-none focus:border-[#a88956]"
              />
            </label>

            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-[#9a9490] font-semibold mb-1">
                Anything we should know?
              </span>
              <textarea
                name="special_requests"
                rows={2}
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#ede9e2] rounded-xl text-[#1c1b1a] focus:outline-none focus:border-[#a88956]"
              />
            </label>
          </div>

          {state.error && (
            <p role="alert" className="text-xs bg-rose-50 text-rose-800 border border-rose-200 rounded-lg px-3 py-2">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending || current?.status === "closed"}
            className="w-full py-3.5 bg-[#1c1b1a] hover:bg-black text-white rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2.5 disabled:opacity-60"
          >
            <Send className="w-4 h-4 shrink-0" />
            <span className="font-bold text-xs uppercase tracking-[0.2em]">
              {pending ? "Sending…" : current?.status === "waitlist" ? "Join the waiting list" : "Send booking request"}
            </span>
          </button>

          <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-[#c9c4bc]">
            <span className="h-px flex-1 bg-[#ede9e2]" />
            <span>or</span>
            <span className="h-px flex-1 bg-[#ede9e2]" />
          </div>

          {/* ── Reservations are also taken by phone ── */}
          <a
            href="tel:+919070090713"
            className="w-full py-4 bg-[#a88956] hover:bg-[#8f7343] text-white rounded-xl shadow-lg transition-all transform hover:-translate-y-0.5 cursor-pointer flex items-center justify-center gap-2.5"
          >
            <Phone className="w-4 h-4 shrink-0" />
            <span className="font-bold text-xs uppercase tracking-[0.2em]">+91 90700 90713</span>
          </a>

          <p className="text-center text-[11px] text-[#7a7771] font-light leading-relaxed px-2">
            Call the front desk with your dates and we will check availability and confirm your booking.
          </p>
        </form>
        )}
      </div>
    </div>
  );
}
