import { describe, expect, it } from "vitest";
import { simulate } from "../src";
import { node, singleNode, traffic } from "./helpers";

describe("stream independence (test group 2)", () => {
  const base = singleNode({
    nodes: [node("svc", { errorRate: 0.05, workers: 2, queueLimit: 10 })],
    traffic: [traffic("web", "svc", 90)],
  });
  const before = simulate(base);

  it("adding an unconnected node does not change the other nodes' metrics", () => {
    const after = simulate({ ...base, nodes: [node("aaa-new"), ...base.nodes] });
    expect(after.series.nodes.svc).toEqual(before.series.nodes.svc);
    expect(after.summary).toEqual(before.summary);
  });

  it("adding a node with its own traffic does not change the existing node", () => {
    const after = simulate({
      ...base,
      nodes: [...base.nodes, node("other", { errorRate: 0.5 })],
      traffic: [traffic("batch", "other", 300), ...base.traffic],
    });
    expect(after.series.nodes.svc).toEqual(before.series.nodes.svc);
    expect(after.summary.roots).toBeGreaterThan(before.summary.roots);
  });
});
