"use client";

import { useCallback, useEffect, useState } from "react";

/** Remembered in this browser only: whether the welcome screen was already seen. */
const SEEN_KEY = "fragor.welcome.v1";

function seen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "seen";
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "seen");
  } catch {
    // Storage blocked: the welcome screen will show again next time, which is harmless.
  }
}

export type GuideState = "welcome" | "tour" | null;

/** First-visit welcome and the guided tour. Decided after mount (the page is prerendered). */
export function useGuide() {
  const [state, setState] = useState<GuideState>(null);
  useEffect(() => {
    if (!seen()) setState("welcome");
  }, []);
  const close = useCallback(() => {
    markSeen();
    setState(null);
  }, []);
  const tour = useCallback(() => {
    markSeen();
    setState("tour");
  }, []);
  const welcome = useCallback(() => setState("welcome"), []);
  return { state, close, tour, welcome };
}
