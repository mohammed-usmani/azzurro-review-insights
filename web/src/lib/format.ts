const dayFmt = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dateFmt = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const day = (iso: string) => dayFmt.format(new Date(`${iso}T00:00:00Z`));
export const date = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`));
export const score = (n: number | null | undefined) => (n == null ? "–" : n.toFixed(1));
export const pct = (n: number | null | undefined) => (n == null ? "–" : `${Math.round(n)}%`);
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function range(from: string, to: string) {
  return from === to ? day(from) : `${day(from)} – ${day(to)}`;
}

export function ago(unixSeconds: number | null | undefined) {
  if (!unixSeconds) return "never";
  const hours = (Date.now() / 1000 - unixSeconds) / 3600;
  if (hours < 1) return "less than an hour ago";
  if (hours < 48) return `${Math.round(hours)} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

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

export const TRAVELLER: Record<string, string> = {
  SOLO_TRAVELLERS: "Solo traveller", COUPLES: "Couple", FAMILIES: "Family",
  GROUP_OF_FRIENDS: "Group of friends", BUSINESS_TRAVELLERS: "Business traveller",
};

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });
const BOOKING_CODES: Record<string, string> = { xt: "Chinese (Traditional)", xa: "Spanish (Latin America)", xu: "Language not given" };
export function language(code: string | null) {
  if (!code) return "Unknown language";
  if (BOOKING_CODES[code]) return BOOKING_CODES[code];
  try { return languageNames.of(code) ?? code; } catch { return code; }
}
