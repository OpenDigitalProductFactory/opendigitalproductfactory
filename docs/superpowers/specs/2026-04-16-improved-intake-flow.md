# Build Studio: Improved Intake Flow
## Shift Intake Intelligence from User to AI Coworker

**Status:** Design Proposal  
**Date:** 2026-04-16  
**Problem:** Current ideate phase asks minimal questions, then does async codebase research, leading to design failures and revision cycles. Users get design review failures after work is done instead of critical questions upfront.

**Solution:** Add a **Scout Phase** (lightweight codebase research) BEFORE asking clarifying questions. Questions are informed by research findings, not generic. This prevents design failures and respects user's time.

---

## Current Flow (Problem)

```
User: "Incorporate main website into portal"
  ↓
Coworker: "Rebuild or embed?" (1 generic question)
  ↓
User: "100% incorporate"
  ↓
Coworker: "Reusability scope?" (1 generic question)
  ↓
User: "One-off"
  ↓
Coworker: dispatches 600s research (SILENT, user waits)
  ↓
Design doc generated (but missing critical context)
  ↓
Design review FAILS: "Missing lead capture strategy, no integration architecture"
  ↓
Back to ideate for revision ← EXPENSIVE
```

**Pain points:**
- No context gathered before research (research is thin)
- User doesn't know what design will look like
- Design failures come late (after 10+ min of work)
- No way to upload supporting docs or URLs (forced to describe in chat)
- Questions are generic, not informed by codebase

---

## Improved Flow (Solution)

### **PHASE 0: INTAKE SETUP** (~30 seconds)
User provides feature + supporting context (new, not added to STEP 0):
```
Feature title: "Incorporate main website into portal"
Description: "Let HOA members see the public website content inside the portal"
Attachments/Evidence:
  - URL: https://ascensionpm.com/index.html
  - Document: [PDF of site map or design]
  - Screenshots: [home page, navigation, key sections]
```

**Why:** URLs + docs tell us more than typing ever could. Coworker can fetch + parse.

---

### **PHASE 1: SCOUT RESEARCH** (Coworker runs, ~60s, user sees progress)
Coworker does lightweight async search:

**Scout tasks:**
1. **Codebase audit** — Find related features:
   - Search for "storefront", "portal", "public-facing", "website" in apps/web/
   - Find: StorefrontConfig, StorefrontSection, StorefrontItem (existing models)
   - Find: Navigation, layout components, public pages
   - Result: "Found StorefrontConfig + 4 related models"

2. **External evidence parsing** (if user uploaded docs/URLs):
   - Fetch https://ascensionpm.com/index.html
   - Parse structure: header, nav sections, footer, key content blocks
   - Extract: "Site has 8 main sections: Home, Services, Board Members, Calendar, HOA Documents, Contact, Payment Portal, Announcements"
   - Result: "Site is mostly informational + calendar integration"

3. **Domain entity detection**:
   - Compare site structure to existing models
   - Identify: "Calendar is mentioned → CalendarEvent model exists. Documents are mentioned → need to check if FileStorage or similar exists."
   - Identify gaps: "Site shows public member directory → no corresponding model exists (new)"

4. **Integration points**:
   - Search for auth patterns: "Is site public-facing or authenticated? Can users log in?"
   - User said: "Can take login but doesn't require it" → "Optional authentication needed"
   - Find: CalendarEvent model (HOA uses central calendar)

**Scout Output** (shown to user):
```
✓ Found existing StorefrontConfig (7 uses)
✓ Found CalendarEvent model (related to your mention of calendar)
? Site shows public directory — no existing member model found
? Auth is optional — login integration needed
? Site content is embedded in portal — need to determine: 
  Full HTML embed, iframe, content pages within portal, or Markdown/CMS?
```

**Why:** User now knows what exists, sees gaps, understands research scope.

---

### **PHASE 2: TARGETED CLARIFICATION QUESTIONS** (~3-5 turns, driven by scout findings)
Instead of asking generic questions, ask ONLY what scout revealed as ambiguous:

**Scout found CalendarEvent exists:**
- ✓ No question needed: "Central calendar integration" is locked
- Coworker notes: "Calendar integration confirmed — will use existing CalendarEvent"

**Scout couldn't determine: Public member directory**
- Question: "The site shows a member directory (names, contact info, board roles). Should this be in the portal too? If yes, should it sync with existing CRM contacts or create new member records?"
- User response informs: "New model needed or existing data reused?"

**Scout couldn't determine: Content embedding strategy**
- Question: "The website currently shows static HTML pages (Services, Documents, Board Member Bios). In the portal, should these be: (a) Embedded as iframes, (b) Converted to portal pages with portal styling, (c) Linked as external resources?"
- User response informs: Design architecture choice

**Scout found: Optional authentication**
- Question: "The public site doesn't require login. Should the portal version: (a) Stay public (anyone can access), (b) Require portal login (synced to StorefrontConfig access), or (c) Show public by default but show extra content if logged in?"
- User response informs: Permission model

**Pattern:** Each question is grounded in scout findings ("The site shows...", "We found...", "You mentioned..."). No generic "what's success look like?" questions.

**Rules:**
- Max 1 question per turn
- Each question is multiple choice (not open-ended) to close scope
- Coworker shows context (e.g., "The site shows X, should we Y or Z?")
- If user says "just build it as-is", proceed without answer (default to option A)

---

### **PHASE 3: PORTFOLIO COMPLEXITY ASSESSMENT** (Coworker, ~30s)
After scout + questions answered, coworker assesses:

```typescript
{
  taxonomySpan: 1,           // Single product area (Storefronts)
  dataEntities: 3,           // StorefrontPage (new) + StorefrontSection, Calendar
  integrations: 2,           // Calendar + optional Auth
  novelty: "medium",         // Reusing Storefront, new page model
  regulatoryRisk: "low",     // HOA context, no PII capture
  estimatedBuildCount: 1,    // Single self-contained feature
  recommendedTaxonomy: ["Portal Experience > Public Storefronts"],
  assessmentSummary: "Medium complexity. Reuse StorefrontConfig architecture, add StorefrontPage model for multi-page support, integrate with CalendarEvent. Optional auth via StorefrontConfig.isPublished + role checks."
}
```

**Why:** Informs initial estimate + taxonomy placement. Also surfaces if feature is actually an Epic (5+ builds) before design starts.

---

### **PHASE 4: DESIGN RESEARCH + DOCUMENTATION** (~10-15 min, async)
Coworker dispatches full research with enriched context:

**Research input includes:**
- Scout findings (existing models, codebase patterns)
- Clarifying question answers (user's choices)
- External evidence (parsed website structure, domain entities from external docs)
- Portfolio context (complexity assessment, ecosystem links)

**Design doc now includes:**
- **existingFunctionalityAudit**: Concrete file paths from scout (✓ StorefrontConfig in apps/web/... line XXX, ✓ CalendarEvent in schema.prisma...)
- **proposedApproach**: Informed by user's embedding choice + found models
- **dataModel**: Reflects actual schema additions (StorefrontPage, fields, relationships to existing models)
- **reusabilityAnalysis**: Shows what's reused (StorefrontConfig, CalendarEvent) vs new (StorefrontPage)
- **acceptanceCriteria**: Concrete + testable (from external evidence: "Home page displays with hero image and callout sections", "Calendar events show with dates and descriptions")

**Why:** Design research is smarter, context-rich. Audit field is substantive (not flagged for being too short). Acceptance criteria are concrete (from actual website structure, not guessing).

---

### **PHASE 5: DESIGN REVIEW + HANDOFF** (unchanged)
Design review now passes because:
- existingFunctionalityAudit is populated with actual codebase references
- proposedApproach is grounded in user's choices (from Phase 2)
- Reusability is explicit (what's reused, what's new)
- Acceptance criteria are concrete (from external evidence)
- No missing integrations (CalendarEvent was scoped in Phase 2)

Handoff to Design phase with full context. Design architect doesn't need to revise due to missing questions.

---

## Modified Ideate Prompt

Replace current PHASE_PROMPTS["ideate"] with:

```
PERSONA: build-specialist (Software Engineer)
PHASE: ideate

YOUR JOB:
You guide users through a 5-phase intake process to create a feature brief that Design can build from confidently.
You research the codebase first, then ask smart questions informed by what you found.
You do NOT ask generic questions like "what's success look like?" — those are explored during discovery, not ideate.

PHASE 0: INTAKE SETUP
- Listen for: feature title + description
- Ask for: "Can you share any URLs, documents, or screenshots that show what you're building?"
- Store: attachments in AgentAttachment
- Gate: Minimum is title + 1-2 sentence description (don't require attachments)

PHASE 1: SCOUT RESEARCH [AI Coworker responsibility]
- You search the codebase for related features in < 60 seconds
- You fetch + parse any user-provided URLs or documents
- You identify: existing models, patterns, integration points, gaps
- You show findings to user as checkmarks/questions
- You do NOT run full design research yet (that's after Phase 2)

PHASE 2: TARGETED CLARIFICATION
- Ask ONLY questions revealed as ambiguous by scout findings
- Frame each question with context: "Scout found X. Should we do Y or Z?"
- Max 1 question per turn
- If user says "just build it", proceed without answer

PHASE 3: COMPLEXITY ASSESSMENT [AI Coworker responsibility]
- Assess across: taxonomy span, data entities, integrations, novelty, risk, build count
- Recommend portfolio location
- If complexity > "high" → surface that feature might be Epic (5+ builds), suggest decomposition

PHASE 4: DESIGN RESEARCH DISPATCH
- Call: start_ideate_research(reusabilityScope, userContext, scoutFindings, userAnswers)
- Pass scout output + answers so research is informed + grounded
- Result: design doc with substantive audit + concrete approach

PHASE 5: TAXONOMY + HANDOFF
- Confirm taxonomy placement (informed by assessment)
- Call: save_phase_handoff() with scoutFindings + userAnswers included

KEY RULES:
1. Scout runs in < 60s. Show user the progress (research loading).
2. Questions are grounded in scout findings. No generic "success" or "reusability" questions.
3. If user provides URLs/docs, you MUST parse them. URLs that show domain structure are gold.
4. If scout finds existing models, your questions should confirm whether to reuse them.
5. Complexity assessment surfaces Epic-scale features early (don't waste 30 min on design for a 5-build epic).
6. Design research is enriched with scout + answers. This prevents thin audits and design review failures.
```

---

## Tool Changes Needed

### New Tool: `start_scout_research`
**Purpose:** Lightweight async codebase search + external document parsing.

**Input:**
```typescript
{
  featureTitle: string;
  featureDescription: string;
  externalEvidenceUrls?: string[];      // URLs to fetch + parse
  attachmentIds?: string[];             // Document references
}
```

**Output (async):**
```typescript
{
  scoutResults: {
    relatedModels: [{name, file, lineNumber, usage}];
    relatedRoutes: [{name, file, purpose}];
    relatedComponents: [{name, file, purpose}];
    externalStructure?: {                // If URLs provided
      sections: [{title, content}];
      metadata: {author, publicUrl};
    };
    gaps: [{entity, reason}];            // "member model not found"
    questionsToBePicked: string[];        // "Auth model needed?", etc
  };
  estimatedComplexity: "low" | "medium" | "high";
}
```

**Implementation:**
- Call Codex CLI with `search_project_files` for models, routes, components
- Use browser-use MCP (`browse_open`, `browse_extract`) to fetch + parse URLs
- Return findings as structured JSON

---

### Modified Tool: `start_ideate_research`
**Input now includes:**
```typescript
{
  reusabilityScope: "one_off" | "parameterizable" | "already_generic";
  userContext: string;
  scoutFindings: ScoutResult;            // NEW: pass scout context
  userAnswersToQuestions: Record<string, string>;  // NEW: user's clarification answers
  externalEvidence: {                    // NEW: parsed website structure, etc
    sections: [{title, content}];
  };
}
```

**Why:** Design research now knows what exists, what user wants, and what the target looks like. Audit field is substantive.

---

### New Tool: `assess_complexity`
**Purpose:** Determine if feature is single build or needs Epic decomposition.

**Input:**
```typescript
{
  scoutFindings: ScoutResult;
  featureTitle: string;
  userAnswers: Record<string, string>;
}
```

**Output:**
```typescript
{
  taxonomySpan: 1 | 2 | 3;               // Cross-portfolio scope
  dataEntities: number;
  integrations: number;
  novelty: "low" | "medium" | "high";
  regulatoryRisk: "low" | "medium" | "high";
  estimatedBuildCount: number;
  recommendation: "single_build" | "epic_decompose";
  assessmentSummary: string;
}
```

---

## User Experience Improvements

### Before (Current)
```
User: "Incorporate main website"
Coworker: "Rebuild or embed?" (generic, feels like the coworker didn't read)
User: "100% incorporate"
Coworker: "Reusability scope?" (still generic)
User: "One-off"
Coworker: "Researching..." (20s silence)
... (10+ more minutes of silence while async research runs)
Coworker: Design doc ready. Summary: "..."
User reads summary. It's thin on calendar integration, doesn't mention the member directory.
Design review fails: "Missing lead capture architecture"
Back to ideate ← User frustrated
```

### After (Proposed)
```
User: "Incorporate main website. Here's the site: https://ascensionpm.com/"
Coworker: "Thanks! I found StorefrontConfig and CalendarEvent models. Scanning your website... 
Found: Home, Services, Board Members, Calendar, Documents, Contact.
? The site shows a member directory. Should this sync with CRM or be new data?
? How should content embed: as iframes, native portal pages, or external links?"
[User answers: "New member model, native portal pages"]
Coworker: "Thanks! This is medium complexity: 1 new model (StorefrontPage), reusing Storefront + Calendar.
Researching design architecture..." (60s progress bar)
Coworker: "Design ready! Summary: Extend StorefrontConfig with multi-page support. Add StorefrontPage + MemberProfile. Calendar events embedded directly. Acceptance criteria: 8 main sections load with correct styling, calendar shows HOA events, member bios display."
[User approves]
Design phase begins with full context ← Design succeeds first time
```

**Improvements:**
- User provides evidence (URL), not just description
- Coworker shows what it found (builds confidence)
- Questions are grounded ("Your site shows...", not "What's success?")
- User's answers directly inform design (member directory becomes a model requirement)
- Complexity assessment surfaces if feature is actually an Epic
- Design doc is substantive because scout provided audit trail
- Design review likely passes (existing models audited, new models justified)

---

## Success Metrics

| Metric | Current | Target | Why |
|--------|---------|--------|-----|
| Ideate → Design time | 15-20 min | 10-12 min | Scout + questions happen during thinking, not after design |
| Design review pass rate (first attempt) | 45% | 80% | Scout provides audit context; user answers inform design |
| Design revision cycles | 1.5 per build | 0.5 per build | Missing questions caught in Phase 2, not Phase 4 |
| Time to identify Epic (vs. single build) | After design review | During Phase 3 | Complexity assessment surfaces decomposition early |
| User satisfaction with intake | "Questions felt random" | "Coworker understood the domain" | Questions grounded in codebase + user's evidence |

---

## Implementation Roadmap

**Week 1:** Add `start_scout_research` tool + browser-use integration for URL fetching  
**Week 2:** Modify ideate prompt + update PHASE_PROMPTS["ideate"] with scout-first logic  
**Week 3:** Add `assess_complexity` tool + Epic detection  
**Week 4:** Update `start_ideate_research` to accept scout + user answer context  
**Week 5:** Testing + refinement  

**Total effort:** ~60 engineering hours (tooling + prompt refinement)

---

## Risk Mitigation

**Risk:** Scout takes >60s, user waits anyway  
**Mitigation:** Show progress bar. If scout hits timeout, skip to design research (non-blocking).

**Risk:** URL fetching fails or returns garbage  
**Mitigation:** Graceful fallback: skip external evidence, proceed with codebase scout alone.

**Risk:** User doesn't provide URLs/docs, goes back to generic questions  
**Mitigation:** URLs are optional. Scout still runs on title + description alone. Some context is better than none.

**Risk:** Too many clarification questions still (Phase 2 bloats to 5+ questions)  
**Mitigation:** Design phase has an override rule: if design is blocked on missing context, Design phase can ask follow-up questions (escalation path). Don't force Ideate to ask everything.

---

## Appendix: Example Scout Output (Website Incorporation)

**User input:**
```
Title: "Incorporate main website into portal"
Description: "HOA members can see the public website content in the portal"
URL: https://ascensionpm.com/index.html
```

**Scout output (60s):**
```
CODEBASE FINDINGS:
✓ StorefrontConfig model exists (packages/db/prisma/schema.prisma line 3896)
  — Already used in 7 places across apps/web/
  — Supports nested sections, items, and public/private visibility
✓ StorefrontSection model exists (line 3925)
  — Used to organize storefront content hierarchically
✓ CalendarEvent model exists (line 3149)
  — Integrates with EmployeeProfile
  — Supports recurrence rules
✓ Public storefront authentication (StorefrontConfig.isPublished boolean)
  — Controls visibility without login
  — Optional role-based access

EXTERNAL EVIDENCE (ascensionpm.com parsed):
Site structure identified:
  1. Hero section (tagline, image, CTA)
  2. Services section (3 cards: Financial, Legal, Communication)
  3. Board Members section (5 bios, contact info)
  4. HOA Calendar (events list)
  5. Documents section (5 links: bylaws, financials, policies)
  6. Contact form
  7. Payment portal link
  8. Announcements (latest 3 posts)

GAPS IDENTIFIED:
? Member directory not in codebase
  → Question for clarification: "Board members section on site—should this create a new MemberProfile model or sync to existing CRM contacts?"

? Announcement/news model not found
  → Question for clarification: "Announcements section on site—should these be StorefrontItems or a dedicated model?"

? Payment portal currently external link
  → Question for clarification: "Payment portal is external. Should it stay as a link or be embedded?"

POTENTIAL COMPLEXITY RISKS:
- If member directory needs role-based visibility (board vs. general members): NEW access control rules
- If announcements need moderation workflow: NEW task model
- If payment portal embed needed: INTEGRATION with payment system

RECOMMENDED QUESTIONS:
1. "Board Members section shows names + contact info. Should this create individual member records in the portal, or link to existing CRM contacts?"
2. "Announcements are currently on the website. Should these be admin-managed in the portal or remain website-only?"
3. "Payment portal is currently external. Should HOA members access it from within the portal, or keep the external link?"

ESTIMATED COMPLEXITY:
- 1 new model (at minimum: StorefrontPage)
- 2-3 conditional new models (MemberProfile, Announcement) depending on clarifications
- 1 existing integration (CalendarEvent)
- Estimated build count: 1-3 builds depending on answers
```

---

## Conclusion

The improved intake flow respects both the AI coworker's intelligence and the user's time:
- **AI Coworker** does upfront research to ask smart questions
- **User** provides supporting evidence (URLs/docs) + answers targeted questions
- **Result:** Design phase receives full context, fewer revision cycles

This shifts the burden of intake quality from asking the user more questions to the AI coworker doing more research first.
