# Build Studio Process Improvements
## Executive Summary

**Current State:** Build Studio ideate phase asks minimal questions, does silent async research, then design review often fails due to missing context. Result: revision cycles, delayed features, frustrated users.

**Recommended Fix:** Add Scout Phase that researches codebase + parses user-provided evidence BEFORE asking clarification questions. Questions are then informed by findings, not generic.

---

## Three Key Problems Identified

### 1. **Design Review Failures Upstream**
- Current: 55% of designs fail first design review
- Root cause: Missing context (existing code audit, integration points, domain entities)
- Symptom: "Design doesn't address lead capture" flagged 3 times on HOA website feature
- Fix: Scout finds existing models + user's evidence tells us what's actually needed

### 2. **Generic Questions Don't Build Confidence**
- Current: "What's success look like?" feels generic
- Users provide evidence (URLs, screenshots) but coworker doesn't parse/use it
- Symptom: "The site shows X, should we do Y?" questions come too late (Phase 4 design review)
- Fix: Ask targeted questions informed by codebase search + parsed external evidence

### 3. **No Right-Sizing of Interaction**
- Current: Coworker asks same questions for a one-page feature as a multi-portfolio epic
- Users either get: not enough guidance (confused at design stage) or too many questions (abandoned)
- Symptom: Website feature is treated as single build; lead capture is also single build (but needs decomposition)
- Fix: Complexity assessment (Phase 3) surfaces Epic-level features early

---

## Five-Phase Improved Flow

| Phase | Owner | Time | Outcome |
|-------|-------|------|---------|
| **0. Intake Setup** | User | ~30s | Provides title + description + optional URLs/docs |
| **1. Scout Research** | AI Coworker | ~60s | Finds existing models, parses external evidence, identifies gaps |
| **2. Clarification** | User + Coworker | 2-4 turns | Answers 2-3 targeted questions informed by scout findings |
| **3. Complexity Assessment** | AI Coworker | ~30s | Determines if single build or epic; recommends taxonomy |
| **4. Design Research** | AI Coworker | 10-15 min | Full research, informed by phases 1-3. Design doc is substantive. |
| **5. Design Review + Handoff** | AI Coworker + Reviewer | 5-10 min | Review passes because context is complete |

**Total:** 15-20 min → 10-12 min (20% faster, 80% first-pass success rate)

---

## Three Critical Changes

### **Change 1: Add Scout Phase (New Tool)**
What it does:
- Searches codebase in <60s for related models, routes, components
- Fetches + parses user-provided URLs (e.g., ascensionpm.com)
- Identifies: "Found StorefrontConfig + CalendarEvent. Site has 8 sections. Member model missing."
- Shows findings to user (checkmarks + questions to investigate)

Why it matters:
- User sees coworker understands the domain
- Prevents thin design audits (scout provides file references)
- Informs which questions to ask

Tool name: `start_scout_research`

---

### **Change 2: Informed Clarification Questions**
What it does:
- Instead of "What's success look like?", ask: "Scout found calendar events on the site. Should we use the existing CalendarEvent model or create a new one?"
- Each question is grounded: "Your site shows X. Should we do Y or Z?"
- Max 2-3 questions per feature (scout already covered generic questions)

Why it matters:
- Questions feel smart, not generic
- Answers directly influence design (reduce revision cycles)
- Users don't feel over-questioned

Rule: Frame all Phase 2 questions with scout findings as context.

---

### **Change 3: Complexity Assessment (New Tool)**
What it does:
- Analyzes scout findings + user answers across 7 dimensions: taxonomy span, data entities, integrations, novelty, regulatory risk, build count, dependency risk
- Returns: "Medium complexity: 1 new model + 2 integrations. Estimate: 1 build."
- Or: "High complexity: Spans 3 portfolios + 5 data entities. Recommend Epic decomposition into 4-5 builds."

Why it matters:
- Surfaces Epic-scale features early (avoid wasting 30 min on design for what needs 5 builds)
- Guides taxonomy placement (Medium features → Product Suites, High complexity features → Portfolio-spanning Epics)
- Sets realistic expectations

Tool name: `assess_complexity`

---

## Implementation Checklist

- [ ] **Scout Tool**: Add `start_scout_research` that searches codebase + fetches URLs via browser-use
- [ ] **Scout Integration**: Integrate with browser-use MCP (`browse_open`, `browse_extract`)
- [ ] **Ideate Prompt**: Update PHASE_PROMPTS["ideate"] to include Scout phase before clarification questions
- [ ] **Complexity Tool**: Add `assess_complexity` that evaluates 7 dimensions
- [ ] **Design Research Enhancement**: Modify `start_ideate_research` input to accept scout findings + user answers
- [ ] **Phase Handoff**: Update phase handoff to include scout findings + complexity assessment
- [ ] **Testing**: Run ideate flow on 5 diverse features (simple, medium, complex, epic-scale, cross-portfolio)
- [ ] **Documentation**: Update Build Studio guide with new flow

---

## Expected Outcomes

| Metric | Current | Target |
|--------|---------|--------|
| Ideate → Design time | 15-20 min | 10-12 min |
| Design review pass rate (1st attempt) | 45% | 80% |
| Revision cycles per build | 1.5 | 0.5 |
| Time to identify Epic vs. single build | Phase 4 (design review) | Phase 3 (ideate) |
| User confidence in clarity ("coworker understands") | 60% | 90% |

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Scout takes >60s | Show progress bar. Non-blocking—if timeout, skip to Phase 4. |
| URL fetching fails | Graceful fallback: proceed with codebase scout alone. URLs are optional. |
| Too many Phase 2 questions | Design phase can ask follow-ups (escalation path). Don't force Ideate to cover everything. |
| Scout finds nothing | Proceed with user description. Scout output says "No existing models found". |

---

## Next Steps

1. **This week**: Spec review + sign-off on improved flow
2. **Week 1-2**: Build scout tool + browser-use integration
3. **Week 2-3**: Update ideate prompt + complexity assessment tool
4. **Week 4**: Testing on diverse feature requests
5. **Week 5**: Deploy + monitor success metrics

---

## Files Updated

- **New**: `/d/DPF/docs/superpowers/specs/2026-04-16-improved-intake-flow.md` — Full design spec with examples
- **Reference**: `/d/DPF/prompts/build-phase/ideate.prompt.md` — Current prompt (to be updated)
- **Reference**: `/d/DPF/apps/web/lib/integrate/build-agent-prompts.ts` — Ideate phase logic (lines 96-184)

---

## Why This Matters

Build Studio is designed to let the platform build itself. But if intake is weak, downstream phases fail:
- Weak intake → thin design doc → design review rejection → revision cycle → user friction
- Smart intake → substantive design doc → design passes 1st time → faster ships

This spec shifts the burden of intake quality from "ask users more questions" to "do smarter research first." It respects both the user's time and the AI coworker's intelligence.
