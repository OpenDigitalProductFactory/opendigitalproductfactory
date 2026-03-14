"use client";

import { useEffect } from "react";
import { flushQueue } from "@/lib/quality-queue";

export function QueueFlusher() {
  useEffect(() => {
    flushQueue().catch(() => {});
  }, []);
  return null;
}
