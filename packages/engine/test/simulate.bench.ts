import { expect, test } from "vitest";
import { type Scenario, simulate } from "../src";
import { example } from "./examples";

// Bind once: Vitest warns when a benchmark reads module export getters on every iteration.
const run = simulate;

/** Scenario 01 (60 s virtual, 4 nodes) with its traffic scaled to `rps`. */
function at(rps: number): Scenario {
  const s = example("01-payment-slow-baseline.json");
  for (const t of s.traffic) t.pattern = { type: "poisson", rps };
  return s;
}

// Budget (test group 14): < 500 ms of wall clock at 100 rps and < 5 s at 1000 rps.
// Runs only with `pnpm bench` (Vitest benchmark project), never in `pnpm test`.
test("scenario 01 at 100 rps stays under 500 ms", async ({ bench }) => {
  const scenario = at(100);
  const result = await bench("01 @ 100 rps", () => {
    run(scenario);
  }).run({ iterations: 20, time: 0 });
  console.info(
    `01 @ 100 rps: mean ${result.latency.mean.toFixed(1)} ms, max ${result.latency.max.toFixed(1)} ms`,
  );
  expect(result.latency.mean).toBeLessThan(500);
});

test("scenario 01 at 1000 rps stays under 5 s", { timeout: 120_000 }, async ({ bench }) => {
  const scenario = at(1000);
  const result = await bench("01 @ 1000 rps", () => {
    run(scenario);
  }).run({ iterations: 3, time: 0 });
  console.info(
    `01 @ 1000 rps: mean ${result.latency.mean.toFixed(1)} ms, max ${result.latency.max.toFixed(1)} ms`,
  );
  expect(result.latency.mean).toBeLessThan(5000);
});
