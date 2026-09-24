/**
 * Language and currency for the guest booking portal.
 *
 * SOW Module 17 asks for "multi-language and multi-currency display,
 * configurable per property". What is translated here is the booking
 * interface — the labels, buttons and messages a guest has to understand to
 * complete a booking. The hotel's marketing prose stays in English, because
 * §2.2 puts "content writing/photography for the guest booking website beyond
 * placeholder content" outside this project: writing Kashmiri sales copy is
 * the client's to supply, and machine-translating it would read badly over
 * the hotel's own name.
 *
 * Which languages appear is the property's choice (Settings → languages), so
 * turning one on is configuration, not a release. A string with no
 * translation falls back to English rather than showing a blank or a key,
 * which means a half-translated language is still usable.
 *
 * Pure functions and plain data: no database, no request state, so the
 * booking widget can use them in the browser.
 */
import type { Currency } from "./types";

/** Every string the booking flow shows a guest. */
export interface PortalStrings {
  checkIn: string;
  checkOut: string;
  guests: string;
  adults: string;
  children: string;
  rooms: string;
  roomType: string;
  promoCode: string;
  promoCodeOptional: string;
  search: string;
  searching: string;
  perNight: string;
  totalStay: string;
  nights: string;
  night: string;
  taxesIncluded: string;
  depositDue: string;
  bookNow: string;
  sending: string;
  yourName: string;
  yourEmail: string;
  yourPhone: string;
  requests: string;
  soldOut: string;
  joinWaitlist: string;
  bestRate: string;
  payNow: string;
  payLater: string;
  myBookings: string;
  signIn: string;
  signOut: string;
  emailCode: string;
  enterCode: string;
  cancelBooking: string;
  free: string;
}

const EN: PortalStrings = {
  checkIn: "Check-in",
  checkOut: "Check-out",
  guests: "Guests",
  adults: "Adults",
  children: "Children",
  rooms: "Rooms",
  roomType: "Room type",
  promoCode: "Promo code",
  promoCodeOptional: "Promo code (optional)",
  search: "Check availability",
  searching: "Checking…",
  perNight: "per night",
  totalStay: "Total for the stay",
  nights: "nights",
  night: "night",
  taxesIncluded: "Taxes included",
  depositDue: "Deposit due on confirmation",
  bookNow: "Request this room",
  sending: "Sending…",
  yourName: "Your name",
  yourEmail: "Email address",
  yourPhone: "Phone number",
  requests: "Any special requests?",
  soldOut: "Fully booked online",
  joinWaitlist: "Join the waiting list",
  bestRate: "Best rate guaranteed",
  payNow: "Pay the deposit now",
  payLater: "Pay at the hotel",
  myBookings: "My bookings",
  signIn: "Sign in",
  signOut: "Sign out",
  emailCode: "Email me a code",
  enterCode: "Enter the code",
  cancelBooking: "Cancel this booking",
  free: "Free",
};

/**
 * Translations, keyed by language code. Only the languages a Srinagar
 * property is most often asked for are filled in; the rest fall back to
 * English until the hotel supplies wording.
 */
const TRANSLATIONS: Record<string, Partial<PortalStrings>> = {
  hi: {
    checkIn: "आगमन",
    checkOut: "प्रस्थान",
    guests: "अतिथि",
    adults: "वयस्क",
    children: "बच्चे",
    rooms: "कमरे",
    roomType: "कमरे का प्रकार",
    promoCode: "प्रोमो कोड",
    promoCodeOptional: "प्रोमो कोड (वैकल्पिक)",
    search: "उपलब्धता देखें",
    searching: "देख रहे हैं…",
    perNight: "प्रति रात",
    totalStay: "कुल राशि",
    nights: "रातें",
    night: "रात",
    taxesIncluded: "कर सहित",
    depositDue: "पुष्टि पर जमा राशि देय",
    bookNow: "यह कमरा बुक करें",
    sending: "भेज रहे हैं…",
    yourName: "आपका नाम",
    yourEmail: "ईमेल पता",
    yourPhone: "फ़ोन नंबर",
    requests: "कोई विशेष अनुरोध?",
    soldOut: "ऑनलाइन बुकिंग पूर्ण",
    joinWaitlist: "प्रतीक्षा सूची में जुड़ें",
    bestRate: "सर्वोत्तम दर की गारंटी",
    payNow: "अब जमा राशि भुगतान करें",
    payLater: "होटल में भुगतान करें",
    myBookings: "मेरी बुकिंग",
    signIn: "साइन इन",
    signOut: "साइन आउट",
    emailCode: "मुझे कोड ईमेल करें",
    enterCode: "कोड दर्ज करें",
    cancelBooking: "यह बुकिंग रद्द करें",
    free: "निःशुल्क",
  },
  ur: {
    checkIn: "آمد",
    checkOut: "روانگی",
    guests: "مہمان",
    adults: "بالغ",
    children: "بچے",
    rooms: "کمرے",
    roomType: "کمرے کی قسم",
    promoCode: "پرومو کوڈ",
    promoCodeOptional: "پرومو کوڈ (اختیاری)",
    search: "دستیابی دیکھیں",
    searching: "دیکھ رہے ہیں…",
    perNight: "فی رات",
    totalStay: "کل رقم",
    nights: "راتیں",
    night: "رات",
    taxesIncluded: "ٹیکس شامل",
    depositDue: "تصدیق پر پیشگی رقم",
    bookNow: "یہ کمرہ بک کریں",
    sending: "بھیج رہے ہیں…",
    yourName: "آپ کا نام",
    yourEmail: "ای میل پتہ",
    yourPhone: "فون نمبر",
    requests: "کوئی خاص درخواست؟",
    soldOut: "آن لائن بکنگ مکمل",
    joinWaitlist: "ویٹنگ لسٹ میں شامل ہوں",
    bestRate: "بہترین قیمت کی ضمانت",
    payNow: "ابھی پیشگی رقم ادا کریں",
    payLater: "ہوٹل میں ادائیگی",
    myBookings: "میری بکنگ",
    signIn: "سائن ان",
    signOut: "سائن آؤٹ",
    emailCode: "مجھے کوڈ ای میل کریں",
    enterCode: "کوڈ درج کریں",
    cancelBooking: "یہ بکنگ منسوخ کریں",
    free: "مفت",
  },
};

/** Languages written right to left, so the page can set dir="rtl". */
const RTL = new Set(["ur", "ar"]);

export function isRtl(language: string): boolean {
  return RTL.has(language);
}

/**
 * The strings for a language, English filling any gap.
 *
 * A language the property has not enabled falls back entirely, so a
 * hand-typed ?lang= cannot put the portal into a language the hotel cannot
 * support at the desk.
 */
export function stringsFor(language: string, enabled: string[] = []): PortalStrings {
  if (enabled.length > 0 && !enabled.includes(language)) return EN;
  const overrides = TRANSLATIONS[language];
  return overrides ? { ...EN, ...overrides } : EN;
}

/** Whether anything is actually translated for a language. */
export function hasTranslation(language: string): boolean {
  return language === "en" || language in TRANSLATIONS;
}

// ── Currency display ────────────────────────────────────────────────────────

export type DisplayCurrency = Pick<Currency, "code" | "symbol" | "rate_to_base" | "decimals">;

/**
 * A base-currency amount written in the guest's chosen currency.
 *
 * Display only. Every amount stored anywhere in this system stays in the
 * property's own currency — the conversion here is what the guest reads, not
 * what the hotel books, which is why a converted figure is always shown as
 * approximate. Settlement in another currency is Module 7's job and records
 * the rate on the transaction.
 */
export function displayMoney(
  baseAmount: number,
  currency: DisplayCurrency | null,
  locale = "en-IN",
): string {
  if (!currency) {
    return `₹${Math.round(baseAmount).toLocaleString(locale)}`;
  }

  const rate = Number(currency.rate_to_base);
  const converted = rate > 0 ? baseAmount / rate : 0;
  const symbol = currency.symbol || `${currency.code} `;

  return `${symbol}${converted.toLocaleString(locale, {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  })}`;
}

/** True when the figure shown is a conversion and so only indicative. */
export function isConverted(currency: DisplayCurrency | null, baseCode: string): boolean {
  return Boolean(currency && currency.code !== baseCode);
}
