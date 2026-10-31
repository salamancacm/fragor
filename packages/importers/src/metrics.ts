import type { Sample } from "./prom";

/** What a service's counters showed over a window (or since it started). */
export interface ServiceMetrics {
  /** Seconds the rates cover: the uptime difference of two snapshots, or the whole uptime. */
  seconds: number;
  /** True when there was one snapshot: the rates average everything since the service started. */
  sinceStart: boolean;
  /** Requests the service answered: `http_server_requests_seconds_*`. */
  server: {
    rps: number;
    /** Mean response time; the metric has no percentiles unless the service enables them. */
    meanMs: number | null;
    /** Share of the answers with a 5xx status, 0..1. */
    serverErrorShare: number;
  };
  /** Calls the service made, by REST client name: `http_client_requests_seconds_*`. */
  clients: Record<string, { address: string | null; rps: number; meanMs: number | null }>;
  /** Methods guarded by fault tolerance (`ft_*` metrics). */
  guards: Guard[];
}

export interface Guard {
  /** Fully qualified method name, the `method` tag of the series. */
  method: string;
  /** Whether a fallback is configured: `ft_invocations_total{fallback}` is not `notDefined`. */
  fallback: "defined" | "notDefined";
  /** Whether any `ft_circuitbreaker_*` series exists for the method. */
  circuitBreaker: boolean;
  /** Whether any `ft_bulkhead_*` series exists for the method. */
  bulkhead: boolean;
  /** Retries made in the window: `ft_retry_retries_total`. */
  retries: number;
  /** Attempts that hit the timeout in the window: `ft_timeout_calls_total{timedOut="true"}`. */
  timedOut: number;
}

export type Summary = { ok: true; metrics: ServiceMetrics } | { ok: false; error: string };

const key = (s: Sample) => JSON.stringify([s.name, s.labels]);

function index(samples: readonly Sample[]): Map<string, number> {
  return new Map(samples.map((s) => [key(s), s.value]));
}

function uptime(samples: readonly Sample[]): number | null {
  return samples.find((s) => s.name === "process_uptime_seconds")?.value ?? null;
}

/** Counters grow; the change of one between two snapshots, null if it went down (a restart). */
function delta(after: Sample, before: Map<string, number> | null): number | null {
  if (before === null) return after.value;
  const was = before.get(key(after)) ?? 0;
  return after.value >= was ? after.value - was : null;
}

interface Timer {
  count: number;
  sumS: number;
}

/** `<base>_count` and `<base>_sum` of every series, grouped by `groupBy(labels)`. */
function timers(
  after: readonly Sample[],
  before: Map<string, number> | null,
  base: string,
  groupBy: (labels: Readonly<Record<string, string>>) => string,
  keep: (labels: Readonly<Record<string, string>>) => boolean = () => true,
): Map<string, Timer & { labels: Readonly<Record<string, string>> }> | null {
  const out = new Map<string, Timer & { labels: Readonly<Record<string, string>> }>();
  for (const s of after) {
    const isCount = s.name === `${base}_count`;
    if ((!isCount && s.name !== `${base}_sum`) || !keep(s.labels)) continue;
    const d = delta(s, before);
    if (d === null) return null;
    const g = groupBy(s.labels);
    const t = out.get(g) ?? { count: 0, sumS: 0, labels: s.labels };
    if (isCount) t.count += d;
    else t.sumS += d;
    out.set(g, t);
  }
  return out;
}

const meanMs = (t: Timer): number | null => (t.count > 0 ? (t.sumS / t.count) * 1000 : null);

function guardsOf(after: readonly Sample[], before: Map<string, number> | null): Guard[] | null {
  const methods = new Set<string>();
  for (const s of after)
    if (s.name.startsWith("ft_") && s.labels.method !== undefined) methods.add(s.labels.method);
  const out: Guard[] = [];
  for (const method of [...methods].sort()) {
    const mine = after.filter((s) => s.labels.method === method);
    const sum = (name: string, keep: (s: Sample) => boolean = () => true): number | null => {
      let total = 0;
      for (const s of mine.filter((x) => x.name === name && keep(x))) {
        const d = delta(s, before);
        if (d === null) return null;
        total += d;
      }
      return total;
    };
    const retries = sum("ft_retry_retries_total");
    const timedOut = sum("ft_timeout_calls_total", (s) => s.labels.timedOut === "true");
    if (retries === null || timedOut === null) return null;
    out.push({
      method,
      fallback: mine.some(
        (s) => s.name === "ft_invocations_total" && s.labels.fallback !== "notDefined",
      )
        ? "defined"
        : "notDefined",
      circuitBreaker: mine.some((s) => s.name.startsWith("ft_circuitbreaker_")),
      bulkhead: mine.some((s) => s.name.startsWith("ft_bulkhead_")),
      retries,
      timedOut,
    });
  }
  return out;
}

const WENT_DOWN = "a counter went down between the snapshots: the service restarted in between";

/**
 * Summarizes the metrics of one service. With `before` (an earlier snapshot of the same instance)
 * the rates are those of the window between the two, timed by the service's own
 * `process_uptime_seconds`; without it they average the whole uptime.
 */
export function summarizeMetrics(
  after: readonly Sample[],
  before: readonly Sample[] | null,
): Summary {
  const upAfter = uptime(after);
  if (upAfter === null)
    return {
      ok: false,
      error: "no process_uptime_seconds: cannot tell how long the counters cover",
    };
  const upBefore = before === null ? 0 : uptime(before);
  if (upBefore === null)
    return { ok: false, error: "the earlier snapshot has no process_uptime_seconds" };
  const seconds = upAfter - upBefore;
  if (seconds <= 0) return { ok: false, error: WENT_DOWN };
  const prev = before === null ? null : index(before);

  if (!after.some((s) => s.name === "http_server_requests_seconds_count"))
    return { ok: false, error: "no http_server_requests_seconds metrics: nothing to read" };
  const server = timers(after, prev, "http_server_requests_seconds", (l) => l.status ?? "");
  if (server === null) return { ok: false, error: WENT_DOWN };
  const all: Timer = { count: 0, sumS: 0 };
  let failed = 0;
  for (const [status, t] of server) {
    all.count += t.count;
    all.sumS += t.sumS;
    if (status.startsWith("5")) failed += t.count;
  }

  const clientTimers = timers(
    after,
    prev,
    "http_client_requests_seconds",
    (l) => l.clientName ?? "",
  );
  if (clientTimers === null) return { ok: false, error: WENT_DOWN };
  const clients: ServiceMetrics["clients"] = {};
  for (const [name, t] of clientTimers)
    clients[name] = {
      address: t.labels.address ?? null,
      rps: t.count / seconds,
      meanMs: meanMs(t),
    };

  const guards = guardsOf(after, prev);
  if (guards === null) return { ok: false, error: WENT_DOWN };
  return {
    ok: true,
    metrics: {
      seconds,
      sinceStart: before === null,
      server: {
        rps: all.count / seconds,
        meanMs: meanMs(all),
        serverErrorShare: all.count > 0 ? failed / all.count : 0,
      },
      clients,
      guards,
    },
  };
}
