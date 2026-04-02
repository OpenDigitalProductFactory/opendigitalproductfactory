# Build Studio Taxonomy Attribution & Portfolio Evolution

| Field | Value |
|-------|-------|
| **Epic** | EP-BUILD-ATTRIB-001 |
| **IT4IT Alignment** | §5.2 Explore (product placement), §5.3 Integrate (feature-to-product mapping), §5.5 Release (catalog positioning) |
| **Depends On** | 2026-03-14 Discovery Taxonomy Attribution (attribution pipeline), 2026-04-02 Product-Centric Navigation (lifecycle home + progressive disclosure), 2026-03-14 Build Studio Conversation Integration (phase pipeline) |
| **Status** | Draft |
| **Created** | 2026-04-02 |
| **Author** | Claude (Software Engineer) + Mark Bodman (CEO) |

---

## 1. Problem Statement

The Build Studio's five-phase pipeline (Ideate → Plan → Build → Review → Ship) has a taxonomy attribution gap that compounds as the platform grows:

### 1.1 Current Behavior

| Phase | What Happens | Problem |
|-------|-------------|---------|
| **Ideate** | Brief captures `portfolioContext` as a slug in JSON | Informational only — not linked to DB records |
| **Plan** | No product/taxonomy interaction | Feature designed without knowing where it belongs |
| **Build** | No product/taxonomy interaction | Code written without portfolio context |
| **Review** | No product/taxonomy interaction | Review has no portfolio governance context |
| **Ship** | `shipBuild()` creates `DigitalProduct` with `taxonomyNodeId` = **portfolio root node** | Every shipped product lands at the taxonomy root — never at a meaningful leaf node |

The result: after shipping, every new product shows up at the top level of its portfolio with no taxonomy depth. The progressive disclosure tree never expands because products are never placed deeper than L0.

### 1.2 The Customer Experience Gap

A customer using Build Studio to create a feature:
1. Describes what they want to build in natural language
2. The AI Coworker plans and builds it
3. At ship time, they're asked for a portfolio and product name
4. The product is created at the portfolio root — no taxonomy attribution
5. The pruned Portfolio tree shows the product floating at the root, disconnected from any capability domain

The customer never sees the taxonomy, never gets a suggestion for where their product belongs, and has no way to evolve the taxonomy from within the build flow. They'd need to go to EA Modeler Reference Models, understand the taxonomy structure, and manually update the product — an unreasonable expectation for a non-technical user.

### 1.3 What Should Happen

The Build Studio should **use the taxonomy reference model as a living guide** during the build lifecycle:

- At **Ideate**: the AI Coworker reads the feature brief and suggests which taxonomy node(s) fit, using the same attribution pipeline that works for infrastructure discovery
- At **Ship**: the product is placed at a specific taxonomy leaf node, not the portfolio root
- When **nothing fits**: the platform proposes a new taxonomy node, which becomes visible in the Portfolio tree once approved — this is how the taxonomy grows organically
- The customer sees the **taxonomy as a helpful categorization aid**, not a bureaucratic gate

This aligns with US Patent 8,635,592 (progressive disclosure of software complexity): the taxonomy reveals itself through use, not through upfront configuration.

---

## 2. Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| P1 | **Attribution is a suggestion, not a gate** | Users are never blocked from building or shipping because they can't find the right taxonomy node |
| P2 | **Same attribution pipeline as discovery** | Reuse deterministic → heuristic → AI-proposed hierarchy from the infrastructure attribution spec |
| P3 | **Taxonomy evolves through use** | When no node fits, propose a new one. Approved proposals become visible in Portfolio tree. The taxonomy grows with the organization. |
| P4 | **AI Coworker is the guide** | The Build Studio AI reads the taxonomy reference and makes placement recommendations. The customer confirms or overrides. |
| P5 | **Rule synthesis from approvals** | When a customer confirms an attribution, it becomes a deterministic rule for future features with similar characteristics |
| P6 | **Portfolio context narrows the search** | Attribution searches within the selected portfolio's taxonomy subtree first, not the entire 481-node tree |

---

## 3. Attribution Pipeline for Features

### 3.1 Three-Stage Attribution (Reusing Discovery Pattern)

The same three-stage pipeline from the Discovery Taxonomy Attribution spec (2026-03-14), adapted for features:

#### Stage 1: Deterministic (Method: "rule", Confidence: 0.95+)

If a feature targets an **existing product** (`digitalProductId` is set), inherit that product's `taxonomyNodeId`. No further attribution needed.

If the feature brief contains **keywords that match synthesized rules** from prior attributions (e.g., "CI/CD pipeline" → `manufacturing_and_delivery/build_and_release_management`), apply the rule directly.

#### Stage 2: Heuristic (Method: "heuristic", Threshold: 0.55)

Score the feature's text (title + description + acceptance criteria) against taxonomy node names and descriptions within the selected portfolio's subtree:

```
score = nodeCoverage(0.7) + descriptorCoverage(0.3) + phraseBonus(0.2)
```

Return top 3 ranked candidates with evidence. If top candidate score >= 0.55, mark as `attributed`. If multiple candidates score close (within 0.1), mark as `needs_review` with candidates preserved.

#### Stage 3: AI-Proposed (Method: "ai_proposed")

When heuristic fails or produces low-confidence results, the AI Coworker:

1. Receives the bounded candidate set (top 5 heuristic results + "None of these fit")
2. Selects the best match with rationale, OR
3. Proposes a **new taxonomy node** with:
   - Suggested parent node (where it would fit in the hierarchy)
   - Proposed name and description
   - Rationale for why existing nodes don't fit

New node proposals are persisted as `TaxonomyProposal` records for EA team review.

### 3.2 When to Run Attribution

| Phase | Trigger | Action |
|-------|---------|--------|
| **Ideate** (after brief saved) | `update_feature_brief` completes | Run attribution pipeline against brief text. Store result in `FeatureBuild.taxonomyAttribution` (JSON). Present suggestion to user via AI Coworker. |
| **Ship** (product creation) | `shipBuild()` called | Use confirmed attribution as `taxonomyNodeId` for the new `DigitalProduct`. Fall back to portfolio root only if user explicitly skips attribution. |

Attribution runs **once at ideate** and the result carries through to ship. The user can override at any time.

---

## 4. Build Studio UX Flow

### 4.1 Ideate Phase — Attribution Suggestion

After the AI Coworker saves the feature brief, it runs the attribution pipeline and presents the result conversationally:

**High confidence (>= 0.75):**
> "Based on your description, this feature fits under **API Management Platform** in the Foundational portfolio. This covers API gateway, rate limiting, and developer portal capabilities. Sound right?"

**Medium confidence (0.55 - 0.75):**
> "I have a couple of suggestions for where this fits:
> 1. **API Management Platform** (72% match) — API gateway and developer portal
> 2. **Application Hosting Platform** (61% match) — application runtime and hosting
> Which feels right, or is it something else?"

**Low confidence / no match:**
> "I couldn't find a strong match in the current taxonomy. This looks like it might be a new capability area. Would you like to:
> 1. Place it under **[nearest parent node]** for now
> 2. Suggest a new category (I'll propose it to the architecture team)"

### 4.2 Ship Phase — Confirmed Attribution

At ship time, `shipBuild()` reads the confirmed attribution from `FeatureBuild.taxonomyAttribution`:

```typescript
// In shipBuild():
const attribution = build.taxonomyAttribution as TaxonomyAttribution | null;
let taxonomyNodeId: string;

if (attribution?.confirmedNodeId) {
  // User confirmed a specific node
  taxonomyNodeId = attribution.confirmedNodeId;
} else if (attribution?.topCandidate && attribution.topCandidate.confidence >= 0.75) {
  // High-confidence suggestion, user didn't override
  taxonomyNodeId = attribution.topCandidate.nodeId;
} else {
  // Fall back to portfolio root
  taxonomyNodeId = portfolioRootNode.id;
}
```

### 4.3 Taxonomy Expansion — New Node Proposals

When the AI proposes a new taxonomy node:

1. A `TaxonomyProposal` record is created with: proposed name, description, parent node, rationale, proposing build ID
2. The product is created under the proposed parent node temporarily
3. The proposal appears in the EA team's review queue (Portfolio Quality Issues with type `taxonomy_expansion_proposed`)
4. Once approved, the new node becomes a permanent `TaxonomyNode`
5. Once rejected, the product is re-attributed to the parent or an alternative

This is how the taxonomy **grows organically** — customers build things, the AI suggests where they belong, and when nothing fits, a new node is proposed. The EA team curates the structure, but the growth is driven by actual use.

---

## 5. Data Model Changes

### 5.1 FeatureBuild — New Field

```prisma
model FeatureBuild {
  // ... existing fields ...
  taxonomyAttribution  Json?    // TaxonomyAttribution: candidates, confirmed node, method, confidence
}
```

**TaxonomyAttribution JSON shape:**
```typescript
type TaxonomyAttribution = {
  method: "rule" | "heuristic" | "ai_proposed" | "manual";
  confidence: number;
  confirmedNodeId: string | null;       // user-confirmed node (null = not yet confirmed)
  topCandidate: {
    nodeId: string;
    nodeName: string;
    score: number;
    evidence: string;
  } | null;
  candidates: Array<{
    nodeId: string;
    nodeName: string;
    score: number;
    evidence: string;
  }>;
  proposedNewNode: {
    parentNodeId: string;
    name: string;
    description: string;
    rationale: string;
  } | null;
  attributedAt: string;                 // ISO timestamp
};
```

### 5.2 TaxonomyProposal — New Model

```prisma
model TaxonomyProposal {
  id              String       @id @default(cuid())
  parentNodeId    String
  proposedName    String
  description     String?
  rationale       String
  status          String       @default("proposed")  // proposed | approved | rejected
  featureBuildId  String?
  reviewedById    String?
  reviewedAt      DateTime?
  reviewNotes     String?
  createdNodeId   String?      // populated when approved and TaxonomyNode created
  createdAt       DateTime     @default(now())
  parentNode      TaxonomyNode @relation(fields: [parentNodeId], references: [id])
  featureBuild    FeatureBuild? @relation(fields: [featureBuildId], references: [id])

  @@index([status])
  @@index([parentNodeId])
}
```

### 5.3 shipBuild() Changes

Update the existing `shipBuild()` function in `apps/web/lib/actions/build.ts` to:

1. Read `build.taxonomyAttribution` instead of blindly assigning portfolio root
2. Resolve confirmed or high-confidence `taxonomyNodeId`
3. Fall back to portfolio root only when attribution is absent or skipped
4. If a `TaxonomyProposal` exists, create the product under the proposed parent node

---

## 6. MCP Tool Changes

### 6.1 New Tool: `suggest_taxonomy_placement`

Called by the AI Coworker after saving the feature brief. Runs the attribution pipeline and returns candidates.

```typescript
{
  name: "suggest_taxonomy_placement",
  description: "Analyze a feature brief and suggest taxonomy node placement within the selected portfolio",
  parameters: {
    buildId: { type: "string", description: "Feature build ID" },
  },
  returns: {
    method: "rule | heuristic | ai_proposed",
    confidence: "number 0-1",
    candidates: "array of {nodeId, nodeName, score, evidence}",
    recommendation: "string — conversational suggestion for the user",
  },
}
```

### 6.2 New Tool: `confirm_taxonomy_placement`

Called when the user confirms or overrides the suggestion.

```typescript
{
  name: "confirm_taxonomy_placement",
  description: "Confirm or override the taxonomy placement for a feature build",
  parameters: {
    buildId: { type: "string", description: "Feature build ID" },
    nodeId: { type: "string", description: "Confirmed taxonomy node ID, or null to propose new" },
    proposeNew: {
      type: "object",
      description: "If nodeId is null, propose a new taxonomy node",
      properties: {
        parentNodeId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
      },
    },
  },
}
```

### 6.3 Updated Agent Prompt — Ideate Phase

Add to the ideate phase prompt in `build-agent-prompts.ts`:

```
STEP 3 (after saving brief): Call suggest_taxonomy_placement to determine where this
feature belongs in the portfolio taxonomy. Present the suggestion to the user:
- If high confidence: state the recommendation and ask for confirmation
- If multiple candidates: present the top 2-3 options and ask which fits
- If no match: explain this might be a new capability area and offer to propose a new category
When the user confirms, call confirm_taxonomy_placement.
```

---

## 7. Rule Synthesis

When a customer confirms a taxonomy placement, the system checks if the attribution method was heuristic or AI-proposed. If so, it evaluates whether to create a deterministic rule:

```typescript
// After confirm_taxonomy_placement:
if (attribution.method !== "rule" && attribution.confidence >= 0.7) {
  // Extract key tokens from the brief that drove the match
  const ruleTokens = extractSignificantTokens(brief.description, brief.acceptanceCriteria);
  await createAttributionRule({
    portfolioId: build.portfolioId,
    targetNodeId: confirmedNodeId,
    matchTokens: ruleTokens,
    sourceType: "feature_brief",
    confidence: 0.95,
    createdFromBuildId: build.buildId,
  });
}
```

Future features with similar token profiles will match deterministically — no heuristic scoring or AI calls needed. This is the same rule synthesis pattern from the discovery attribution spec.

---

## 8. Portfolio Tree Evolution

### 8.1 How New Nodes Appear

When a `TaxonomyProposal` is approved:

1. A new `TaxonomyNode` is created under the specified parent
2. The product that triggered the proposal is re-attributed to the new node
3. The pruned Portfolio tree **automatically shows the new node** (because it now has a product)
4. Future features in the same area match the new node via synthesized rules

This is the progressive disclosure cycle: **use drives taxonomy growth, taxonomy growth improves navigation, better navigation drives more accurate use**.

### 8.2 Proposal Review Queue

Taxonomy proposals appear in two places:

1. **Portfolio Quality Issues** — with type `taxonomy_expansion_proposed`, visible in the Inventory quality issues panel
2. **Admin > Reference Data** — a dedicated review interface for EA team members to approve/reject/modify proposals

---

## 9. Implementation Phases

### Phase 1: Attribution Pipeline for Features

1. Add `taxonomyAttribution` JSON field to `FeatureBuild` (schema migration)
2. Implement `attributeFeatureBuild()` — reuse token scoring from `discovery-attribution.ts`
3. Create `suggest_taxonomy_placement` MCP tool
4. Create `confirm_taxonomy_placement` MCP tool
5. Update ideate phase prompt to call attribution tools

### Phase 2: Ship Phase Integration

1. Update `shipBuild()` to read confirmed attribution instead of using portfolio root
2. Verify end-to-end: ideate → attribute → confirm → ship → product appears at correct node
3. Test fallback: unattributed builds still ship to portfolio root

### Phase 3: Taxonomy Expansion

1. Add `TaxonomyProposal` model (schema migration)
2. Implement "propose new node" flow in `confirm_taxonomy_placement`
3. Create proposal review UI in Admin > Reference Data
4. Wire approval flow: proposal → new TaxonomyNode → product re-attribution
5. Create quality issue type `taxonomy_expansion_proposed`

### Phase 4: Rule Synthesis

1. Implement rule creation from confirmed attributions
2. Add rule matching to the deterministic stage of `attributeFeatureBuild()`
3. Track rule effectiveness (hit rate, override rate)

---

## 10. Out of Scope

| Item | Reason |
|------|--------|
| **Bulk re-attribution of existing products** | Existing products at portfolio roots can be re-attributed manually or via a backfill script; this spec covers new builds only |
| **Cross-portfolio attribution** | A feature belongs to one portfolio; cross-portfolio products are a different concern |
| **Taxonomy merge/split operations** | Administrative operations on the taxonomy itself are a separate EA governance concern |
| **Process modeling (APQC)** | The taxonomy contains capability descriptions derived from APQC, but explicit process entities are not yet implemented; industry reference models (BIAN, TM Forum) will follow when process modeling arrives |

---

## 11. Success Criteria

1. A customer building a feature in Build Studio receives a taxonomy placement suggestion at ideate time without needing to understand the taxonomy structure
2. Shipped products land at specific taxonomy leaf nodes, not portfolio roots
3. When no existing node fits, the customer can propose a new one through the AI Coworker — no manual taxonomy navigation required
4. Approved proposals create new taxonomy nodes that immediately appear in the pruned Portfolio tree
5. Confirmed attributions synthesize rules that accelerate future attributions
6. The Portfolio tree evolves organically as the organization builds — small orgs start sparse, complexity grows with use

---

## 12. IT4IT Alignment

| IT4IT Requirement | How This Spec Addresses It |
|-------------------|----------------------------|
| **§5.2 Explore — Product placement** | Attribution pipeline suggests where products belong in the portfolio taxonomy |
| **§5.3 Integrate — Feature-to-product mapping** | Features are attributed to products and taxonomy nodes during the build lifecycle, not after |
| **§5.5 Release — Catalog positioning** | Products ship with correct taxonomy placement, enabling accurate portfolio views and catalog organization |
| **Portfolio-aware governance (G252 §4)** | Attribution searches within the selected portfolio's subtree; governance varies by portfolio type |
| **Progressive disclosure (US 8,635,592)** | Taxonomy reveals itself through use — new nodes proposed from build activity, visible only when populated |
