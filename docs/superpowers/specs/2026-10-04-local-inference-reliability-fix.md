# Local inference completion reliability — BI-B550D9E5

## Evidence and boundary

The operator's development install v2026.10.02 reports `local-runner-busy` before the existing
inference admission queue can wait. At source baseline
502a71f3ada1cefbbdf6f945be237ed4e410f273, callProvider checks host GPU before
acquireInferenceSlot. The deliberation catch marks this temporary deferral failed.
The chat adapter substitutes reasoning for missing content; deliberation ignores
the propagated truncated flag. Live telemetry recorded 94 of 372 local calls at
the 4096-token ceiling over 24 hours, with scratchpad text stored as positions.
Short triage calls have a counterexample: 165 calls with none at the ceiling.

This is distinct from BI-50B0C471 (native review terminal writer), BI-A8BFEFCE
(failed capacity probes) and BI-40230C6F (local CI executor polling). It extends
the existing BI-285EF102 admission and BI-5098ECEC capacity-deferral contracts.

## Objectives and acceptance

1. Internal callers enter the existing priority semaphore before GPU inspection.
   Recheck host lease and GPU ownership at dispatch; release the slot on every
   outcome. External GPU contention still defers; no policy is relaxed.
2. Temporary deliberation capacity deferrals leave work resumable and prevent
   synthesis/sealing. Use bounded durable job waits, retain completed branch
   outputs, and bind background work to autonomous admission priority.
3. Answer text remains separate from reasoning. A truncated or empty answer
   cannot become a completed panel position or an accepted consensus. Preserve
   the failure evidence and observed token cost.
4. Tests demonstrate prior failure and fixed behavior, including resume with a
   completed branch and safe exhaustion of retry budget. Verify contention and
   complete answers against the canonical served target before declaring reliable.

## Ordered implementation plan

1. Add failing regression cases around callProvider admission ordering, the
   reasoning-only adapter response, and deliberation deferral/truncation/resume.
2. Move dispatch safety checks inside acquired admission, sharing the existing
   primitive rather than adding a second queue. This boundary refactor and reuse
   of the capacity classifier are approximately 20% of implementation effort.
3. Preserve reasoning only as reasoning; classify incomplete branch answers at
   the branch boundary. Resume stored complete positions and preserve run metadata.
4. Return a capacity-deferred core outcome to the existing durable job wrapper;
   wait and resume within a finite retry budget. Exhaustion stays observable and
   must never invent a verdict from a missing branch.
5. Run affected unit suites and package typecheck, push a DCO-signed PR, use the
   cloud build gate and canonical upgrade/verification path. Update operational
   guidance for waiting versus failure and answer completeness.

## Compatibility and non-goals

No schema or migration, new queue, package, model replacement, credential change,
or GPU-capacity override. Existing complete content and tool-call behavior remain
supported. Build code-gen exclusion is investigated separately: preserve provider
allowlists and capability floors and fix only an evidenced contract defect.
No new UI surface: existing progress events communicate waiting and completion.

## Verification and stop condition

Affected suites: ai-inference.call-provider, chat-adapter, deliberation-run and
branch-execution; package typecheck. Canonical functional evidence must show a
second call waits safely, a deferred panel resumes without repeating completed
branches, and incomplete output never seals an answer. Missing runtime evidence
is reported unverified. Stop a denied operation rather than bypassing authority.
