# Git-Triggered Sandbox Promotion — Slice 2

## Goal

Wire the first self-update loop without allowing unattended production mutation:

GitHub push webhook -> governed candidate record -> queued sandbox rebuild -> verification evidence -> human/policy promotion later.

This slice intentionally stops at sandbox verification. It does not execute `ChangePromotion`, restart production, or mutate the running portal.

## Scope

- Add a durable `GitPromotionCandidate` model for incoming Git update events.
- Add a GitHub-compatible webhook endpoint at `/api/platform/git/updates`.
- Verify `X-Hub-Signature-256` when `DPF_GIT_WEBHOOK_SECRET` or `GITHUB_WEBHOOK_SECRET` is configured.
- Queue an Inngest job for push events on the default branch.
- Use the `BuildExecutionProvider` seam to create/start a sandbox and run a clone/install/typecheck/build verification script against the updated SHA.
- Persist status, sandbox identity, and verification output on the candidate.

## Non-Goals

- No automatic production promotion.
- No PR merge automation.
- No private-repo credential propagation beyond public clone URLs. Tokenized clone support belongs in the provider credential slice.
- No UI beyond durable records and activities.

## Verification

- Focused Vitest tests for webhook parsing, signature verification, candidate recording, dedupe, and verification script construction.
- Prisma schema validation and generation.
- Web typecheck.
- Production build.
