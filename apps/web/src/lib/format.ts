export function pct(v: number | null, digits = 1): string {
  return v === null ? "–" : `${(v * 100).toFixed(digits)}%`;
}

export function ms(v: number | null): string {
  if (v === null) return "–";
  if (v >= 10_000) return `${(v / 1000).toFixed(1)} s`;
  return v >= 100 ? `${Math.round(v)} ms` : `${v.toFixed(1)} ms`;
}

export function count(v: number | null): string {
  return v === null ? "–" : new Intl.NumberFormat("en-US").format(Math.round(v));
}

export function seconds(msValue: number): string {
  return `${(msValue / 1000).toFixed(1)} s`;
}
