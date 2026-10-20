import { Info } from "lucide-react";

export const HONESTY_LABEL = "Simulation based on your assumptions, not a prediction.";

/** Always visible: results depend on the parameters the user assumed. */
export function HonestyBanner() {
  return (
    <div
      role="note"
      className="flex items-center gap-2 rounded-full border border-warn/50 bg-warn/10 px-3 py-1 text-xs text-warn"
    >
      <Info className="size-3.5 shrink-0" aria-hidden />
      <span>{HONESTY_LABEL}</span>
    </div>
  );
}
