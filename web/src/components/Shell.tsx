"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFilters, useLinkTo } from "@/lib/filters";
import { PROPERTIES, SHORT_NAMES, ago, score } from "@/lib/format";
import { useAllOverview, useCounts, useHealth, useParams } from "@/lib/queries";
import { ReviewDialogProvider } from "./ReviewDialog";

const ICONS = {
  overview: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  reviews: <path d="M4 5h16v11H9l-5 4z" />,
  topics: <path d="M4 6h16M4 12h10M4 18h6" />,
  health: <path d="M3 12h4l3-7 4 14 3-7h4" />,
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden className="flex-none">
      {ICONS[name]}
    </svg>
  );
}

/** Left menu (pages, property switcher, collection status) around every page. Stacks on top on small screens. */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <ReviewDialogProvider>
      <div className="flex min-h-screen flex-col lg:flex-row">
        <Sidebar />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </ReviewDialogProvider>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const linkTo = useLinkTo();
  const [filters, update] = useFilters();
  const { params, ready } = useParams();
  const overview = useAllOverview();
  const counts = useCounts(params, ready);
  const health = useHealth();
  const attention = counts.data ? counts.data.urgent + counts.data.no_reply : 0;

  const nav = [
    { href: "/", label: "Overview", icon: "overview" as const },
    { href: "/reviews", label: "Reviews", icon: "reviews" as const, badge: attention },
    { href: "/topics", label: "Topics and problems", icon: "topics" as const },
    { href: "/health", label: "Data health", icon: "health" as const },
  ];
  const avg = (slug?: string) =>
    slug ? overview.data?.by_property.find((p) => p.property === slug)?.current.avg_score : overview.data?.current.avg_score;
  const props = [{ slug: "", name: "All four properties" }, ...PROPERTIES.map((p) => ({ slug: p.slug, name: SHORT_NAMES[p.slug] }))];

  return (
    <nav aria-label="Main" className="flex flex-col gap-4 bg-nav px-3 py-3 text-white lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:flex-none lg:gap-7 lg:overflow-y-auto lg:px-3.5 lg:py-5">
      <div className="flex items-center justify-between gap-3 px-3">
        <Link href={linkTo("/")} className="leading-tight">
          <span className="block text-base font-bold tracking-tight">Azzurro</span>
          <span className="block text-[13px] text-nav-muted">Guest reviews</span>
        </Link>
        <label className="lg:hidden">
          <span className="sr-only">Property</span>
          <select
            value={filters.property}
            onChange={(e) => update({ property: e.target.value })}
            className="h-9 max-w-48 rounded-lg border border-white/15 bg-white/10 px-2 text-sm text-white"
          >
            {props.map((p) => <option key={p.slug} value={p.slug} className="text-ink">{p.name}</option>)}
          </select>
        </label>
      </div>

      <ul className="flex gap-0.5 overflow-x-auto lg:flex-col">
        {nav.map((n) => {
          const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          return (
            <li key={n.href} className="flex-none">
              <Link
                href={linkTo(n.href)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm ${active ? "bg-white/10 font-semibold text-white" : "text-nav-ink hover:bg-white/5 hover:text-white"}`}
              >
                <Icon name={n.icon} />
                <span className="flex-1">{n.label}</span>
                {n.badge ? (
                  <span className="rounded-full bg-urgent px-1.5 text-xs font-semibold text-white" title="Urgent reviews plus poor reviews without a reply">
                    {n.badge}<span className="sr-only"> need attention</span>
                  </span>
                ) : null}
                {n.icon === "health" && health.data && health.data.status !== "ok" && (
                  <span className={`size-2 rounded-full ${health.data.status === "failing" ? "bg-urgent" : "bg-mix"}`} aria-label={`Data ${health.data.status}`} />
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="hidden lg:block">
        <p className="px-3 pb-1.5 text-xs text-nav-muted" id="prop-label">Property</p>
        <ul aria-labelledby="prop-label" className="space-y-0.5">
          {props.map((p) => {
            const active = filters.property === p.slug;
            return (
              <li key={p.slug}>
                <button
                  onClick={() => update({ property: p.slug })}
                  aria-pressed={active}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${active ? "bg-white/10 font-semibold text-white" : "text-nav-ink hover:bg-white/5 hover:text-white"}`}
                >
                  <span className="flex-1">{p.name}</span>
                  <span className="text-[13px] font-normal text-nav-muted" aria-label={`average ${score(avg(p.slug))}`}>{score(avg(p.slug))}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="px-3 pt-2 text-xs leading-snug text-nav-muted">Averages for the selected period.</p>
      </div>

      {health.data && <HealthFooter health={health.data} />}
    </nav>
  );
}

function HealthFooter({ health }: { health: NonNullable<ReturnType<typeof useHealth>["data"]> }) {
  const linkTo = useLinkTo();
  const latest = Math.max(0, ...health.properties.map((p) => p.last_collected_at ?? 0));
  const bad = health.properties.filter((p) => p.status !== "ok");
  const text = health.status === "ok"
    ? "All 4 properties up to date"
    : `${bad.length} ${bad.length === 1 ? "property" : "properties"} ${health.status === "failing" ? "failing to collect" : "out of date"}`;
  return (
    <Link href={linkTo("/health")} className="mt-auto hidden space-y-1.5 rounded-lg px-3 py-2 text-[12.5px] text-nav-muted hover:bg-white/5 lg:block">
      <span className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${health.status === "ok" ? "bg-good" : health.status === "failing" ? "bg-urgent" : "bg-mix"}`} aria-hidden />
        {text}
      </span>
      <span className="block">Last collected {ago(latest || null)}</span>
    </Link>
  );
}
