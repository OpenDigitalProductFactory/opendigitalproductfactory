# Governed marketing media tool evaluation

**Backlog item:** `BI-0C891AC7`
**Epic:** `EP-MARKETING`
**Work Capsule:** `WC-6B6B0FC6`
**Status:** In progress

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Give the marketing execution loop one vendor-neutral media contract and an evidence-backed way to choose local rendering, speech, captions, editing, and reframing tools. A provider is selectable only when its advertised capability is supported and its `ToolEvaluation` posture permits the intended environment. Unsupported operations return a structured result; they never fail silently or masquerade as success.

This plan extends the existing `ToolEvaluation`, approved-tool registry, marketing channel-adapter, media-asset, and AI-provider substrate. It adds no Prisma model, no second tool catalog, and no hard-coded production provider.

## Backlog coverage

- Decision: atomic
- Parent: `BI-0C891AC7`
- Receipt: `cmsb7ck2a06p301tcnsvxrhkq`
- Dependencies: none; the table below records the internal phase order within this single atomic BI.
- Rationale: the contract, candidate dispositions, and probe receipts form one approval boundary. None is safely usable without the others.

| Deliverable | Independent | Depends on | BI |
| --- | --- | --- | --- |
| Typed media capability and unsupported-response contract | No | — | `BI-0C891AC7` |
| Evidence-backed candidate evaluations | No | Media contract | `BI-0C891AC7` |
| Local render and cloud-candidate probe receipts | No | Candidate evaluations | `BI-0C891AC7` |

## Grounding

- Tool governance: `ToolEvaluation`, `apps/web/lib/evaluate/tool-evaluation.ts`, and `packages/db/data/approved_tools_registry.json` already own proposal, findings, verdict, conditions, and approval posture.
- Marketing execution: `apps/web/lib/marketing/channels/contracts.ts` already uses explicit adapter capabilities and validation results.
- Media storage: the platform already accepts governed media assets; this work describes generation operations rather than adding another asset store.
- Speech: local TTS and voice-service continuity already exist. Cloud TTS is an optional conduit, not the platform default.
- Encoding: FFmpeg is already a platform dependency for audio/video handling on supported hosts. The evaluation verifies and pins the distribution/build contract instead of adding a duplicate wrapper.
- Provenance: C2PA Content Credentials 2.4 is the current interoperability target. Provenance support is advertised separately from generation so callers can require it.

## Phase 1 — Contract, tests, and refusal semantics

**Deliverable:** `apps/web/lib/marketing/media-capabilities.ts` plus focused tests.

Define closed capabilities for image generation, video generation, TTS, captions, editing, reframing, and provenance. Define a provider descriptor that reports support status per capability and a structured `UNSUPPORTED_OPERATION` result carrying provider, requested capability, and a safe reason. Provide pure selectors that reject inactive evaluation posture, missing capabilities, and environment-condition mismatches before any provider code runs.

**Refactor budget:** keep capability normalization, selection, and refusal construction as small pure functions rather than spreading vendor checks through marketing routes. This is the planned 20% refactor investment for the slice.

**Verification:** focused Vitest covers supported selection, conditional selection, environment refusal, missing capability, provenance requirement, and deterministic preference.

## Phase 2 — Evidence-backed candidate dispositions

**Deliverable:** `docs/security/tool-evaluations/2026-08-01-marketing-media-stack.md` and live `ToolEvaluation` records.

Evaluate exact versions from primary sources across licensing/commercial use, privacy and retention, data egress, cost/latency, determinism, offline operation, accessibility, safety, provenance, supply chain, pinning, and rollback. Initiate live records for HyperFrames, Remotion, and Gemini TTS. Treat FFmpeg as verified existing substrate whose exact distribution and configure flags must be captured by the probe.

Initial recommendation boundaries:

- HyperFrames: candidate for conditional sandbox/local approval after deterministic render evidence.
- FFmpeg: existing local encoding foundation; conditional on an exact binary/build fingerprint and license-compatible configure flags.
- Remotion: evaluated alternative, not a default dependency; commercial licensing is a material condition at four or more people and for automated rendering.
- Gemini TTS: cloud-candidate only while preview; paid-tier business use, no sensitive inputs, and no deterministic-byte guarantee.

No entry is added to `approved_tools_registry.json` until the Tool Evaluation approval gate records an approved or conditional verdict.

**Verification:** evaluation rows exist at the pinned versions; every recommendation cites primary evidence; registry diff remains empty until approval.

## Phase 3 — Repeatable probes and receipts

**Deliverable:** scripts and evidence under `scripts/probes/marketing-media/`.

1. Render a 45–60 second, captions-on, synthetic marketing composition twice in the governed sandbox with pinned HyperFrames and FFmpeg inputs. Record tool versions, source tree hash, command, durations, output hashes, media probe data, and whether outputs are byte-identical. If MP4 container metadata prevents byte identity, compare normalized frame/audio hashes and record the distinction honestly.
2. Run one bounded Gemini TTS paid-tier probe using non-sensitive synthetic copy. Record model id, request-shape hash, response metadata, latency, cost estimate, output media properties, safety/provenance metadata, and deletion/retention posture. Do not store credentials or claim deterministic output.

**Verification:** each receipt is machine-readable, names the exact candidate/evaluation id, and can be replayed without relying on shell history. Cloud unavailability produces a bounded `blocked_external_configuration` receipt rather than a fabricated pass.

## Completion gate

- Focused tests and web typecheck pass.
- Governed merged-code local CI passes, including the production build.
- Candidate evidence and probe receipts are committed without secrets or customer data.
- ToolEvaluation dispositions are recorded; approved registry contains only gate-approved candidates.
- Documentation impact is satisfied by the evaluation record and this implementation plan. There is no end-user workflow change in this slice, so no user-guide or UX run is required.

## Risks and rollback

| Risk | Control | Rollback |
| --- | --- | --- |
| Preview/provider behavior changes | Exact model/version evidence and short re-evaluation date | Suspend descriptor/evaluation; local path remains available |
| Arbitrary HTML or browser capture escapes | Sandbox-only condition, bounded inputs, no host credentials | Remove candidate descriptor and revoke approval |
| License obligations drift with FFmpeg build flags | Capture configure flags and binary source; fail on unknown GPL/nonfree posture | Revert to prior verified image/binary |
| Generative output lacks provenance | Separate provenance capability; require C2PA when policy demands it | Refuse publication or add a governed signing step |
| A provider silently omits a feature | Closed capability map and structured unsupported response | Disable the capability without changing callers |
