# Marketing Specialist Skills Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 3 new marketing skills (SEO Content Optimizer, Email Campaign Builder, Competitive Analysis) with archetype-driven visibility/labeling to the marketing specialist coworker.

**Architecture:** New `.skill.md` files seeded to DB, one new MCP tool (`analyze_seo_opportunity`), a `marketingSkillRules` JSON column on `StorefrontArchetype` for per-archetype skill visibility/relabeling, and runtime filtering in `AgentSkillsDropdown`. Skills appear in the existing coworker panel Skills dropdown with no new UI pages.

**Tech Stack:** Next.js 16, Prisma 7, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-04-11-marketing-specialist-skills-design.md`

---

## Task 1: Schema Migration — Add `marketingSkillRules` to `StorefrontArchetype`

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (line ~3831, inside `StorefrontArchetype` model)
- Create: `packages/db/prisma/migrations/<timestamp>_add_marketing_skill_rules/migration.sql`

- [ ] **Step 1: Add the column to the Prisma schema**

  In `packages/db/prisma/schema.prisma`, inside the `StorefrontArchetype` model (after line 3831 `customVocabulary Json?`), add:

  ```prisma
  marketingSkillRules  Json?
  ```

- [ ] **Step 2: Generate the migration**

  ```bash
  cd /d/DPF && pnpm --filter @dpf/db exec prisma migrate dev --name add_marketing_skill_rules
  ```

  Expected: A new migration directory is created with an `ALTER TABLE` adding a nullable `marketingSkillRules` column.

- [ ] **Step 3: Verify migration SQL**

  Read the generated `migration.sql` and confirm it is a simple `ALTER TABLE "StorefrontArchetype" ADD COLUMN "marketingSkillRules" JSONB;` (nullable, no default).

- [ ] **Step 4: Commit**

  ```
  feat(schema): add marketingSkillRules JSON column to StorefrontArchetype
  ```

---

## Task 2: Seed `marketingSkillRules` Defaults for All Archetypes

**Files:**

- Modify: `packages/db/src/seed-storefront-archetypes.ts` (lines 12-38)
- Test: Manual — run seed and verify DB values

- [ ] **Step 1: Define the archetype rules map**

  In `packages/db/src/seed-storefront-archetypes.ts`, add above the `seedStorefrontArchetypes` function:

  ```typescript
  const MARKETING_SKILL_RULES: Record<string, Record<string, unknown>> = {
    "hoa-property-management": {
      "seo-content-optimizer": { visible: false },
      "competitive-analysis": { visible: false },
      "email-campaign-builder": {
        label: "Community Notice Builder",
        reframe: "Focus on official community communications: bylaw updates, assessment notices, meeting invitations, maintenance schedules. Tone is official and transparent, not promotional.",
      },
    },
    "healthcare-wellness": {
      "competitive-analysis": {
        label: "Local Practice Positioning",
        reframe: "Focus on patient experience differentiation and local practice awareness. Avoid aggressive competitive language -- healthcare is regulated and trust-based.",
      },
      "email-campaign-builder": {
        label: "Patient Communication Builder",
        reframe: "Focus on patient recall reminders, health tips, new service announcements, and practice updates. Tone is reassuring and professional.",
      },
    },
    "education-training": {
      "email-campaign-builder": {
        label: "Enrolment Communication Builder",
        reframe: "Focus on term launches, open day invitations, student success stories, and enrolment drives. Tone is encouraging and achievement-focused.",
      },
    },
    "nonprofit-community": {
      "seo-content-optimizer": {
        label: "Cause Visibility Advisor",
        reframe: "Focus on mission awareness, cause-related search visibility, and being found by potential donors, volunteers, and grant makers.",
      },
      "competitive-analysis": {
        label: "Peer Landscape Review",
        reframe: "Focus on peer organizations serving similar causes. Help differentiate for donors and identify collaboration opportunities rather than competitive positioning.",
      },
      "email-campaign-builder": {
        label: "Donor & Volunteer Communication Builder",
        reframe: "Focus on impact storytelling, donor stewardship, volunteer appreciation, and fundraising event promotion. Tone is mission-focused and gratitude-first.",
      },
    },
  };
  ```

- [ ] **Step 2: Update the upsert to include `marketingSkillRules`**

  In the `create` block (line 15-24), add:

  ```typescript
  marketingSkillRules: json(MARKETING_SKILL_RULES[archetype.category] ?? {}),
  ```

  In the `update` block (line 27-35), add the same line:

  ```typescript
  marketingSkillRules: json(MARKETING_SKILL_RULES[archetype.category] ?? {}),
  ```

  **Note:** Only 4 of 11 archetypes have explicit rules. The remaining 7 (`professional-services`, `trades-maintenance`, `food-hospitality`, `beauty-personal-care`, `fitness-recreation`, `pet-services`, `retail-goods`) intentionally get `{}` via the fallback — all skills show with default labels per the spec's archetype rule matrix.

- [ ] **Step 3: Commit**

  ```
  feat(seed): populate marketingSkillRules defaults for all archetypes
  ```

---

## Task 3: Create the 3 New Skill Files

**Files:**

- Create: `skills/storefront/seo-content-optimizer.skill.md`
- Create: `skills/storefront/email-campaign-builder.skill.md`
- Create: `skills/storefront/competitive-analysis.skill.md`

- [ ] **Step 1: Create `skills/storefront/seo-content-optimizer.skill.md`**

  ```markdown
  ---
  name: seo-content-optimizer
  description: "Help the business get found online with topic and content structure guidance"
  category: storefront
  assignTo: ["marketing-specialist"]
  capability: "view_storefront"
  taskType: "analysis"
  triggerPattern: "seo|search|found online|content topics|what to write"
  userInvocable: true
  agentInvocable: true
  allowedTools: [analyze_seo_opportunity, get_marketing_summary]
  composesFrom: []
  contextRequirements: []
  riskBand: low
  ---

  # SEO Content Optimizer

  Suggest 3-5 content topics to help this business get found online.

  ## Steps

  1. Use `analyze_seo_opportunity` to fetch business context: archetype, services/products, location, existing content.
  2. Identify 3-5 topic opportunities based on what the business offers and what local customers search for.
  3. For each topic, provide: suggested title, target search intent (informational/transactional/local), key points to cover, recommended content format (blog post, FAQ page, service page).
  4. Rank by estimated impact and effort.
  5. Ask the user which topics they want to pursue. Offer to create a backlog item for the chosen topic.

  ## Guidelines

  - Frame as "what to write about" not "keyword density" -- no SEO jargon.
  - Ground every suggestion in the business's actual services/products from PAGE DATA.
  - Prioritize local search intent for brick-and-mortar archetypes.
  - Include practical structure advice: headings, FAQ sections, location mentions.
  - Avoid generic advice -- every suggestion should reference the user's specific business context.
  ```

- [ ] **Step 2: Create `skills/storefront/email-campaign-builder.skill.md`**

  ```markdown
  ---
  name: email-campaign-builder
  description: "Draft complete, ready-to-send emails adapted to the business archetype"
  category: storefront
  assignTo: ["marketing-specialist"]
  capability: "view_storefront"
  taskType: "conversation"
  triggerPattern: "email|newsletter|send|subject line|campaign email"
  userInvocable: true
  agentInvocable: true
  allowedTools: [get_marketing_summary]
  composesFrom: []
  contextRequirements: []
  riskBand: low
  ---

  # Email Campaign Builder

  Draft a complete, ready-to-send email for this business.

  ## Steps

  1. Use `get_marketing_summary` to load business context, playbook, and recent activity.
  2. Ask the user what the email is for (choose from archetype-appropriate options: promotion, reminder, announcement, follow-up, seasonal, welcome sequence).
  3. Ask who it is for (use archetype stakeholder language from PAGE DATA -- "homeowners", "patients", "donors", not "customers").
  4. Generate a complete email draft including:
     - 3 subject line variants (short, curiosity, direct)
     - Pre-header text
     - Email body with greeting, content, and CTA
     - Plain-text fallback version
  5. Ask if they want to adjust tone, length, or CTA before finalising.

  ## Guidelines

  - Use the archetype's contentTone and ctaLanguage from the marketing playbook.
  - Keep emails concise -- SMB audiences respond to short, clear messages.
  - Always include one clear CTA, using the archetype's CTA vocabulary.
  - For sequences (welcome, nurture), outline the full sequence structure but draft one email at a time.
  - Never include unsubscribe/legal boilerplate -- that is the email platform's job.
  ```

- [ ] **Step 3: Create `skills/storefront/competitive-analysis.skill.md`**

  ```markdown
  ---
  name: competitive-analysis
  description: "Guided conversation to understand competitive position and find differentiation opportunities"
  category: storefront
  assignTo: ["marketing-specialist"]
  capability: "view_storefront"
  taskType: "analysis"
  triggerPattern: "competitor|competition|differentiate|positioning|market position"
  userInvocable: true
  agentInvocable: true
  allowedTools: [get_marketing_summary]
  composesFrom: []
  contextRequirements: []
  riskBand: low
  ---

  # Competitive Analysis

  Help the user understand their competitive position and identify differentiation opportunities.

  ## Steps

  1. Use `get_marketing_summary` to understand the business type and offerings.
  2. Ask the user to name 2-3 competitors (or describe the competitive landscape if unsure).
  3. For each competitor, ask: What do they do well? What do your customers say they lack?
  4. Synthesize a positioning summary:
     - Where the user's business overlaps with competitors
     - Where the user's business is differentiated
     - Gaps that represent opportunities
  5. Recommend 2-3 concrete positioning actions (messaging changes, service gaps to fill, content to create).
  6. Ask the user which actions they want to pursue. Offer to create backlog items for chosen actions.

  ## Guidelines

  - This is a guided conversation, not a data-driven report -- the user provides the competitive intelligence, the specialist structures the analysis.
  - Focus on actionable differentiation, not comprehensive market research.
  - Use the business's own language and stakeholder terms from PAGE DATA.
  - Keep the output practical: "Here is what to say differently" not "Here is a SWOT matrix."
  - Avoid generic advice -- every recommendation should reference the user's specific situation.
  ```

- [ ] **Step 4: Commit**

  ```
  feat(skills): add seo-content-optimizer, email-campaign-builder, competitive-analysis skills
  ```

---

## Task 4: Add `analyze_seo_opportunity` MCP Tool

**Files:**

- Modify: `apps/web/lib/mcp-tools.ts` (tool definition near line ~196, handler near line ~5636)
- Test: `apps/web/lib/mcp-tools.test.ts` (if exists, add test; otherwise manual)

- [ ] **Step 1: Add the tool definition**

  In `apps/web/lib/mcp-tools.ts`, add to the `PLATFORM_TOOLS` array after the `suggest_campaign_ideas` definition (around line 199):

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
  },
  ```

- [ ] **Step 2: Add the handler**

  In the `switch (toolName)` block, after the `suggest_campaign_ideas` case (around line 5636), add:

  ```typescript
  case "analyze_seo_opportunity": {
    const { getPlaybook } = await import("@/lib/tak/marketing-playbooks");

    const config = await prisma.storefrontConfig.findFirst({
      include: {
        archetype: { select: { archetypeId: true, name: true, category: true, ctaType: true } },
        items: {
          where: { isActive: true },
          select: { name: true, description: true, ctaType: true },
          orderBy: { sortOrder: "asc" },
          take: 20,
        },
        sections: {
          where: { isVisible: true },
          select: { type: true, title: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!config) {
      return { success: true, message: "No storefront configured. Set up your storefront first at /storefront/setup." };
    }

    const playbook = getPlaybook(config.archetype.category, config.archetype.ctaType);

    // Get organization location if available
    const org = await prisma.organization.findFirst({
      select: { address: true, name: true },
    });
    const address = org?.address as Record<string, string> | null;
    const location = address?.city
      ? `${address.city}${address.region ? `, ${address.region}` : ""}${address.country ? `, ${address.country}` : ""}`
      : null;

    // Build suggested search intents from services + location
    const serviceNames = config.items.map((i) => i.name);
    const locationSuffix = location ? ` ${address?.city}` : " near me";
    const suggestedSearchIntents = serviceNames.slice(0, 5).map((name) => `${name.toLowerCase()}${locationSuffix}`);

    // Add generic archetype-based intents
    if (config.archetype.category === "healthcare-wellness") {
      suggestedSearchIntents.push(`${config.archetype.name.toLowerCase()} accepting patients${locationSuffix}`);
    } else if (config.archetype.category === "trades-maintenance") {
      suggestedSearchIntents.push(`emergency ${config.archetype.name.toLowerCase()}${locationSuffix}`);
    } else if (config.archetype.category === "food-hospitality") {
      suggestedSearchIntents.push(`best ${config.archetype.name.toLowerCase()}${locationSuffix}`);
    }

    return {
      success: true,
      message: `SEO context for ${config.archetype.name}`,
      data: {
        businessType: config.archetype.name,
        archetype: {
          category: config.archetype.category,
          name: config.archetype.name,
        },
        location,
        services: serviceNames,
        existingContent: config.sections.map((s) => s.title || s.type),
        playbook: {
          primaryGoal: playbook.primaryGoal,
          campaignTypes: playbook.campaignTypes,
        },
        suggestedSearchIntents,
      },
    };
  }
  ```

- [ ] **Step 3: Commit**

  ```
  feat(tools): add analyze_seo_opportunity MCP tool for SEO content guidance
  ```

---

## Task 5: Add New Skills to Agent Routing Config

**Files:**

- Modify: `apps/web/lib/tak/agent-routing.ts` (lines 350-355, the marketing specialist `skills` array)

- [ ] **Step 1: Add `skillId` to existing marketing specialist skills**

  In `apps/web/lib/tak/agent-routing.ts`, update the marketing specialist skills array (lines 350-355) to add `skillId` to each existing entry:

  ```typescript
  skills: [
    { skillId: "campaign-ideas", label: "Campaign ideas", description: "Get archetype-tailored campaign suggestions", capability: "view_storefront", prompt: "Suggest 3-5 marketing campaigns tailored to our business type and current season. Reference the archetype playbook in your PAGE DATA. For each campaign: name, goal, target audience, channel, and expected outcome." },
    { skillId: "content-brief", label: "Content brief", description: "Draft a content piece for your audience", capability: "view_storefront", prompt: "Draft a content brief for a marketing piece adapted to our business archetype. Include: topic, format (blog/email/social/flyer), tone guidance from the playbook, key messages, and call-to-action. Ask what the content should be about." },
    { skillId: "review-inbox", label: "Review inbox", description: "Spot marketing opportunities in recent interactions", capability: "view_storefront", prompt: "Summarise recent storefront inbox activity. Identify marketing opportunities \u2014 recurring questions that could become FAQ content, popular services that deserve promotion, or quiet periods that need campaigns." },
    { skillId: "marketing-health", label: "Marketing health check", description: "Assess your marketing posture by archetype", capability: "view_storefront", prompt: "Run a marketing health check for this business. Using the archetype playbook and current metrics from PAGE DATA: (1) assess whether key metrics are healthy for this business type, (2) identify the biggest gap in the marketing strategy, (3) suggest one high-impact action. Create a backlog item for the recommended action." },
    { skillId: "seo-content-optimizer", label: "SEO Content Optimizer", description: "What to write about to get found online", capability: "view_storefront", prompt: "Analyze our business type, services, and location using the analyze_seo_opportunity tool. Then suggest 3-5 content topics that will help us get found online by the right people. For each topic: suggested title, what the searcher is looking for, key points to cover, and recommended format. Rank by impact and effort." },
    { skillId: "email-campaign-builder", label: "Email Campaign Builder", description: "Draft a ready-to-send email for your audience", capability: "view_storefront", prompt: "Draft a complete, ready-to-send email for our business. Use get_marketing_summary to understand our business type and audience. Ask what the email is for and who it targets. Then produce: 3 subject line variants, pre-header text, full email body with CTA, and a plain-text version. Use the tone and CTA language from our archetype playbook." },
    { skillId: "competitive-analysis", label: "Competitive Analysis", description: "Understand your competitive position", capability: "view_storefront", prompt: "Help me understand our competitive position. Use get_marketing_summary to understand our business type. Then ask me about our competitors \u2014 who they are, what they do well, and what our customers say they lack. Synthesize a positioning summary with overlap, differentiation, and opportunity gaps. Recommend 2-3 concrete actions." },
    { label: "Report an issue", description: "Report a bug or give feedback", capability: null, prompt: "I'd like to report an issue or give feedback about this page." },
  ],
  ```

- [ ] **Step 2: Commit**

  ```
  feat(routing): add 3 new marketing skills with skillId to agent routing config
  ```

---

## Task 6: Archetype Skill Filtering in `AgentSkillsDropdown`

**Files:**

- Modify: `apps/web/components/agent/AgentSkillsDropdown.tsx` (lines 1-18 props, lines 107-113 filtering)
- Modify: `apps/web/components/agent/AgentPanelHeader.tsx` (line 83-88, pass new prop)

- [ ] **Step 1: Add `marketingSkillRules` prop to `AgentSkillsDropdown`**

  In `apps/web/components/agent/AgentSkillsDropdown.tsx`, update the `Props` type (line 16-22):

  ```typescript
  type Props = {
    skills: AgentSkill[];
    userSkills: UserSkill[];
    userContext: UserContext;
    marketingSkillRules?: Record<string, { visible?: boolean; label?: string; reframe?: string }> | null;
    onSend: (prompt: string) => void;
    onCreateSkill: () => void;
  };
  ```

- [ ] **Step 2: Add filtering logic**

  In the component function (after destructuring props at line 81), update the `filteredSkills` logic. Replace the existing filter at line 107-109:

  ```typescript
  const filteredSkills = skills
    .filter((s) => s.capability === null || can(userContext, s.capability))
    .filter((s) => {
      // Archetype-driven visibility: if the skill has a skillId and rules hide it, omit
      if (!s.skillId || !marketingSkillRules) return true;
      const rule = marketingSkillRules[s.skillId];
      if (rule && rule.visible === false) return false;
      return true;
    })
    .map((s) => {
      // Archetype-driven relabeling: if the skill has a skillId and rules relabel it, override
      if (!s.skillId || !marketingSkillRules) return s;
      const rule = marketingSkillRules[s.skillId];
      if (rule && rule.label && rule.reframe) {
        return {
          ...s,
          label: rule.label,
          prompt: `[ARCHETYPE CONTEXT: ${rule.reframe}]\n\n${s.prompt}`,
        };
      }
      return s;
    });
  ```

- [ ] **Step 3: Update `AgentPanelHeader` to pass the prop**

  In `apps/web/components/agent/AgentPanelHeader.tsx`, add `marketingSkillRules` to the component props type and pass it through to `AgentSkillsDropdown` (line 83-88):

  Add to the props type:

  ```typescript
  marketingSkillRules?: Record<string, { visible?: boolean; label?: string; reframe?: string }> | null;
  ```

  Update the JSX:

  ```typescript
  <AgentSkillsDropdown
    skills={agent.skills}
    userSkills={[]}
    userContext={userContext}
    marketingSkillRules={marketingSkillRules}
    onSend={onSend}
    onCreateSkill={() => {}}
  />
  ```

- [ ] **Step 4: Commit**

  ```
  feat(ui): add archetype-driven skill filtering and relabeling to AgentSkillsDropdown
  ```

---

## Task 7: Thread `marketingSkillRules` Through Route Context

**Files:**

- Modify: `apps/web/lib/tak/route-context.ts` (lines 390-463, `getStorefrontMarketingContext`)
- Modify: `apps/web/components/agent/AgentCoworkerPanel.tsx` (where agent info is resolved and passed to header)

- [ ] **Step 1: Include `marketingSkillRules` in storefront context query**

  In `apps/web/lib/tak/route-context.ts`, update the `getStorefrontMarketingContext` function. At line 394, extend the `archetype` select to include `marketingSkillRules`:

  ```typescript
  archetype: {
    select: { archetypeId: true, name: true, category: true, ctaType: true, customVocabulary: true, marketingSkillRules: true },
  },
  ```

- [ ] **Step 2: Return `marketingSkillRules` as structured data**

  The current function returns a string (for PAGE DATA injection). The `marketingSkillRules` needs to reach the UI component as structured data, not as a string in PAGE DATA. There are two options:

  **Option A (recommended):** Create a server action that the `AgentCoworkerPanel` can call from the client. Add to `apps/web/lib/actions/agent-coworker.ts` (where other coworker server actions live):

  ```typescript
  export async function getMarketingSkillRules(): Promise<Record<string, unknown> | null> {
    "use server";
    const config = await prisma.storefrontConfig.findFirst({
      include: {
        archetype: { select: { marketingSkillRules: true } },
      },
    });
    if (!config?.archetype?.marketingSkillRules) return null;
    return config.archetype.marketingSkillRules as Record<string, unknown>;
  }
  ```

  **Important:** This must be a server action (with `"use server"`) because it uses Prisma. It cannot be imported directly into a client component.

- [ ] **Step 3: Call from `AgentCoworkerPanel` and thread to header**

  In `apps/web/components/agent/AgentCoworkerPanel.tsx`:

  1. Import the server action:
     ```typescript
     import { getMarketingSkillRules } from "@/lib/actions/agent-coworker";
     ```

  2. Add state and fetch in `useEffect`:
     ```typescript
     const [marketingSkillRules, setMarketingSkillRules] = useState<Record<string, { visible?: boolean; label?: string; reframe?: string }> | null>(null);

     useEffect(() => {
       if (agent?.agentId !== "marketing-specialist") {
         setMarketingSkillRules(null);
         return;
       }
       getMarketingSkillRules().then((rules) =>
         setMarketingSkillRules(rules as Record<string, { visible?: boolean; label?: string; reframe?: string }> | null)
       );
     }, [agent?.agentId]);
     ```

  3. Pass to `<AgentPanelHeader>` in the JSX:
     ```tsx
     <AgentPanelHeader
       agent={agent}
       userContext={userContext}
       marketingSkillRules={marketingSkillRules}
       onSend={handleSend}
       {/* ...other existing props */}
     />
     ```

- [ ] **Step 4: Commit**

  ```
  feat(context): thread marketingSkillRules from archetype to AgentSkillsDropdown
  ```

---

## Task 8: Write Tests

**Files:**

- Modify: `apps/web/components/agent/AgentSkillsDropdown.test.tsx`
- Create (if needed): Test for `analyze_seo_opportunity` handler

- [ ] **Step 1: Test skill filtering — hidden skills**

  In `apps/web/components/agent/AgentSkillsDropdown.test.tsx`, add a test:

  ```typescript
  it("hides skills when marketingSkillRules sets visible: false", () => {
    const skills: AgentSkill[] = [
      { skillId: "seo-content-optimizer", label: "SEO Content Optimizer", description: "test", capability: null, prompt: "test" },
      { skillId: "email-campaign-builder", label: "Email Campaign Builder", description: "test", capability: null, prompt: "test" },
    ];
    const rules = { "seo-content-optimizer": { visible: false as const } };
    const html = renderToStaticMarkup(
      <AgentSkillsDropdown skills={skills} userSkills={[]} userContext={testUserContext} marketingSkillRules={rules} onSend={() => {}} onCreateSkill={() => {}} />
    );
    expect(html).not.toContain("SEO Content Optimizer");
    expect(html).toContain("Email Campaign Builder");
  });
  ```

- [ ] **Step 2: Test skill filtering — relabeled skills**

  ```typescript
  it("relabels skills when marketingSkillRules provides label and reframe", () => {
    const skills: AgentSkill[] = [
      { skillId: "competitive-analysis", label: "Competitive Analysis", description: "test", capability: null, prompt: "original prompt" },
    ];
    const rules = {
      "competitive-analysis": { label: "Peer Landscape Review", reframe: "Focus on peer organizations" },
    };
    const html = renderToStaticMarkup(
      <AgentSkillsDropdown skills={skills} userSkills={[]} userContext={testUserContext} marketingSkillRules={rules} onSend={() => {}} onCreateSkill={() => {}} />
    );
    expect(html).toContain("Peer Landscape Review");
    expect(html).not.toContain("Competitive Analysis");
  });
  ```

- [ ] **Step 3: Test skill filtering — null rules show all**

  ```typescript
  it("shows all skills when marketingSkillRules is null", () => {
    const skills: AgentSkill[] = [
      { skillId: "seo-content-optimizer", label: "SEO Content Optimizer", description: "test", capability: null, prompt: "test" },
    ];
    const html = renderToStaticMarkup(
      <AgentSkillsDropdown skills={skills} userSkills={[]} userContext={testUserContext} marketingSkillRules={null} onSend={() => {}} onCreateSkill={() => {}} />
    );
    expect(html).toContain("SEO Content Optimizer");
  });
  ```

- [ ] **Step 4: Run tests**

  ```bash
  cd /d/DPF && pnpm --filter web exec vitest run apps/web/components/agent/AgentSkillsDropdown.test.tsx
  ```

- [ ] **Step 5: Commit**

  ```
  test(ui): add AgentSkillsDropdown archetype skill filtering tests
  ```

---

## Task 9: Verify Skill Seeding

**Files:**

- No changes needed to `packages/db/src/seed-skills.ts` — it auto-discovers all `.skill.md` files by globbing `skills/*/`. The 3 new files in `skills/storefront/` will be picked up automatically.

- [ ] **Step 1: Verify the files exist**

  ```bash
  cd /d/DPF && ls skills/storefront/*.skill.md
  ```

  Expected: 6 files (3 existing + 3 new).

- [ ] **Step 2: Run the full seed (if Docker is available)**

  ```bash
  cd /d/DPF && pnpm --filter @dpf/db exec prisma db seed
  ```

  Check console output for the 3 new skill definitions being upserted and assigned to `marketing-specialist`.

- [ ] **Step 3: Commit (if any fixes needed)**

---

## Task 10: Manual Integration Test

- [ ] **Step 1: Start the dev server**

  ```bash
  cd /d/DPF && pnpm dev
  ```

- [ ] **Step 2: Navigate to `/storefront`**

  Open the coworker panel (FAB button). Verify the Skills dropdown shows the 3 new skills alongside the existing ones.

- [ ] **Step 3: Test with HOA archetype**

  If the storefront is configured as HOA:
  - Verify "SEO Content Optimizer" and "Competitive Analysis" are NOT in the dropdown
  - Verify "Email Campaign Builder" shows as "Community Notice Builder"

- [ ] **Step 4: Test with a default archetype (e.g., restaurant)**

  - Verify all 3 new skills appear with their default labels
  - Click each skill and verify the conversation starts with the correct prompt

- [ ] **Step 5: Test with nonprofit archetype**

  - Verify "SEO Content Optimizer" shows as "Cause Visibility Advisor"
  - Verify "Competitive Analysis" shows as "Peer Landscape Review"
  - Verify "Email Campaign Builder" shows as "Donor & Volunteer Communication Builder"

---

## Summary

| Task | Description | Files |
|---|---|---|
| 1 | Schema migration | schema.prisma, migration.sql |
| 2 | Seed archetype rules | seed-storefront-archetypes.ts |
| 3 | 3 new skill files | skills/storefront/*.skill.md |
| 4 | `analyze_seo_opportunity` MCP tool | mcp-tools.ts |
| 5 | Agent routing config | agent-routing.ts |
| 6 | UI skill filtering | AgentSkillsDropdown.tsx, AgentPanelHeader.tsx |
| 7 | Thread rules to UI | route-context.ts, AgentCoworkerPanel.tsx |
| 8 | Tests | AgentSkillsDropdown.test.tsx |
| 9 | Verify seed | manual |
| 10 | Manual integration test | manual |
