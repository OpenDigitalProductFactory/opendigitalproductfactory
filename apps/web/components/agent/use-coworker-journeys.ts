"use client";

// Coworker journey hooks for AgentCoworkerShell (BI-BD0B0DCC), kept out of
// the shell so its render path gains no state. coworker-open runs from the
// commit that opens the panel to the first frame with the thread ready;
// thread-open runs from the start of a thread load to its first ready frame.

import { useLayoutEffect, useRef } from "react";
import { beginJourney, completeJourney } from "@/lib/telemetry/journeys";

export function useCoworkerJourneys(isOpen: boolean, threadLoadState: string): void {
  const wasOpen = useRef(isOpen);
  const prevLoad = useRef(threadLoadState);

  useLayoutEffect(() => {
    if (isOpen && !wasOpen.current) beginJourney("coworker-open");
    if (prevLoad.current !== "loading" && threadLoadState === "loading") beginJourney("thread-open");
    if (threadLoadState === "ready") {
      completeJourney("thread-open");
      if (isOpen) completeJourney("coworker-open");
    }
    wasOpen.current = isOpen;
    prevLoad.current = threadLoadState;
  }, [isOpen, threadLoadState]);
}
