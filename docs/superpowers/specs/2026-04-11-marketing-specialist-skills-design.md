# Marketing Specialist Skills Enhancement — Design Spec

**Date:** 2026-04-11
**Author:** Mark Bodman + Claude
**Status:** Draft

## Problem Statement

The marketing specialist coworker has 3 skills (campaign-ideas, content-brief, marketing-health) that cover ideation and assessment but lack the execution-oriented capabilities that deliver measurable marketing results for SMB operators. Research into best-in-class AI marketing tools identifies content generation, SEO guidance, and competitive positioning as the highest-ROI activities — all currently missing.

The target user is an SMB operator who needs marketing but is not a marketer. Skills must be practical, guided, and low-jargon.

## Scope

### In scope

- 3 new skills: SEO Content Optimizer, Email Campaign Builder, Competitive Analysis
- 1 new MCP tool: `analyze_seo_opportunity`
- Archetype-driven skill visibility and labeling (`marketingSkillRules` on `StorefrontArchetype`)
- Seed data defaults for all 11 existing archetypes
- Runtime filtering in `AgentSkillsDropdown`

### Out of scope (deferred)

- Audience segmentation (requires CRM/transaction data pipeline)
- A/B test designer (requires sufficient traffic volume)
- Campaign analytics dashboard (requires analytics integrations)
- External API integrations (Mailchimp, Google Search Console, etc.)

## Design

### 1. New Skills

All 3 skills follow the existing pattern: `.skill.md` files in `skills/storefront/`, assigned to `marketing-specialist`, using existing MCP tools where possible.

#### 1.1 SEO Content Optimizer (`seo-content-optimizer`)

**Purpose:** Help SMB operators understand what to write about and how to structure content to get found online.

**Skill file:** `skills/storefront/seo-content-optimizer.skill.md`

**Allowed tools:** `analyze_seo_opportunity`, `get_marketing_summary`

**Note on `create_backlog_item`:** This tool requires `manage_backlog` capability, not `view_storefront`. Rather than granting a second capability to the skill, the specialist offers to create backlog items conversationally — the user confirms, and the agent invokes `create_backlog_item` using the agent's own tool grant (marketing-specialist already has `manage_backlog` via its agent tool grants). The skill's `allowedTools` only lists tools the skill itself needs to call directly.

**Conversation flow:**

1. Use `analyze_seo_opportunity` to fetch business context (archetype, products/services, location, existing content).
2. Identify 3-5 topic opportunities based on what the business offers and what local customers search for.
3. For each topic, provide: suggested title, target search intent (informational/transactional/local), key points to cover, recommended content format (blog post, FAQ page, service page).
4. Rank by estimated impact and effort.
5. Offer to create a backlog item for the chosen topic.

**Guidelines:**

- Frame as "what to write about" not "keyword density" — no SEO jargon.
- Ground every suggestion in the business's actual services/products from PAGE DATA.
- Prioritize local search intent for brick-and-mortar archetypes.
- Include practical structure advice: headings, FAQ sections, location mentions.

**Archetype adaptations:**

| Archetype | Behaviour |
|---|---|
| `hoa-property-management` | **Hidden** — captive audience, no acquisition funnel |
| `nonprofit-community` | **Reframe -> "Cause Visibility Advisor"** — focus on mission awareness, cause-related search, grant/volunteer discovery |
| All others | **Show as "SEO Content Optimizer"** |

#### 1.2 Email Campaign Builder (`email-campaign-builder`)

**Purpose:** Generate complete, ready-to-send email drafts (not just briefs) with subject line variants, adapted to archetype vocabulary and tone.

**Skill file:** `skills/storefront/email-campaign-builder.skill.md`

**Allowed tools:** `get_marketing_summary`

**Conversation flow:**

1. Use `get_marketing_summary` to load business context, playbook, and recent activity.
2. Ask the user what the email is for (choose from archetype-appropriate options: promotion, reminder, announcement, follow-up, seasonal, welcome sequence).
3. Ask who it's for (use archetype stakeholder language — "homeowners", "patients", "donors", not "customers").
4. Generate a complete email draft including:
   - 3 subject line variants (short, curiosity, direct)
   - Pre-header text
   - Email body with greeting, content, and CTA
   - Plain-text fallback version
5. Ask if they want to adjust tone, length, or CTA before finalising.

**Guidelines:**

- Use the archetype's `contentTone` and `ctaLanguage` from the marketing playbook.
- Keep emails concise — SMB audiences respond to short, clear messages.
- Always include one clear CTA, using the archetype's CTA vocabulary.
- For sequences (welcome, nurture), outline the full sequence structure but draft one email at a time.
- Never include unsubscribe/legal boilerplate — that's the email platform's job.

**Archetype adaptations:**

| Archetype | Label | Framing |
|---|---|---|
| `hoa-property-management` | **Community Notice Builder** | Bylaws, assessments, meeting invites, maintenance updates — official tone, not promotional |
| `healthcare-wellness` | **Patient Communication Builder** | Recalls, health tips, new service announcements — reassuring, professional |
| `nonprofit-community` | **Donor & Volunteer Communication Builder** | Impact updates, stewardship, event invites — mission-focused, gratitude-first |
| `education-training` | **Enrolment Communication Builder** | Term launches, open day invites, student success stories — encouraging, achievement-focused |
| All others | **Email Campaign Builder** | Standard marketing email framing |

#### 1.3 Competitive Analysis (`competitive-analysis`)

**Purpose:** Guided conversation helping SMB operators understand their competitive position and identify differentiation opportunities.

**Skill file:** `skills/storefront/competitive-analysis.skill.md`

**Allowed tools:** `get_marketing_summary`

**Note on `create_backlog_item`:** Same approach as SEO Content Optimizer — the agent offers to create backlog items and invokes the tool via its own grants, not the skill's `allowedTools`.

**Conversation flow:**

1. Use `get_marketing_summary` to understand the business type and offerings.
2. Ask the user to name 2-3 competitors (or describe the competitive landscape if they're unsure).
3. For each competitor, ask: What do they do well? What do your customers say they lack?
4. Synthesize a positioning map:
   - Where the user's business overlaps with competitors
   - Where the user's business is differentiated
   - Gaps that represent opportunities
5. Recommend 2-3 concrete positioning actions (messaging changes, service gaps to fill, content to create).
6. Offer to create backlog items for any actions the user wants to pursue.

**Guidelines:**

- This is a guided conversation, not a data-driven report — the user provides the competitive intelligence, the specialist structures the analysis.
- Focus on actionable differentiation, not comprehensive market research.
- Use the business's own language and stakeholder terms.
- Keep the output practical: "Here's what to say differently" not "Here's a SWOT matrix."

**Archetype adaptations:**

| Archetype | Behaviour |
|---|---|
| `hoa-property-management` | **Hidden** — HOAs don't compete for members |
| `nonprofit-community` | **Reframe -> "Peer Landscape Review"** — peer organizations, donor differentiation, mission positioning |
| `healthcare-wellness` | **Reframe -> "Local Practice Positioning"** — softer framing for regulated industry, focus on patient experience differentiation |
| All others | **Show as "Competitive Analysis"** |

### 2. New MCP Tool

#### 2.1 `analyze_seo_opportunity`

**Purpose:** Provide structured business context for grounding SEO recommendations. Does NOT call external APIs — assembles context from existing platform data.

**Definition location:** `apps/web/lib/mcp-tools.ts` (alongside existing tools)

**Tool definition fields:**

```typescript
{
  name: "analyze_seo_opportunity",
  description: "Get structured business context for SEO content recommendations: archetype, services/products, location, existing content sections, and suggested local search intents",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  requiredCapability: "view_storefront",
  sideEffect: false,
}
```

No user input required — the tool pulls context from the current storefront.

**Output shape:**

```json
{
  "businessType": "dental-practice",
  "archetype": { "category": "healthcare-wellness", "name": "Dental Practice" },
  "location": "Bristol, UK",
  "services": ["General Dentistry", "Cosmetic Dentistry", "Orthodontics"],
  "existingContent": ["About Us", "Services", "Contact"],
  "playbook": { "primaryGoal": "...", "campaignTypes": ["..."] },
  "suggestedSearchIntents": [
    "dentist near me",
    "cosmetic dentistry [city]",
    "emergency dental care"
  ]
}
```

**Implementation:** Similar pattern to `suggest_campaign_ideas` — fetches `StorefrontConfig` with archetype, items, and sections, then assembles into a structured context object. The `suggestedSearchIntents` are derived from the archetype category + service/product names + location (if available from organization address).

### 3. Archetype-Driven Skill Rules

#### 3.1 Schema Change

Add a `marketingSkillRules` JSON field to the `StorefrontArchetype` model:

```prisma
model StorefrontArchetype {
  // ... existing fields ...
  marketingSkillRules Json? // nullable -- null means "show all skills with default labels"
}
```

#### 3.2 JSON Shape

```typescript
type MarketingSkillRules = Record<string, SkillRule>;

type SkillRule =
  | { visible: false }                                   // hidden -- skill omitted from dropdown
  | { visible?: true; label: string; reframe: string }   // visible with reframed label and context
  // absent key = show with default label and no reframe
```

**Precedence:** If `visible` is `false`, the skill is hidden regardless of other fields. This is the only check needed — `visible: false` always wins. If a rule has `label` and `reframe` but no `visible` field (or `visible: true`), the skill is shown with the overridden label.

**Null vs empty:** Both `null` (column not set) and `{}` (empty object) mean "show all skills with default labels." The runtime treats them identically.

Example for `hoa-property-management`:

```json
{
  "seo-content-optimizer": { "visible": false },
  "competitive-analysis": { "visible": false },
  "email-campaign-builder": {
    "label": "Community Notice Builder",
    "reframe": "Focus on official community communications: bylaw updates, assessment notices, meeting invitations, maintenance schedules. Tone is official and transparent, not promotional."
  }
}
```

Example for `nonprofit-community`:

```json
{
  "seo-content-optimizer": {
    "label": "Cause Visibility Advisor",
    "reframe": "Focus on mission awareness, cause-related search visibility, and being found by potential donors, volunteers, and grant makers."
  },
  "competitive-analysis": {
    "label": "Peer Landscape Review",
    "reframe": "Focus on peer organizations serving similar causes. Help differentiate for donors and identify collaboration opportunities rather than competitive positioning."
  },
  "email-campaign-builder": {
    "label": "Donor & Volunteer Communication Builder",
    "reframe": "Focus on impact storytelling, donor stewardship, volunteer appreciation, and fundraising event promotion. Tone is mission-focused and gratitude-first."
  }
}
```

Example for `healthcare-wellness`:

```json
{
  "competitive-analysis": {
    "label": "Local Practice Positioning",
    "reframe": "Focus on patient experience differentiation and local practice awareness. Avoid aggressive competitive language -- healthcare is regulated and trust-based."
  },
  "email-campaign-builder": {
    "label": "Patient Communication Builder",
    "reframe": "Focus on patient recall reminders, health tips, new service announcements, and practice updates. Tone is reassuring and professional."
  }
}
```

Example for `food-hospitality`, `retail-goods`, etc. (no overrides needed):

```json
{}
```

#### 3.3 Seed Data

A migration adds the `marketingSkillRules` column. The seed script populates defaults for all 11 existing archetypes using the mappings in section 1.

**Full archetype rule matrix:**

| Archetype | SEO Content Optimizer | Email Campaign Builder | Competitive Analysis |
|---|---|---|---|
| `hoa-property-management` | Hidden | "Community Notice Builder" | Hidden |
| `professional-services` | Default | Default | Default |
| `trades-maintenance` | Default | Default | Default |
| `healthcare-wellness` | Default | "Patient Communication Builder" | "Local Practice Positioning" |
| `food-hospitality` | Default | Default | Default |
| `education-training` | Default | "Enrolment Communication Builder" | Default |
| `nonprofit-community` | "Cause Visibility Advisor" | "Donor & Volunteer Communication Builder" | "Peer Landscape Review" |
| `beauty-personal-care` | Default | Default | Default |
| `fitness-recreation` | Default | Default | Default |
| `pet-services` | Default | Default | Default |
| `retail-goods` | Default | Default | Default |

#### 3.4 Runtime Filtering

**`AgentSkillsDropdown` changes:**

1. When rendering skills for the `marketing-specialist` agent, fetch the current storefront archetype's `marketingSkillRules`.
2. For each skill:
   - If the skill name is in `marketingSkillRules` with `{ visible: false }` then omit from dropdown.
   - If the skill name is in `marketingSkillRules` with `{ label, reframe }` then display using the overridden `label`.
   - Otherwise display with the skill's default label.
3. The `reframe` text is injected into the skill's prompt at send time, prepended as context: `"[ARCHETYPE CONTEXT: {reframe}]\n\n{original skill prompt}"`. This gives the LLM the reframing instruction without changing the skill definition itself.

**`apps/web/lib/tak/route-context.ts` changes:**

The `getStorefrontMarketingContext()` function already returns the playbook. Extend it to also return `marketingSkillRules` so the panel has the data without an extra query.

### 4. Existing Skill Updates

The existing `campaign-ideas`, `content-brief`, and `marketing-health` skills should also be added to the `marketingSkillRules` system for consistency. Their current defaults work for all archetypes, so no rules are needed initially — but platform customers gain the ability to relabel or hide them.

No changes to the skill files themselves.

### 5. Agent Routing Updates — Dual Definition System

Skills exist in two places, each serving a different purpose:

1. **`apps/web/lib/tak/agent-routing.ts` inline `skills` array** — drives the `AgentSkillsDropdown` UI. Contains `label`, `description`, `capability`, and `prompt` for each skill. This is what the user sees and clicks.
2. **DB `SkillDefinition` + `SkillAssignment` tables** (seeded from `.skill.md` files) — drives agent capability discovery, delegation, and governance. Contains `allowedTools`, `riskBand`, `triggerPattern`, etc.

Both must be updated for new skills. The route config provides the default label and prompt; the archetype `marketingSkillRules` overrides the label and injects reframe context at render time.

**`agent-routing.ts` changes:**

Add 3 new entries to the marketing specialist's `skills` array, using default labels:

```typescript
{ skillId: "seo-content-optimizer", label: "SEO Content Optimizer", description: "What to write about to get found online", capability: "view_storefront", prompt: "Analyze our business and suggest 3-5 content topics..." },
{ skillId: "email-campaign-builder", label: "Email Campaign Builder", description: "Draft a ready-to-send email for your audience", capability: "view_storefront", prompt: "Draft a complete email for our business..." },
{ skillId: "competitive-analysis", label: "Competitive Analysis", description: "Understand your competitive position", capability: "view_storefront", prompt: "Help me understand our competitive position..." },
```

**`AgentSkillsDropdown` changes:**

Before rendering, the dropdown checks `marketingSkillRules` from the storefront context. For each skill in the route config's `skills` array, it matches by a `skillId` field (new — added to the inline skill definition, matching the `.skill.md` name). If the archetype rule says hidden, the skill is omitted. If reframed, the label is overridden and the reframe text is prepended to the prompt.

**New field on inline skill definition:**

```typescript
{ skillId: "email-campaign-builder", label: "Email Campaign Builder", ... }
```

The `skillId` is the join key between the route config and `marketingSkillRules`. Existing skills get `skillId` added too (e.g., `"campaign-ideas"`, `"content-brief"`, `"marketing-health"`). Skills without a `skillId` (like "Report an issue") are never filtered by archetype rules.

## File Changes Summary

| File | Change |
|---|---|
| `skills/storefront/seo-content-optimizer.skill.md` | **New** — skill definition |
| `skills/storefront/email-campaign-builder.skill.md` | **New** — skill definition |
| `skills/storefront/competitive-analysis.skill.md` | **New** — skill definition |
| `apps/web/lib/mcp-tools.ts` | **Edit** — add `analyze_seo_opportunity` tool definition (with `requiredCapability` and `sideEffect` fields) + handler |
| `packages/db/prisma/schema.prisma` | **Edit** — add `marketingSkillRules Json?` to `StorefrontArchetype` |
| `packages/db/prisma/migrations/YYYYMMDD_add_marketing_skill_rules/` | **New** — migration |
| `packages/db/src/seed.ts` | **Edit** — populate `marketingSkillRules` defaults for all 11 archetypes |
| `packages/db/src/seed-skills.ts` | **Edit** — seed the 3 new skill definitions + assignments |
| `apps/web/components/agent/AgentSkillsDropdown.tsx` | **Edit** — filter/relabel skills using `marketingSkillRules` from storefront context |
| `apps/web/lib/tak/route-context.ts` | **Edit** — include `marketingSkillRules` in `getStorefrontMarketingContext()` output |
| `apps/web/lib/tak/agent-routing.ts` | **Edit** — add 3 new skills with `skillId` fields to marketing specialist `skills` array; add `skillId` to existing skills for archetype rule matching |

## Dependencies

- No external API integrations required.
- No new npm packages.
- All 3 skills work with the LLM's reasoning + existing platform data.
- The `analyze_seo_opportunity` tool assembles context from existing DB tables (StorefrontConfig, StorefrontItem, Organization).

## Testing Strategy

- **Skill files:** Validate YAML frontmatter parsing and skill assignment in seed.
- **MCP tool:** Unit test `analyze_seo_opportunity` handler returns correct shape for each archetype.
- **Archetype rules:** Unit test that `AgentSkillsDropdown` correctly hides, relabels, and shows skills for each archetype category.
- **Integration:** Manual test each skill via the coworker panel on `/admin/storefront` for at least 3 different archetypes (HOA, restaurant, nonprofit) to verify vocabulary adaptation and reframing.
- **Migration:** Verify `marketingSkillRules` column is nullable and existing archetypes continue to work with null (all skills shown).
