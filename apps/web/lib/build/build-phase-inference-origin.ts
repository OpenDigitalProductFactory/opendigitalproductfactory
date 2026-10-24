// apps/web/lib/build/build-phase-inference-origin.ts
//
// Build Studio phases are background deliverable work: no human is waiting on
// the reply, the build canvas shows progress asynchronously. The inference
// admission gate is origin-aware — "interactive" fails fast (a person waits),
// "autonomous" queues patiently behind interactive turns and runs when a slot
// frees. Every build-phase dispatch runs under the autonomous origin through
// this one wrapper so background build work is booked, not turned away
// (BI-2F9DE752: 92 local admission timeouts in 30 minutes while the local
// model answered a direct completion in two seconds).

import { withInferenceOrigin } from "@/lib/inference/inference-admission";

export function runAsBuildPhase<T>(fn: () => T): T {
  return withInferenceOrigin("autonomous", fn);
}
