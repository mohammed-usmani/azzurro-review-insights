import { ApiError } from "@/lib/api";
import { band } from "@/lib/format";

export function Panel({ className = "", children, ...rest }: React.HTMLAttributes<HTMLElement> & { as?: "section" | "article" | "div" }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-surface ${className}`} {...rest}>
      {children}
    </section>
  );
}

export function PanelHeader({ id, title, children }: { id?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pb-2.5 pt-3.5 sm:px-5">
      <h2 id={id} className="text-[15px] font-semibold">{title}</h2>
      {children && <div className="text-[12.5px] text-muted">{children}</div>}
    </div>
  );
}

/** Underlined tabs that switch what one panel shows. */
export function Tabs<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-4">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`-mb-px border-b-2 py-1.5 text-[13px] ${value === o.value ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div aria-busy="true" aria-label="Loading" className={`space-y-3 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-line-soft" style={{ width: `${92 - i * 9}%` }} />
      ))}
    </div>
  );
}

export function ErrorNote({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof ApiError ? error.message : "Couldn't reach the review server.";
  return (
    <div role="alert" className="m-4 rounded-lg border border-urgent/30 bg-urgent-soft px-4 py-3 text-sm">
      <p className="font-medium text-urgent-ink">This section didn&apos;t load.</p>
      <p className="mt-1">{message} Check that the API is running (<code>./run.sh</code>), then try again.</p>
      {retry && (
        <button onClick={retry} className="mt-2 font-semibold text-accent">Try again</button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-muted">{children}</p>;
}

const CHIP = { pos: "bg-pos-soft text-pos-ink", mix: "bg-mix-soft text-mix-ink", neg: "bg-neg-soft text-neg-ink" };

/** Booking.com score; colour follows the positive (8–10) / mixed / negative (6 or below) bands. */
export function ScoreChip({ value, large = false }: { value: number; large?: boolean }) {
  const label = value % 1 === 0 ? value.toFixed(0) : value.toFixed(1);
  return (
    <span
      className={`inline-flex flex-none items-center justify-center font-bold ${CHIP[band(value)]} ${large ? "h-10 w-11 rounded-[9px] text-lg" : "h-[26px] w-[30px] rounded-[7px] text-[13px]"}`}
      aria-label={`Score ${label} out of 10`}
    >
      {label}
    </span>
  );
}

/** ▲/▼ change. `goodWhenUp` says which direction is good news, which sets the colour. */
export function Delta({ value, unit = "", goodWhenUp = true, from }: { value: number | null; unit?: string; goodWhenUp?: boolean; from?: string }) {
  if (value == null) return <span className="text-[13px] text-muted">No earlier data to compare</span>;
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  if (rounded === 0) return <span className="text-[13px] text-muted">No change{from && ` from ${from}`}</span>;
  const good = value > 0 === goodWhenUp;
  return (
    <span className="text-[13px]">
      <span className={`font-medium ${good ? "text-pos-ink" : "text-neg-ink"}`}>
        <span aria-hidden>{value > 0 ? "▲" : "▼"}</span>
        <span className="sr-only">{value > 0 ? "up" : "down"}</span> {unit === " pts" ? `${Math.round(Math.abs(value))} ${Math.round(Math.abs(value)) === 1 ? "pt" : "pts"}` : `${rounded.toFixed(1)}${unit}`}
      </span>
      {from && <span className="text-muted"> from {from}</span>}
    </span>
  );
}

/** "Few" marks a number based on under 5 reviews: one review can move it a lot. */
export function Few({ n }: { n: number }) {
  if (n >= 5) return null;
  return (
    <span title="Fewer than 5 reviews: one review can move the average a lot" className="ml-1.5 rounded-[5px] bg-mix-soft px-1.5 py-0.5 text-[11.5px] font-medium text-mix-ink">
      few
    </span>
  );
}
