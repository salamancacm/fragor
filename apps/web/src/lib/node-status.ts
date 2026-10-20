export type NodeStatus = "idle" | "healthy" | "busy" | "saturated" | "overloaded";

/** Display status of a node in one bucket, from worker utilization and queue fill (0..1). */
export function nodeStatus(utilization: number, queueFill: number, active: boolean): NodeStatus {
  if (!active) return "idle";
  if (utilization >= 0.95) return queueFill >= 0.95 ? "overloaded" : "saturated";
  return utilization >= 0.75 ? "busy" : "healthy";
}
