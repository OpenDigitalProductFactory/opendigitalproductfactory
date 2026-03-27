# EP-BIZ-ROLES Portal Optimization Log
**Date:** 2026-03-27
**Run:** 43/43 tests passed across 6 suites (5 business personas + 1 exploratory)
**Duration:** ~2.5 min

---

## Infrastructure Gaps Found

| ID | Observation | Severity | Recommendation |
|----|-------------|----------|---------------|
| GAP-006 | No product creation UI in portfolio pages — 100% of product creation fell back to direct SQL insertion | High | Add "New Product" button to portfolio view (EP-BIZ-ROLES Phase 2) |
| GAP-007 | `/ops` has no search input — search not implemented | Low | Track in backlog; not blocking current epic |
| GAP-008 | `PlatformSetupProgress` is not auto-completed after DB seed — portal redirects to `/setup` on fresh DB | Medium | Seed script should mark setup steps complete (or add a CLI flag) |

---

## AI Coworker Response Quality (Suite 6 Scores)

Scores are out of 10: relevance(3) + helpful(3) + length(2) + format(2).

| OPT | Prompt Type | Score | Notes |
|-----|-------------|-------|-------|
| A1 | One-word: `saas` | 6/10 | Defined the term correctly, no markdown formatting |
| A2 | One-word: `roles` | 6/10 | Gave generic platform orientation — correct but imprecise context |
| A3 | Open: `what can you do` | 8/10 | Used bullet list, clear capabilities summary |
| B1 | Typo-heavy: `wat buisness modl shoud i use fr a car warsh` | 8/10 | **Correctly parsed intent through heavy typos.** Minor formatting gap |
| B2 | Casual: `help me set up my pool company stuff` | 8/10 | Asked follow-up questions, but "helpful" score penalised for not mapping to platform actions |
| B3 | Incomplete sentence: `what roles does a nonprofit need when they` | 7/10 | Completed the sentence with a reasonable assumption — useful behaviour |
| C1 | Wrong term: `add a department to my product` | 5/10 | **Failed to redirect "department" → "role".** Treated as HR org question, not product roles |
| C2 | Wrong term: `create a new app` | 9/10 | Correctly mapped "app" → "digital product" and proceeded |
| D1 | Internal term: `HITL tier` | 10/10 | Perfect score — full awareness of HITL framework and how it applies to roles |
| D2 | Multi-turn context: second message after HOA shelter context | 7/10 | **Context not fully retained** — response was generic rather than shelter-specific |
| D3 | Context switch HOA → pool | 6/10 | Acknowledged topic change but gave a very short one-liner response |
| E1 | Unlisted industry: `food truck` | 10/10 | Suggested both a relevant built-in template AND explained when to create custom — ideal |
| E2 | Contradictory: `assign all 8 BMs to one product` | 9/10 | Explained multi-assign process. Minor: gave Python-style code example (wrong language for context) |
| E3 | Nonsense: `asdkjh qwerty 12345 !!@@##` | 5/10 | Graceful fallback, but did not ask a **clarifying question** (ended with a statement, not a `?`) |

**Average score: 7.5/10**

---

## Top Optimization Opportunities

### OPT-HIGH-001 — Redirect wrong terminology to platform concepts
**Trigger:** User says "department", "team", "staff", "employee" when they mean a product role
**Current:** Agent treats as HR/org question (score 5/10)
**Recommendation:** Add intent mapping in system prompt: `"department in a product context" → "Business Model Role"`

### OPT-HIGH-002 — Clarifying question on nonsense / unintelligible input
**Trigger:** Unrecognisable or random input
**Current:** Agent says "Is there something I can help you with?" — this is a statement with a `?` appended. The `asked_clarification` check (contains `?`) returns `false`
**Recommendation:** Ensure the fallback response ends with a genuine question: `"I didn't quite catch that — what were you trying to do?"`

### OPT-MED-003 — Multi-turn context retention
**Trigger:** Follow-up `"what roles do we need"` after establishing a pet shelter context
**Current:** Response reverts to generic roles list, loses the shelter context
**Recommendation:** Review conversation memory window in `AgentCoworkerPanel`. Check if prior messages are included in the LLM context payload.

### OPT-MED-004 — Code examples use wrong language/context
**Trigger:** Mass-assign request
**Current:** Response gives Python ORM example (`Product.objects.get(...)`) — irrelevant to a web UI user
**Recommendation:** Constrain system prompt: "never give code examples unless the user is explicitly asking to write code". Guide to UI actions instead.

### OPT-MED-005 — One-word/vague input: missing clarification
**Trigger:** Single-word inputs like `saas`, `roles`
**Current:** Gives a definition without asking what the user wants to do with it (score 6/10)
**Recommendation:** For inputs under ~3 words with no action verb, respond with a clarifying question: `"What would you like to do — set up roles for a SaaS product, or learn about models?"`

### OPT-LOW-006 — Context switch response is too thin
**Trigger:** Abrupt topic change mid-conversation
**Current:** One-sentence acknowledgment (`"What's up with pools?"`) — helpful=1
**Recommendation:** Follow topic-switch acknowledgment with a 2–3 item menu of next actions relevant to the new topic.

### OPT-LOW-007 — Response format: markdown not consistently used
**Trigger:** Most business-context responses
**Current:** Some responses use plain newlines instead of bullet lists; format score varies 0–2/2
**Recommendation:** Add formatting instruction to system prompt: "use markdown bullet lists for any response with 3+ items; use headers for multi-section responses."

---

## Performance Observations

| Metric | Value | Status |
|--------|-------|--------|
| Admin Business Models page load | ~780ms avg | ✓ Good |
| Product detail page load (cold) | <1s | ✓ Good |
| AI Coworker first token latency | ~3–8s (inference) | Acceptable for local Docker Model Runner |
| AI Coworker total response time | ~15–40s | Within 45s test timeout |
| Portfolio page (with 3–5 products) | <500ms | ✓ Good |

---

## Test Infrastructure Fixes Applied This Session

1. **`navigateToProductDetail`**: Replaced `a:has-text()` + `waitForLoadState` with `a[href*="/portfolio/product/"]` + `Promise.all([waitForURL, click])` — fixed race condition with Next.js client-side router.
2. **`openCoworker` FAB timeout**: Increased from 4s → 8s to allow workspace hydration.
3. **Suite 6 / 404 locator**: Fixed broken `text=A, text=B` Playwright locator to use `.or()` chaining; added "could not be found" text from Next.js default 404.
4. **SQL seed via stdin pipe**: All Docker exec SQL injection uses `{ input: sql, stdio: ['pipe','pipe','pipe'] }` — eliminates Windows cmd.exe quote corruption.

---

## GAP Summary (from all suites)

| GAP | Description | Status |
|-----|-------------|--------|
| GAP-001 | Business Model selector absent on product detail | **Resolved** — navigation fix unblocked this |
| GAP-002 | `GET /api/v1/business-models` not returning data | **Resolved** — portal rebuild surfaced new route |
| GAP-003 | Role assignments: no users available to assign | Observed — no employee profiles in test DB |
| GAP-004 | No custom business model creation tested end-to-end | Deferred |
| GAP-005 | Role Assignments heading absent | **Resolved** — navigation fix unblocked this |
| GAP-006 | No product creation UI in portfolio | Open — SQL fallback active |
| GAP-007 | No search on `/ops` | Open — low priority |
| GAP-008 | Setup wizard not auto-completed on fresh DB | Open — workaround: SQL UPDATE |
