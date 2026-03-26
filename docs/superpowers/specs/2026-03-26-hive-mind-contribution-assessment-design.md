# EP-HIVEMIND-001: Hive Mind Contribution Assessment & Packaging

**Status:** Draft (2026-03-26)
**Predecessor:** EP-SELF-DEV-001A (Self-Dev Sandbox Design), Platform Feedback Loop (2026-03-16), Open Source Readiness (2026-03-22), Build Studio IT4IT Alignment (2026-03-26)
**IT4IT Alignment:** §5.5 Release Value Stream — Service Offer Definition
**License Model:** Apache-2.0 with DCO (Developer Certificate of Origin) — see Open Source Readiness spec

## Problem Statement

When a user builds and ships a feature through Build Studio, the platform currently registers the product and creates a promotion — but never asks whether the feature would benefit the broader community. The Hive Mind concept (defined in EP-SELF-DEV-001A) envisions a "water drop in the ocean" model where features built by individual users can flow back to the platform for everyone's benefit.

The missing piece is **intelligent assessment**: the AI coworker must evaluate the feature against objective criteria and present the user with an informed recommendation — not just a yes/no toggle.

### What Already Exists

- **FeaturePack model** — Schema ready (`packages/db/prisma/schema.prisma`), stores packId, manifest (files, migrations, dependencies), status (local/contributed/published)
- **ImprovementProposal.contributionStatus** — Bridges feedback loop to contribution (local/proposed_for_sharing/contributed)
- **DCO model** — Apache-2.0 license with Developer Certificate of Origin attestation (no CLA needed)
- **FeatureBuild** — Complete build record with diff, brief, plan, verification results
- **Ship phase** — Currently calls deploy_feature → register_digital_product → create_build_epic

---

## Design

### Section 1: Contribution Assessment Criteria

The AI coworker evaluates every shipped feature against four criteria before presenting contribution options to the user. This is not a gate — the user always decides. The assessment informs the recommendation.

| # | Criterion | What the Agent Evaluates | Signal Sources |
|---|-----------|-------------------------|----------------|
| 1 | **Vision Alignment** | Does this feature align with the platform's purpose as a Digital Product Factory? Does it extend DPPM/IT4IT capabilities, or is it tangential? | FeatureBrief.description, portfolioContext, taxonomyNode mapping, IT4IT functional criteria coverage |
| 2 | **Community Value** | Would other organizations benefit from this feature? Is it solving a common problem or a niche-specific one? | FeatureBrief.targetRoles (broad vs narrow), acceptance criteria generality, data model portability |
| 3 | **Augmentation vs. Innovation** | Does this augment an existing platform capability (new tab, enhanced workflow) or create something fundamentally different (new domain, new data model)? Augmentations are easier to merge; innovations need more review. | File paths changed (existing routes vs new routes), schema changes (new models vs extended fields), dependency additions |
| 4 | **Proprietary Sensitivity** | Does this feature contain organization-specific logic, proprietary business rules, customer data references, or trade secrets? | Code content scan for hardcoded org names, API keys, customer references, industry-specific constants, configurable vs hardcoded values |

### Assessment Outcomes

| Outcome | Meaning | User Presentation |
|---------|---------|-------------------|
| **Recommend Contribute** | All criteria favorable — general-purpose, vision-aligned, augments platform | "This feature looks great for the community. It extends [capability] and other organizations would benefit. Would you like to contribute it?" |
| **Contribute with Modifications** | Mostly favorable but has proprietary elements or needs generalization | "This feature could benefit others, but I noticed [specific issue]. If you'd like to contribute, I'd suggest [modification]. Want me to prepare a cleaned version?" |
| **Keep Local** | Feature is too org-specific, proprietary, or diverges from platform vision | "This feature is well-built but it's specific to your organization's [workflow/data/rules]. I'd recommend keeping it local. You can always contribute later if you generalize it." |
| **User Decides** | Mixed signals — agent can't make a clear recommendation | "I see arguments both ways. [Summary of pros and cons]. What would you prefer?" |

### Section 2: Assessment Tool

New tool: `assess_contribution`

Called by the coworker during the ship phase, after deployment is handled but before the conversation ends.

**Input:** None (auto-resolves active build)

**Process:**
1. Load the FeatureBuild record (brief, plan, diff, verification)
2. Analyze the diff to understand scope (files changed, models added, routes created)
3. Evaluate each of the 4 criteria using the build context
4. Produce a structured assessment with recommendation and reasoning
5. Store assessment on the FeatureBuild record
6. Return the assessment for the coworker to present to the user

**Output:**
```typescript
type ContributionAssessment = {
  recommendation: "contribute" | "contribute_with_mods" | "keep_local" | "user_decides";
  criteria: {
    visionAlignment: { score: "high" | "medium" | "low"; reasoning: string };
    communityValue: { score: "high" | "medium" | "low"; reasoning: string };
    augmentationLevel: { level: "augmentation" | "innovation"; reasoning: string };
    proprietarySensitivity: { sensitive: boolean; concerns: string[] };
  };
  summary: string;        // Plain-language recommendation for the user
  suggestedMods: string[]; // If contribute_with_mods, what to change
};
```

### Section 3: Contribution Packaging Tool

New tool: `contribute_to_hive`

Called only if the user approves contribution after seeing the assessment.

**Input:** `{ include_migrations?: boolean }`

**Process:**
1. Extract the full diff from the sandbox (or use stored diffPatch)
2. Create a FeaturePack record with:
   - `packId`: generated (FP-XXXXX)
   - `title`: from FeatureBrief
   - `manifest`: { files, migrations (if included), dependencies, schemaChanges }
   - `status`: "contributed"
3. Add DCO attestation: "Signed-off-by: {user.name} <{user.email}>"
4. Update ImprovementProposal.contributionStatus to "contributed" (if linked)
5. Store the contribution metadata on the FeatureBuild record
6. Return confirmation with contribution details

**Future (not in scope):** GitHub PR creation, community registry browsing, feature installation from packs.

### Section 4: Ship Phase Integration

Update the ship phase prompt to include the contribution assessment after deployment setup:

```
DO THIS IN ORDER:
1. Call deploy_feature (extract diff, scan, check windows)
2. Call register_digital_product_from_build (product + promotion + RFC)
3. Call create_build_epic (backlog tracking)
4. Call assess_contribution (evaluate the 4 criteria)
5. Present the assessment to the user with the recommendation
6. If user wants to contribute → call contribute_to_hive
7. If user declines or wants to keep local → acknowledge and move on
```

The assessment is always performed but contribution is always the user's choice.

---

## Acceptance Criteria

1. `assess_contribution` evaluates all 4 criteria and returns structured assessment
2. Assessment recommendation is one of: contribute, contribute_with_mods, keep_local, user_decides
3. The coworker presents the assessment in plain language with clear reasoning
4. Contribution is always optional — user explicitly approves before `contribute_to_hive` runs
5. `contribute_to_hive` creates a FeaturePack with DCO attestation
6. Ship phase prompt includes assessment step after deployment tools
7. Proprietary sensitivity check scans code for org-specific content
