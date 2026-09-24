/**
 * Date helpers for calendar work.
 *
 * `toISOString()` converts to UTC first, so in any timezone ahead of UTC it
 * reports the previous day for times before the offset — in India (UTC+5:30)
 * every moment between midnight and 05:30 comes back as yesterday. Hotel dates
 * are local calendar days, never instants, so they are formatted from the
 * local parts instead.
 */

/** yyyy-mm-dd from a Date's local calendar parts. */
export function toLocalIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today as yyyy-mm-dd in the viewer's timezone. */
export function todayIso(): string {
  return toLocalIso(new Date());
}

/** yyyy-mm-dd, `days` from today. */
export function isoPlusDays(days: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return toLocalIso(d);
}

/** First day of the month containing `iso`, as yyyy-mm-01. */
export function monthStartOf(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** First day of the month `delta` months from `monthIso` (a yyyy-mm-01). */
export function shiftMonth(monthIso: string, delta: number): string {
  const [year, month] = monthIso.split("-").map(Number);
  // Day 1 avoids the classic "31 January + 1 month" overflow.
  return toLocalIso(new Date(year, month - 1 + delta, 1));
}

/** Last day of the month containing `monthIso`. */
export function monthEndOf(monthIso: string): string {
  const [year, month] = monthIso.split("-").map(Number);
  return toLocalIso(new Date(year, month, 0));
}

/** Number of days in the month containing `monthIso`. */
export function daysInMonth(monthIso: string): number {
  const [year, month] = monthIso.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

/** yyyy-mm-dd, `days` after the yyyy-mm-dd `iso`. */
export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return toLocalIso(new Date(year, month - 1, day + days));
}

/** 0 = Sunday … 6 = Saturday, for a yyyy-mm-dd date. */
export function dayOfWeek(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
}

/** Every night of a stay: check-in up to, not including, check-out. */
export function eachNight(checkIn: string, checkOut: string): string[] {
  const nights: string[] = [];
  if (!isIsoDate(checkIn) || !isIsoDate(checkOut)) return nights;
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) nights.push(d);
  return nights;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/**
 * The instant a wall-clock time happens in a given timezone, e.g. 14:00 on
 * the arrival date in Asia/Kolkata. Computed without a date library by
 * measuring the zone's offset at that moment.
 */
export function zonedTime(dateIso: string, time: string, timeZone: string): Date {
  const [year, month, day] = dateIso.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(asUtc));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const zoneAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));

  return new Date(asUtc - (zoneAsUtc - asUtc));
}

/** Today's date in a timezone, as yyyy-mm-dd. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

/** A real calendar date in yyyy-mm-dd form. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

/** The current wall-clock time in a timezone, as HH:MM. */
export function nowTimeIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

/** Hours from now until a wall-clock time on a date in a timezone. */
export function hoursUntil(dateIso: string, time: string, timeZone: string, now = new Date()): number {
  return (zonedTime(dateIso, time, timeZone).getTime() - now.getTime()) / 3600000;
}

/** Whole minutes since an instant (negative if it is in the future). */
export function minutesSince(iso: string, now = new Date()): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 60000);
}

/** The Monday on or before a yyyy-mm-dd date. */
export function mondayOf(iso: string): string {
  return addDays(iso, -((dayOfWeek(iso) + 6) % 7));
}
