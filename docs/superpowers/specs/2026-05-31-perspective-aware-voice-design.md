# Perspective-Aware Voice — design

- Status: **DRAFT (captured future direction, NOT approved to build)**
- Authored: 2026-05-31
- Backlog item: filed alongside this spec (perspective-aware voice BI)
- Related: [WWWD / Decision Perspective Gate](../../user-guide/ai-workforce/decision-perspective.md), [org-mission + WWWD corpus seed (PR #1360)](../../../packages/db/prisma/migrations/) (BI-CC64ECE4), Voice slice ladder (EP-BUILD-10C4F8)

## Problem

DPF already separates two decision perspectives: **WWMD** (platform / founder kernel) and **WWWD** (business / org overlay, retrieved from org-scoped WikiPages). The voice the system speaks in should follow the same boundary, but today TTS picks a single voice regardless of context.

On the founder's install, the platform-owner *is* the business-owner, so the single voice happens to be right and the defect is invisible. On a customer install (e.g. Dale's HVAC shop) the mismatch becomes obvious:

- When the portal speaks AS the platform (system updates, admin surfaces, founder-kernel reasoning, contributor preview): the *platform's* voice should be heard.
- When the portal speaks AS the business (in-portal coworker talking to Dale's team or a Dale customer, business-decision answers, storefront-side TTS, customer outbound): the *org's* voice should be heard.

Same shape as the decision-perspective non-inheritance rule: customer profile does not silently inherit platform-specific business judgment. Same rule should apply to voice — customer org does not silently inherit the platform voice for business-context speech.

## Non-goals (this design)

- Voice cloning capture / consent / model storage UX (already partial for the platform voice — revisit when this is sized).
- Choosing a specific TTS engine or model tier (CPU vs. GPU vs. MLX sidecar) — that's the existing voice-slice ladder's concern.
- Cross-org voice sharing or marketplace.

## Open questions (resolve before approving the build)

1. **Where does the voice selector live?** Options:
   - A single helper (`resolveVoice({ perspective, orgId })`) called from every TTS callsite, with `perspective: "platform" | "business"` derived from the same context the Decision Perspective Gate uses.
   - A TTS service-layer wrapper that takes the request context and resolves voice internally, leaving callsites untouched.
   - A voice argument on every coworker / agent dispatch, set once at the orchestration layer and threaded through.
2. **Where is the org voice stored?** Likely `Organization` (canonical identity model per AGENTS.md §11) with a nullable `voiceProfileId` — but check `BrandingConfig` first; voice may already live with branding tokens.
3. **What's the fallback?** When an org has no cloned voice:
   - Use a curated neutral org default (preferred — preserves the non-inheritance rule).
   - Use the platform voice (rejected — silently inherits platform identity into business speech).
   - Ask the org to pick a voice during setup.
4. **Storefront-side TTS.** External-facing storefront (`/s/[slug]`) speaks to the org's customers, not the org. Is that a third perspective ("customer-facing")? Or does it fold into the business voice because it represents the business *to* its customers? Likely the latter, but flag it.
5. **Telemetry.** When the perspective resolver falls through (e.g. context missing), emit a structured signal so we can catch leak paths the same way `principle_decide` leaks are caught today.

## Sketch (NOT a commitment)

```ts
type VoicePerspective = "platform" | "business";

interface VoiceResolution {
  voiceId: string;
  perspective: VoicePerspective;
  source: "platform-voice" | "org-voice" | "org-default" | "fallback";
  warnings: string[];
}

resolveVoice({ perspective, orgId, contextId }): VoiceResolution
```

- `platform` perspective: always returns the platform voice (or a documented platform default).
- `business` perspective with a configured org voice: returns the org voice.
- `business` perspective with no configured org voice: returns the org default, NOT the platform voice. Warning emitted so the org-setup surface can prompt the owner to pick / clone one.

## Research to do before sizing

- Inventory current TTS callsites: where is `tts(...)` (or equivalent) called today? Build vs. coworker vs. storefront vs. system messages.
- Cross-reference against the existing decision-perspective context resolver — does it already expose the "which perspective is this turn" signal, or do TTS callsites currently lack the necessary context?
- Confirm `BrandingConfig` vs. `Organization` ownership of the voice profile field before adding a column.
- Check whether the MLX sidecar / speaches CUDA image (existing voice-slice ladder) supports per-request voice selection without container restart.

## Out-of-scope follow-ups

- A "voice studio" admin UX to record / preview / re-clone the org voice.
- Voice-perspective conflicts in mixed surfaces (e.g. a contributor previewing a customer-facing flow — whose voice plays?).
- Localization / accent variants of the org voice.

## Acceptance (when this is built later)

- TTS callsites take or derive a perspective argument; no hardcoded voice IDs.
- Customer install with no cloned org voice plays the neutral org default for business-context speech, NOT the platform voice.
- Founder install collapses to a single voice transparently because owner identity matches.
- A perspective-resolution telemetry trail exists, mirroring the decision-perspective audit.
