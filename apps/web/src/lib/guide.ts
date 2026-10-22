import type { FlowEvent } from "./events";

/**
 * Plain-language help for first-time visitors: what each part of the page shows and the
 * resilience terms it uses. Kept as data so the welcome screen, the tour and the "?" tips share it.
 */
export const HELP = {
  story:
    "One paragraph written from this run: what set it off, how far the trouble spread and how many users felt it.",
  success: "Requests that got a normal answer.",
  fallback:
    "Requests that got a degraded answer from a fallback (e.g. a cached or default response) instead of an error.",
  failed: "Requests that ended in an error for the user.",
  p99: "99% of requests were faster than this. It shows how bad the slowest users had it.",
  amplification:
    "Attempts per call between services. Above ×1, retries are multiplying the load on a dependency that may already be struggling.",
  flow: "Your system replayed second by second. Boxes are services; dots going right are requests, dots coming back are answers (cyan ok, violet fallback, red error). Dots falling away were rejected.",
  card: "Workers busy: threads doing work. Queue: requests waiting for a thread; when it is full, new requests get a 503. HEALTHY → BUSY → SATURATED (all threads busy) → OVERLOADED (queue full too).",
  timeline:
    "Each bar is one second: cyan answered, violet fallback, red failed. The amber band is the injected failure. Drag to move through time.",
  feed: "The run narrated: what happened and when. Click an event to jump there.",
  findings:
    "Fragor's diagnosis, from fixed rules (no AI). Open one to see the numbers behind it, or replay from that moment.",
  whatIf:
    "Change a setting (traffic, timeouts, retries, circuit breaker) and run again: every number is compared with the previous run.",
  timeout: "How long a caller waits for an answer before giving up.",
  retry: "Trying a failed call again. Helps with blips, hurts when the dependency is overloaded.",
  breaker:
    "Circuit breaker: after too many failures it stops calling the dependency for a while and fails fast (or uses the fallback), giving it room to recover.",
  bulkhead: "A cap on concurrent calls to one dependency, so it cannot use up all your threads.",
} as const;

export type HelpKey = keyof typeof HELP;

/** Where the tour can point: elements marked with `data-tour="<id>"`. */
export type TourTarget =
  | "story"
  | "kpis"
  | "stage"
  | "transport"
  | "feed"
  | "findings"
  | "what-if"
  | "your-scenario";

export interface TourStep {
  id: string;
  target: TourTarget;
  title: string;
  body: string;
  /** Move the replay before showing the step: to its start, or to the first moment of trouble. */
  replay?: "start" | "trouble";
}

/** The guided tour, written for example 01 (a slow payment API) but valid for any run. */
export const TOUR: readonly TourStep[] = [
  {
    id: "story",
    target: "story",
    title: "What happened, in one sentence",
    body: "Fragor simulated a small online shop for 60 seconds while its payment provider got 5 seconds slower. This line is written from the results.",
    replay: "start",
  },
  {
    id: "kpis",
    target: "kpis",
    title: "The numbers that matter",
    body: "How many users got an answer, a fallback or an error, how slow the slowest were, and whether retries multiplied the load. The small charts show each one over time.",
  },
  {
    id: "stage",
    target: "stage",
    title: "Your system, replayed",
    body: "Each box is a service. Dots going right are requests, dots coming back are answers: cyan ok, red error. Watch the boxes fill up and turn red as the slowdown spreads from right to left.",
    replay: "trouble",
  },
  {
    id: "transport",
    target: "transport",
    title: "Control time",
    body: "Pause, change the speed or drag through the run. The amber band is when the failure was active; each bar shows how the requests of that second ended.",
  },
  {
    id: "feed",
    target: "feed",
    title: "The story as it unfolds",
    body: "Each key moment, in order: the failure starts, a service runs out of threads, a retry storm, users see errors. Click one to jump there.",
  },
  {
    id: "findings",
    target: "findings",
    title: "Why it happened",
    body: "Fragor's diagnosis, with the numbers behind each point. Open one to see the evidence, or press “at 11 s ▸” to replay from that moment.",
  },
  {
    id: "what-if",
    target: "what-if",
    title: "Now try a fix",
    body: "Turn on the circuit breaker on order → payment and press Run in the top bar. Fragor compares the new run with this one: every number shows the difference.",
  },
  {
    id: "your-scenario",
    target: "your-scenario",
    title: "Then try your own system",
    body: "Fragor does not connect to your services: you describe them with a few numbers you already know (threads, response times, traffic) and pick what fails.",
  },
];

/** Replay time to show "trouble": a little after the first bad event, else the start. */
export function troubleMoment(events: readonly FlowEvent[]): number {
  const first = events.find((e) => e.tone === "bad" || e.tone === "warn");
  return first === undefined ? 0 : first.tMs + 1500;
}
