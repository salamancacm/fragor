import type { Scenario } from "@fragor/engine";
import { parseScenario } from "@fragor/scenarios";
import ex01 from "@fragor/scenarios/examples/01-payment-slow-baseline.json";
import ex02 from "@fragor/scenarios/examples/02-payment-slow-with-breaker.json";
import ex03 from "@fragor/scenarios/examples/03-cascade-blast-radius.json";
import ex04 from "@fragor/scenarios/examples/04-cascade-with-bulkhead.json";
import ex05 from "@fragor/scenarios/examples/05-traffic-spike-10x.json";
import ex06 from "@fragor/scenarios/examples/06-retry-storm-jitter.json";

export interface Example {
  file: string;
  title: string;
  scenario: Scenario;
}

const RAW: [string, string, unknown][] = [
  ["01-payment-slow-baseline", "01 · Slow payment API (timeout + retries)", ex01],
  ["02-payment-slow-with-breaker", "02 · Slow payment API + circuit breaker", ex02],
  ["03-cascade-blast-radius", "03 · Cascade: blast radius", ex03],
  ["04-cascade-with-bulkhead", "04 · Cascade contained by a bulkhead", ex04],
  ["05-traffic-spike-10x", "05 · 10x traffic spike", ex05],
  ["06-retry-storm-jitter", "06 · Retry storm without jitter", ex06],
];

/** The canonical scenarios, validated with the same schema as any user scenario. */
export const EXAMPLES: Example[] = RAW.map(([file, title, raw]) => ({
  file,
  title,
  scenario: parseScenario(raw),
}));
