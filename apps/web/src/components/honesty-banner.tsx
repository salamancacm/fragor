import { Info } from "lucide-react";

export const HONESTY_LABEL = "Simulation based on your assumptions, not a prediction.";

/** Always visible: results depend on the parameters the user assumed. */
export function HonestyBanner() {
  return (
    <div
      role="note"
      className="flex items-center gap-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <Info className="size-4 shrink-0" aria-hidden />
      <span>{HONESTY_LABEL}</span>
    </div>
  );
}
