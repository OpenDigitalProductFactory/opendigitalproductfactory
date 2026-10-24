---
status: active
---

# Plan — Speech becomes provider-managed

**OBJ-ID:** BI-F7E9A541
**Owning spec:** [2026-09-09-speech-provider-managed-design.md](../specs/2026-09-09-speech-provider-managed-design.md)
**Branch:** `refactor/speech-provider-managed`
**Base:** `origin/main` @ `9819499805a`

Single slice. Every deliverable below lands in one PR because removing the shipped image and repointing the seed cannot be split without leaving an install whose transcription endpoint resolves to a service that no longer exists.

## Deliverables, in order

| # | Deliverable | Files | State |
| --- | --- | --- | --- |
| 1 | Delete the `dpf-stt` service block, its digest pin and its volume from shipped Compose | `docker-compose.yml` | done |
| 2 | Drop the service from the substrate manifest and regenerate the capability catalog | `scripts/platform-substrate-manifest.json`, `scripts/capability-service-catalog.generated.json` | done |
| 3 | Retire the digest watcher, its re-resolve script and its two tests; deregister them from the policy guards | `.github/workflows/stt-digest-watch.yml`, `scripts/release/re-resolve-stt-digest*.mjs`, `scripts/stt-digest-watch-workflow.test.mjs`, `scripts/lib/ci-policy-guards.mjs` | done |
| 4 | Repoint the self-hosted provider entry to an operator-supplied base URL | `packages/db/data/providers-registry.json` | done |
| 5 | Seed a transcription model per OpenAI-compatible provider, self-hosted ranked first | `packages/db/src/voice-stt-providers.ts`, `packages/db/src/seed.ts` | done |
| 6 | Retire any profile left pointing at the removed sidecar, so resolution cannot select a dead endpoint | `packages/db/src/seed.ts` | done |
| 7 | Correct operator-facing readiness copy that still names a sidecar | `apps/web/lib/voice/readiness.ts`, `apps/web/lib/voice/bias-classification-gate.ts` | done |
| 8 | Remove the installers' defensive pre-pull and scale-to-0 workaround for the rotting digest | `install-dpf.sh`, `install-dpf.ps1` | done |
| 9 | Correct monitoring comments and the stale local-audio claim in the inference layer | `monitoring/prometheus/prometheus.yml`, `monitoring/alloy/config.alloy`, `apps/web/lib/inference/ai-inference.ts` | done |
| 10 | Rewrite the seed and contract tests against the provider-managed shape | `packages/db/src/voice-stt-providers.test.ts`, `packages/db/test/voice-stt-provider-contract.test.ts`, `apps/web/lib/voice/readiness.test.ts` | done |
| 11 | Update the capability profile table, install guides and observability coverage | `docs/architecture/capability-driven-runtime-profiles.md`, `docs/install/*.md`, `docs/operations/observability-coverage.md` | done |

## Traceability

| AC (spec §7) | Deliverable | Verifying test |
| --- | --- | --- |
| AC1 no digest-pinned third-party image | 1 | `voice-stt-provider-contract.test.ts` — "pins no third-party image by digest" |
| AC2 configuring a provider enables voice | 5 | `voice-stt-providers.test.ts` — seeded provider set; resolution already skips inactive providers |
| AC3 no dead default endpoint | 4, 6 | `voice-stt-provider-contract.test.ts` — "leaves the self-hosted provider's base URL for the operator to supply" |
| AC4 self-host through provider config alone | 4, 11 | contract test + install guide |
| AC5 no stale `dpf-stt` references | 2, 8, 9 | contract test + repo grep |
| AC6 watcher gone | 3 | contract test — "registers no watcher test in the policy guards" |

## Verification performed

- `voice-stt-providers.test.ts` 16 passed; `voice-stt-provider-contract.test.ts` 8 passed.
- **Guard proved against the unfixed tree**: with `docker-compose.yml`, `providers-registry.json` and `ci-policy-guards.mjs` stashed back to `origin/main`, the contract test fails 5 of 8 — the three Compose guards, the base-URL guard and the watcher guard. All 8 pass with the change applied.
- `apps/web/lib/voice/` 97 passed across 7 files.
- `scripts/lib/capability-service-projection.test.mjs` 19 passed.
- `@dpf/db` typecheck clean.
- Pre-existing and unrelated: the `@dpf/db` Prisma model tests fail in a worktree because no PostgreSQL is attached. Same on `origin/main`.

## Rollback

Revert the PR. No migration is involved. An operator who had `runtime-local-speech` enabled for speech-to-text keeps their volume and data — the capability architecture never deletes optional volumes on deactivation — and restores speech by configuring a provider or pointing the self-hosted entry at their own container.
