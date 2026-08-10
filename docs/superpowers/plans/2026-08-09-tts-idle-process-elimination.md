# TTS idle process elimination (BI-A0A0568F)

**Backlog item:** `BI-A0A0568F`  
**Epic:** `EP-413F2602`  
**Date:** 2026-08-09  
**Status:** decision + first enforcement slice (profile gate + memory cap)

## Problem

`dpf-tts` (Chatterbox) is a dedicated compose sidecar. Even when speech is unused, an enabled profile keeps a multi-hundred-MiB–GiB process alive and can reserve a GPU. Idle-unload and CPU-tier work reduce the tax but leave a permanent process boundary when the profile is on.

## Options considered

| Option | RAM when idle | Cold start | Fit |
| --- | --- | --- | --- |
| A. Always-on sidecar (status quo) | High (~0.5–0.8 GiB+) | Low | Reject for idle installs |
| B. Profile-gated + resource-capped sidecar (this slice) | Zero when profile off; capped when on | Medium | **Adopt now** |
| C. On-demand start/stop on first speak | Near-zero idle | Higher first-speak latency | Next implementation slice |
| D. Host-native TTS only | Host-dependent | Medium | Keep for Apple Silicon; not sole Windows path yet |
| E. Managed API default | Zero local | Network | Opt-in only |

## Decision

1. **Never promote `dpf-tts` to always-on.** It stays under `runtime-local-speech` / `tts` profiles only.
2. **Declare a hard memory/CPU limit** in compose (`config/install-resource-budgets.json` optional entry) so a loaded profile cannot unbounded-grow system RAM.
3. **Next slice (not this PR):** governed on-demand lifecycle (start on first speak, stop after idle) reusing capability projection — that eliminates residual idle RSS when speech is enabled but unused.
4. Do **not** re-implement idle-unload (BI-635CB133) or CPU-tier policy (BI-FA130CFE); compose with them.

## Evidence hooks

- Operator idle inventory: install ~7.4 GiB containers; `dpf-tts` ~0.5–0.7 GiB system RAM when up.
- Compose: `docker-compose.yml` `dpf-tts` profiles + deploy limits.

## Acceptance mapping

| Criterion | This PR | Follow-on |
| --- | --- | --- |
| Written decision with options | Yes (this file) | — |
| Eliminate always-on or document residual | Profile gate + cap; residual only when profile enabled | On-demand stop |
| Voice happy path after warm-up | Unchanged | Measure latency budget |
| Health semantics for cold state | Existing probe contract | Update for intentional cold |

## Related

- BI-4F3AB6B3 born-bounded budgets (same release-gate substrate)
- BI-635CB133, BI-FA130CFE, BI-0EA761AF (do not duplicate)
