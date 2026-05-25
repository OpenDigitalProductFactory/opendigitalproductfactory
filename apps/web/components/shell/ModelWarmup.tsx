"use client";

/**
 * Reserved for future model-readiness UI. It must not perform hidden network
 * warmups: shell mount side effects created real issue reports and destabilized
 * the portal during startup.
 */
export function ModelWarmup() {
  return null;
}
