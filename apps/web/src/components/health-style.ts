import type { Health } from "@/lib/health";

/** Node card classes per health. Health is also shown as text, never by color alone. */
export const NODE_CLASSES: Record<Health, string> = {
  idle: "border-border bg-muted/40 text-muted-foreground",
  healthy: "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40",
  stressed: "border-amber-500 bg-amber-50 dark:bg-amber-950/40",
  critical: "border-red-500 bg-red-50 dark:bg-red-950/40",
};

export const EDGE_COLORS: Record<Health, string> = {
  idle: "#a3a3a3",
  healthy: "#10b981",
  stressed: "#f59e0b",
  critical: "#ef4444",
};

export const HEALTH_LABEL: Record<Health, string> = {
  idle: "idle",
  healthy: "healthy",
  stressed: "stressed",
  critical: "critical",
};

/** Distinct series colors for per-node and per-edge charts. */
export const SERIES_COLORS = [
  "#2563eb",
  "#db2777",
  "#16a34a",
  "#ea580c",
  "#7c3aed",
  "#0891b2",
  "#ca8a04",
];
