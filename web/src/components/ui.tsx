import { ApiError } from "@/lib/api";

export function Section({ id, title, aside, children }: { id?: string; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-line pt-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {aside && <div className="text-sm text-muted">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-3">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-line" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function ErrorNote({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof ApiError ? error.message : "Couldn't reach the review server.";
  return (
    <div role="alert" className="rounded-md border border-urgent/30 bg-urgent-soft px-4 py-3 text-sm">
      <p className="font-medium text-urgent">This section didn&apos;t load.</p>
      <p className="mt-1 text-ink">{message} Check that the server is running (see README), then try again.</p>
      {retry && (
        <button onClick={retry} className="mt-2 font-medium text-accent underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

/** Booking.com-style score chip; colour follows the positive / mixed / negative bands. */
export function ScoreChip({ value }: { value: number }) {
  const band = value >= 8 ? "bg-pos" : value <= 6 ? "bg-neg" : "bg-muted";
  return (
    <span className={`inline-flex h-7 min-w-9 items-center justify-center rounded-md px-1.5 text-sm font-semibold text-white ${band}`}>
      {value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}
    </span>
  );
}

export function Change({ value, suffix = "" }: { value: number | null; suffix?: string }) {
  if (value == null) return <span className="text-faint">no comparison</span>;
  if (value === 0) return <span className="text-muted">no change{suffix}</span>;
  const up = value > 0;
  return (
    <span className={up ? "text-good" : "text-urgent"}>
      <span aria-hidden>{up ? "▲" : "▼"}</span> {up ? "up" : "down"} {Math.abs(value).toFixed(1)}{suffix}
    </span>
  );
}
