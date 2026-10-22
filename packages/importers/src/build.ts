import type { CallSpec, EdgeSpec, NodeSpec, Scenario, TrafficSpec } from "@fragor/engine";
import { type PatchOp, safeParseScenario } from "@fragor/scenarios";
import { applyAnswers, finalizeEntries } from "./answers";
import { Notes, orAssumed } from "./notes";
import type { ObservedCall, ObservedService, ObservedSystem } from "./observed";
import { checkObserved } from "./observed";
import { constantTime, HINTS, lognormal, PLACEHOLDERS } from "./placeholders";
import { buildPolicies } from "./policies";
import { countByOrigin, type ImportReport } from "./report";

export interface BuildOptions {
  /**
   * Edits by the user, as the typed patches the CLI and the web app already use (only `set` and
   * `unset`). What they touch becomes origin `user` and stops being an open question.
   */
  answers?: readonly PatchOp[];
}

export type BuildResult =
  | { ok: true; scenario: Scenario; report: ImportReport }
  | { ok: false; errors: string[] };

function buildNode(s: ObservedService, calls: readonly ObservedCall[], notes: Notes): NodeSpec {
  const external = s.kind === "external-api";
  const at = (field: string) => `nodes.${s.id}.${field}`;
  const workers = orAssumed(
    s.workers,
    external ? PLACEHOLDERS.externalWorkers : PLACEHOLDERS.workers,
    external
      ? "a third party's API is modeled roomy, so its slowness comes from faults, not saturation"
      : "not observed: placeholder",
  );
  const queueLimit = orAssumed<number | null>(
    s.queueLimit,
    external ? null : PLACEHOLDERS.queueLimit,
    external ? "unbounded: a third party's API is modeled roomy" : "not observed: placeholder",
  );
  const workerModel = orAssumed(
    s.workerModel,
    PLACEHOLDERS.workerModel,
    "not observed: placeholder",
  );
  const serviceTime = orAssumed(
    s.serviceTime,
    { p50Ms: PLACEHOLDERS.serviceTimeMs, p99Ms: PLACEHOLDERS.serviceTimeMs },
    `not observed: a constant ${PLACEHOLDERS.serviceTimeMs} ms placeholder`,
  );
  const errorRate = orAssumed(s.errorRate, PLACEHOLDERS.errorRate, "not observed: none assumed");
  const dist =
    s.serviceTime === undefined
      ? constantTime(PLACEHOLDERS.serviceTimeMs)
      : lognormal(serviceTime.value);

  notes.add(at("workers"), workers.value, workers);
  notes.add(at("queueLimit"), queueLimit.value, queueLimit);
  notes.add(at("workerModel"), workerModel.value, workerModel);
  notes.add(at("serviceTime"), dist, serviceTime);
  notes.add(at("errorRate"), errorRate.value, errorRate);
  if (!external) {
    if (workers.origin === "assumed")
      notes.ask(
        at("workers"),
        `How many worker threads does ${s.name} have?`,
        HINTS.workers,
        workers.value,
      );
    if (queueLimit.origin === "assumed")
      notes.ask(
        at("queueLimit"),
        `How many requests can wait for a thread in ${s.name}?`,
        HINTS.queueLimit,
        queueLimit.value,
      );
    if (workerModel.origin === "assumed")
      notes.ask(
        at("workerModel"),
        `Does a thread of ${s.name} wait for its dependencies?`,
        HINTS.workerModel,
        workerModel.value,
      );
  }
  if (serviceTime.origin === "assumed")
    notes.ask(
      at("serviceTime"),
      `How long does ${s.name} take on its own?`,
      HINTS.serviceTime,
      dist,
    );

  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    workers: workers.value,
    queueLimit: queueLimit.value,
    workerModel: workerModel.value,
    serviceTime: dist,
    errorRate: errorRate.value,
    calls: calls.map((c, k) => buildCall(c, k, s.id, notes)),
  };
}

function buildCall(c: ObservedCall, k: number, from: string, notes: Notes): CallSpec {
  const p = orAssumed(
    c.probability,
    PLACEHOLDERS.probability,
    "not observed: every request makes the call",
  );
  notes.add(`nodes.${from}.calls.${k}.probability`, p.value, p);
  return { edgeId: c.id, ...(p.value === 1 ? {} : { probability: p.value }) };
}

function buildEdge(c: ObservedCall, notes: Notes): EdgeSpec {
  const network = orAssumed(c.networkMs, PLACEHOLDERS.networkMs, "not observed: placeholder");
  const latency = constantTime(network.value);
  notes.add(`edges.${c.id}.latency`, latency, network);
  notes.add(`edges.${c.id}.packetLoss`, PLACEHOLDERS.packetLoss, {
    origin: "assumed",
    detail: "not observed: no packet loss",
  });
  return {
    id: c.id,
    from: c.from,
    to: c.to,
    latency,
    packetLoss: PLACEHOLDERS.packetLoss,
    policies: buildPolicies(c, notes),
  };
}

function buildTraffic(o: ObservedSystem, notes: Notes): TrafficSpec[] {
  return o.traffic.map((t) => {
    const type = t.arrivals?.value ?? "poisson";
    const pattern = { type, rps: t.rps.value };
    const shape = t.arrivals === undefined ? "Poisson (assumed)" : `${type} (${t.arrivals.origin})`;
    notes.add(`traffic.${t.id}.pattern`, pattern, {
      origin: t.rps.origin,
      detail: `${t.rps.detail}; arrivals modeled as ${shape}`,
    });
    return { id: t.id, target: t.target, pattern };
  });
}

/** Services no traffic reaches, directly or through calls: they would never run. */
function unreachable(o: ObservedSystem): string[] {
  const reached = new Set(o.traffic.map((t) => t.target));
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of o.calls)
      if (reached.has(c.from) && !reached.has(c.to)) {
        reached.add(c.to);
        grew = true;
      }
  }
  return o.services
    .filter((s) => !reached.has(s.id))
    .map((s) => `Service "${s.id}" receives no traffic and no call reaches it: it will stay idle.`);
}

/**
 * Builds a draft scenario from an observed system, plus a report saying where every number came
 * from. Observed values are used as they are; what the data did not say gets an explicit
 * placeholder, marked `assumed` and listed as a question. Pure: same input, same output.
 */
export function buildScenario(o: ObservedSystem, options: BuildOptions = {}): BuildResult {
  const problems = checkObserved(o);
  if (problems.length > 0) return { ok: false, errors: problems };

  const notes = new Notes();
  const nodes = o.services.map((s) =>
    buildNode(
      s,
      o.calls.filter((c) => c.from === s.id),
      notes,
    ),
  );
  const edges = o.calls.map((c) => buildEdge(c, notes));
  const traffic = buildTraffic(o, notes);
  notes.add("durationMs", PLACEHOLDERS.horizonMs, {
    origin: "assumed",
    detail: `simulated length of the draft; the observed window was ${o.window.description}`,
  });
  const draft: Scenario = {
    schemaVersion: 1,
    name: o.name,
    description: `Imported from ${o.source}; observed ${o.window.description}.`,
    seed: PLACEHOLDERS.seed,
    durationMs: PLACEHOLDERS.horizonMs,
    nodes,
    edges,
    traffic,
    faults: [],
  };

  const checked = safeParseScenario(draft);
  if (!checked.ok)
    return { ok: false, errors: checked.issues.map((i) => `${i.path}: ${i.message}`) };

  const answers = options.answers ?? [];
  const applied = applyAnswers(checked.scenario, answers);
  if (!applied.ok) return { ok: false, errors: applied.errors };

  const { entries, questions } = finalizeEntries(
    applied.scenario,
    notes.entries,
    notes.questions,
    answers,
  );
  const report: ImportReport = {
    version: 1,
    system: o.name,
    source: o.source,
    window: `${o.window.description} (${o.window.durationMs} ms)`,
    entries,
    questions,
    counts: countByOrigin(entries),
    warnings: unreachable(o),
  };
  return { ok: true, scenario: applied.scenario, report };
}
