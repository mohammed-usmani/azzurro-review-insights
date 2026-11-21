const dayFmt = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
const dateFmt = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const day = (iso: string) => dayFmt.format(asDate(iso)).replace(",", "");
export const short = (iso: string) => shortFmt.format(asDate(iso));
export const date = (iso: string) => dateFmt.format(asDate(iso));
export const score = (n: number | null | undefined) => (n == null ? "–" : n.toFixed(1));
export const pct = (n: number | null | undefined) => (n == null ? "–" : `${Math.round(n)}%`);
export const plural = (n: number, word: string, many = `${word}s`) => `${n.toLocaleString("en-AU")} ${n === 1 ? word : many}`;

/** "Mon 16 Nov to Sat 21 Nov" */
export function range(from: string, to: string) {
  return from === to ? day(from) : `${day(from)} to ${day(to)}`;
}

/** Whole days between two ISO dates. */
export const daysBetween = (from: string, to: string) => Math.round((asDate(to).getTime() - asDate(from).getTime()) / 86_400_000);

export function ago(unixSeconds: number | null | undefined) {
  if (!unixSeconds) return "never";
  const minutes = (Date.now() / 1000 - unixSeconds) / 60;
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours)} ${Math.round(hours) === 1 ? "hour" : "hours"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export const band = (value: number) => (value >= 8 ? "pos" : value <= 6 ? "neg" : "mix") as "pos" | "mix" | "neg";

export const SHORT_NAMES: Record<string, string> = {
  "olympic-paddington": "Paddington",
  "venus-potts-point-sydney": "Potts Point",
  "venus-surry-hills": "Central Sydney",
  "chateau-de-venus": "Darling Harbour",
};

export const PROPERTIES = [
  { slug: "olympic-paddington", name: "Olympic Hotel Paddington" },
  { slug: "venus-potts-point-sydney", name: "Potts Point" },
  { slug: "venus-surry-hills", name: "Central Sydney" },
  { slug: "chateau-de-venus", name: "Darling Harbour" },
];

export const TOPICS: { value: string; label: string }[] = [
  { value: "cleanliness", label: "Cleanliness" },
  { value: "check_in", label: "Check-in" },
  { value: "staff", label: "Staff" },
  { value: "noise", label: "Noise" },
  { value: "facilities", label: "Facilities" },
  { value: "location", label: "Location" },
  { value: "room_condition", label: "Room condition" },
  { value: "value", label: "Value for money" },
];
export const TOPIC_LABEL: Record<string, string> = Object.fromEntries(TOPICS.map((t) => [t.value, t.label]));

export const TRAVELLER: Record<string, string> = {
  SOLO_TRAVELLERS: "Solo traveller", COUPLES: "Couple", FAMILIES: "Family",
  GROUP_OF_FRIENDS: "Group of friends", BUSINESS_TRAVELLERS: "Business traveller",
};

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });
const BOOKING_CODES: Record<string, string> = { xt: "Chinese (Traditional)", xa: "Spanish (Latin America)", xb: "Portuguese (Brazil)", xu: "Language not given" };
export function language(code: string | null) {
  if (!code) return "Unknown language";
  if (BOOKING_CODES[code]) return BOOKING_CODES[code];
  try { return languageNames.of(code) ?? code; } catch { return code; }
}
