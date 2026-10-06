import { it } from "vitest";
import { simulate } from "../src";
import { example } from "./examples";

it("explore", () => {
  for (const f of [
    "03-cascade-blast-radius.json",
    "04-cascade-with-bulkhead.json",
    "05-traffic-spike-10x.json",
    "06-retry-storm-jitter.json",
  ]) {
    const sc = example(f);
    const r = simulate(sc);
    console.log(f, JSON.stringify(r.summary), r.stats.wallClockMs.toFixed(0));
    if (f.startsWith("03") || f.startsWith("04"))
      console.log(
        "gw util",
        r.series.nodes.gateway?.utilization?.map((u) => u.toFixed(2)).join(" "),
      );
    if (f.startsWith("05"))
      console.log(
        "api 503",
        r.series.nodes.api?.rejected503.join(" "),
        "p99",
        r.series.global.p99Ms.map((x) => x?.toFixed(0)).join(" "),
      );
    if (f.startsWith("06")) {
      for (const j of [0, 500]) {
        const s2 = structuredClone(sc);
        const e = s2.edges[0];
        if (e?.policies.retry) e.policies.retry.jitterMs = j;
        const r2 = simulate(s2);
        console.log(
          "jitter",
          j,
          JSON.stringify(r2.summary.byTraffic),
          "retries",
          r2.summary.retries,
          "api arr",
          r2.series.nodes.api?.arrivals.slice(45, 110).join(" "),
        );
      }
    }
  }
});
