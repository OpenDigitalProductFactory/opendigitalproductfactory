# Feedback Intake Relay Service — Phase B Design Note

| Field | Value |
| ----- | ----- |
| Status | Decision note (awaiting operator hosting decision) |
| Date | 2026-06-07 |
| Backlog item | `BI-6D45BA27` (Phase B) |
| Builds on | [Zero-config upstream feedback escalation (Phase A, merged PR #1629)](2026-06-06-zero-config-upstream-feedback-escalation-design.md) |
| Decision owner | Mark Bodman |

## Purpose

Phase A shipped everything **inside the portal**: an install-authenticated client that POSTs a redacted report to `upstreamRelayUrl`. What does not yet exist is the **thing on the other end of that URL** — the hosted service that holds the GitHub credential and files the issue. Until it exists, a consumer install (no GitHub token) reaches `skipped`, not `filed`. Phase B builds that service.

This note exists to get **one decision from the operator: where the relay runs and how it authenticates to GitHub** — the rest follows.

## What the relay must do (contract — already fixed by Phase A)

Accept `POST <relayUrl>`:

```
Headers: X-DPF-Install-Id: dpf-agent-<shortId>   (Phase A; hardened below)
Body:    { title, body, labels[], pseudonym, localRef }   (already redacted client-side)
→ 201   { issueNumber: number, url: string }
→ 4xx/5xx { error: string }
```

The portal already handles every response shape (`feedback-transport.ts` `RelayTransport`). So the relay is a small, well-bounded service: validate → re-redact (defense in depth) → file a GitHub issue → return the number/url.

## Decision 1 — Where it runs (pick one)

| Option | What it is | Pros | Cons |
| ------ | ---------- | ---- | ---- |
| **A. Serverless endpoint (Recommended)** | A single function (Cloudflare Worker / Vercel Edge / AWS Lambda) at e.g. `relay.opendigitalproductfactory.org` | Scales to zero (~free at this volume); minimal ops; secret stored in the platform's secret manager; trivial to stand up | One more deployable + domain + secret to own |
| **B. Route on existing hive/back-office infra** | Add `POST /relay/feedback` to whatever already hosts the hive/community backend | Reuses existing ops, secrets, monitoring; no new deployable | Couples feedback availability to that service; only viable if such a service already exists |
| **C. GitHub Actions `repository_dispatch`** | Relay is a thin proxy that triggers a workflow which opens the issue | No long-lived server | Awkward (needs a dispatch token anyway), slow, poor error surface — not recommended |

**Recommendation: A.** It's the smallest, cheapest, most isolated option and matches the "conduit, not broker" stance. B is fine *if* a suitable hosted service already exists — worth confirming before defaulting to A.

## Decision 2 — How the relay authenticates to GitHub

| Option | Notes |
| ------ | ----- |
| **GitHub App installation token (Recommended)** | Scoped to `issues:write` on the upstream repo only; auto-rotating short-lived tokens; per-repo; higher rate limits; revocable without rotating a shared PAT. Standard for server-to-server GitHub automation. |
| Fine-grained PAT | Simpler to set up, but a long-lived secret to rotate manually; lower rate limits. Acceptable interim. |

**Recommendation: GitHub App.** The credential lives only in the relay's secret store and never touches any customer install — which is the whole point of Phase A's design.

## Decision 3 — Install → relay authentication (hardening Phase A)

Phase A sends the pseudonym in `X-DPF-Install-Id` (semi-public). For a feedback channel that's low-stakes, but Phase B should harden it. Options, cheapest first:

1. **Open + rate-limited + moderated (Recommended for v1).** No per-install secret. The relay applies: per-pseudonym and per-IP rate limits, payload size caps, content/spam heuristics, dedup by a payload hash, and files issues with a `hive:unverified` label (or into a triage queue) rather than straight to the public list. Simplest; abuse is contained server-side where we can actually react.
2. **Bundled relay API key.** A rotatable shared key shipped with installs. Slightly raises the bar but is still a shared secret on every machine (the exact thing Phase A avoided for GitHub) — low marginal value.
3. **Per-install signed payload (HMAC/JWT).** Strongest, but requires an install-registration step so the relay can verify signatures — more moving parts than a feedback channel warrants at v1. Revisit if abuse appears.

**Recommendation: start with (1).** It needs no new install-side credential, keeps all abuse controls server-side, and the `hive:unverified` label + dedup keep the public issue list clean.

## Abuse / safety controls (relay-side)

- Rate limits: per-pseudonym (e.g. 5/min, 30/hr — mirrors the portal-side limit) and per-IP.
- Payload caps: title/body length, label whitelist.
- Re-redaction: run the same hostname/PII scrub server-side (defense in depth; never trust the client).
- Dedup: drop repeats by content hash within a window.
- Triage gate: file with `hive:unverified`; a maintainer/automation promotes real ones — keeps spam out of the canonical list.
- No PII at rest: log only the pseudonym + hash, never raw report bodies.

## Reseller seam (Phase C preview)

The relay is **the same code a reseller deploys**, pointed at their own repo or configured to forward upstream after curation. Because `upstreamRelayUrl` is already per-install config, no portal change is needed to support a reseller — they hand their customers a relay URL. Phase C adds the curation/forwarding workflow and the reverse-channel acknowledgement (ties into `BI-FBDC0861`).

## Default wiring

Once the relay exists, set the **default `upstreamRelayUrl`** for consumer installs to it (the OpenDigitalProductFactory relay), so the consumer path is truly zero-config. Contributor/admin installs with a GitHub token continue to use the direct bridge unchanged.

## Failure behavior (already handled by Phase A)

If the relay is down, `RelayTransport` returns `failed` → the portal reports "couldn't send" and the report **stays local** (nothing lost). A store-and-retry queue is a possible Phase C refinement, not required for v1.

## Open decisions for the operator

1. **Hosting:** Option A (serverless) vs B (existing infra)? → confirm whether a suitable hosted service already exists.
2. **GitHub auth:** GitHub App (recommended) vs PAT?
3. **Install auth for v1:** open + rate-limited + moderated (recommended) vs a bundled key?

With those three answered, Phase B is a small build: one function, the GitHub App registration, the abuse controls, and flipping the default `upstreamRelayUrl`.
