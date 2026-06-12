# Run 1 Findings — Plumber / Riverside Plumbing Solutions / Sandra Hooper

**Archetype**: Plumber (trades-maintenance)  
**Persona**: Sandra Hooper, owner, non-technical  
**Run date**: 2026-06-12  
**Tester**: Autonomous agent  

---

## Phase A — Setup Wizard (9 steps)

### AUDIT-R1-001 · Minor · Brand URL suggestion absent
**Step**: Archetype selection grid (step preceding Brand)  
**Observed**: Setup grid shows all 56 archetypes directly. No URL-based archetype suggestion step — operator must know their archetype name before browsing the grid.  
**Expected**: A URL entry field that analyses the operator's existing website and suggests the closest archetype(s).  
**Impact**: Low friction for operators who already know their archetype; high friction for borderline cases (e.g. "am I a plumber or a general contractor?").

### AUDIT-R1-002 · Info · Brand extraction gracefully handles fictional URLs
**Step**: Branding (step 3)  
**Observed**: `https://riverside-plumbing.co` (fictional) returned: "Extracted from 2 sources. Primary color #000000, body font Inter. Confidence: 0%." With gap reasons synthesised by AI. No error state.  
**Expected**: Same — graceful degradation with clear confidence signal.  
**Verdict**: Pass. Good handling.

### AUDIT-R1-003 · Important · Operating Hours timezone hardcoded to UTC
**Step**: Operating Hours (step 5)  
**Observed**: "Timezone: UTC" shown as read-only text. No timezone picker. No browser-timezone detection.  
**Expected**: Timezone picker pre-populated from browser `Intl.DateTimeFormat().resolvedOptions().timeZone`.  
**Impact**: All operating hour comparisons will be wrong for non-UTC operators. A Riverside CA plumber's 9 AM will be treated as 9 AM UTC (4 AM local).

### AUDIT-R1-004 · Important · Storefront Operations Manager falsely blocks at Operating Hours
**Step**: Operating Hours (step 5)  
**Observed**: Coworker panel message: "The status is **blocked**, as we cannot proceed with operations until we have organizational structure defined. Please tell me if you would like to list available departments."  
**Actual state**: The Operating Hours page works fine; hours were saved successfully without departments.  
**Impact**: Operator sees "blocked" in the coworker and may abandon the step thinking something is broken. The coworker context prompt is querying the org for departments and treating zero results as a blocker.

### AUDIT-R1-005 · Critical · Financial setup defaults to GBP for US business
**Step**: Storefront / Financial Setup (step 6)  
**Observed**: "Base currency: GBP – British Pound" pre-selected. `trades_construction` finance profile has `defaultCurrency: "GBP"`.  
**Expected**: Currency should default to USD when the org's locale is US-based (or at minimum fall back to USD as the global default, not GBP).  
**Impact**: Every plumber in North America starts with the wrong currency. A plumber who doesn't notice will issue quotes and invoices in pounds sterling.

### AUDIT-R1-006 · Important · Finance profile pattern incorrect for plumber
**Step**: Storefront / Financial Setup (step 6)  
**Observed**: Finance profile summary shows: Payment = **Recurring Agreement**, Recurring = **Required**, Invoices = **Prepared Not Prescribed**.  
**Expected**: Plumber billing pattern is per-job invoice or point-of-sale, not a mandatory recurring subscription agreement.  
**Impact**: Finance configuration implies plumbers bill clients on retainer/subscription. The `trades_construction` profile maps to `recurring-agreement` as primary pattern — this should be `ad-hoc-invoice` or `project-milestone`.

### AUDIT-R1-007 · Important · Build Studio step exposes technical CLI/API-key UI to non-technical operators
**Step**: Build Studio (step 8)  
**Observed**: Page heading "Connect a code-capable AI runner to start building." Options include "ChatGPT / OpenAI Codex – Subscription sign-in", "Claude – Subscription (CLI)", "OpenAI API key", "Anthropic API key", "Google Gemini API key". Note: "Currently connected: Docker Model Runner (local)" already shown.  
**Observed (coworker)**: Software Engineer coworker responded appropriately: "When you are ready to create your first feature, please return here!" — did not ask operator to do anything technical.  
**Expected**: The wizard step should either (a) skip Build Studio entirely for non-platform archetypes, or (b) show a single "Your platform is connected and ready" confirmation, not provider-selection UI.  
**Impact**: A non-technical plumber sees provider selection, CLI references, and API key options with no context. The coworker guard helps but does not fix the underlying UI.

### AUDIT-R1-008 · Minor · Workspace standard view not auto-activated for plumber archetype
**Step**: Workspace (step 9)  
**Observed**: Banner: "Workspace home is using the standard view. Review business setup to activate a worker home tailored to this business."  
**Expected**: Completing the wizard with a specific archetype (plumber) should activate the archetype-specific workspace home without an additional "Review business setup" step.  
**Impact**: Wizard completes but operator lands in a generic workspace rather than a plumber-tailored one.

---

## Phase K7 — Pre-Wizard Redirect

### AUDIT-R1-K7-001 · Important · Post org-creation redirect goes to AI Providers, not wizard
**Step**: After org creation at `/setup`  
**Observed**: Completing "Create your organisation" redirected to `/platform/ai/providers` — the AI provider configuration screen.  
**Expected**: First-time org creation should redirect to the setup wizard step 1 (Branding) or to a "welcome, let's get started" screen.  
**Impact**: New operator lands on a technical AI provider screen before any business context is established. Confusing for non-technical users who don't know what an "AI provider" is.

---

## Phase A Positives

- **Brand extraction confidence UI**: Clear 0% confidence signal with gap reasoning — good transparency.
- **COO coworker vocabulary**: At Workspace step, COO used plumbing-specific language ("incoming job requests and repair tickets in your backlog, coordinate with your team, monitor the progress of every service call") without prompting.
- **Archetype search**: Typing "plumber" in the portal template search immediately filtered to "Plumber" under TRADES MAINTENANCE — fast and accurate.
- **Portal template preview**: Showed plumbing-appropriate sections (Hero, Services, About Us, Get a Quote) and items (Emergency Call-Out, Drain Unblocking, Leak Detection & Repair) before committing.
- **System Admin coworker (step 7)**: Asked about "quality over speed vs rapid iteration" — contextually appropriate for a service reliability business.

---

---

## Phase P — Public Portal

### AUDIT-R1-P-001 · Minor · Setup URL slug mismatch
**Observed**: Financial setup step showed "Your portal will be at /s/store" but the actual published URL is `/s/riverside-plumbing-solutions` (auto-generated from company name).  
**Impact**: Operator given incorrect URL to share with customers. The "View Live" link uses the correct company-name slug, but the earlier on-screen hint is wrong.

### AUDIT-R1-P-002 · Minor · Brand color not applied to hero background
**Observed**: Brand extraction returned `#000000` as primary color. Hero background renders as a purple gradient from the template default, not the extracted/configured brand color.  
**Impact**: Brand customisation step has no visible effect on the hero — operators who set a brand color won't see it reflected.

### AUDIT-R1-P-003 · Info · UK-centric service items in plumber template
**Observed**: Pre-loaded items include "Boiler Service" and "Boiler Repair" — boiler central heating is a UK/European fixture, not common in Riverside, CA (US).  
**Impact**: US operators using the Plumber template must delete/rename these items. The template has a UK bias.

---

## Phase B — Public Portal CTA

### AUDIT-R1-B-001 · Important · No urgency field on Emergency Call-Out enquiry form
**Observed**: The "Emergency Call-Out" enquiry form has: name (required), email (required), phone (optional), message. No urgency/priority selector.  
**Expected**: For a service tagged "Emergency", a "When do you need this?" or urgency radio (Emergency — right now / Urgent — today / Scheduled) should be present.  
**Impact**: Plumber cannot distinguish an emergency burst pipe (needs dispatch in minutes) from a routine service booking from the same form.

### AUDIT-R1-B-002 · Important · No address/location field on enquiry form
**Observed**: The enquiry form does not ask for the customer's address or service location.  
**Expected**: For a trade business that dispatches to customer sites, address is a required field.  
**Impact**: Plumber must follow up to get the job address before they can dispatch — adds friction to every booking.

### AUDIT-R1-B-003 · Minor · Generic confirmation copy for emergency service
**Observed**: Post-submission confirmation: "We'll be in touch shortly."  
**Expected**: For an emergency call-out: estimated callback time, emergency phone number, or instruction to call directly.  
**Impact**: Customer with a burst pipe doesn't know if someone will call them in 2 minutes or 2 days.

### AUDIT-R1-B-004 · Minor · Broken/missing image on enquiry confirmation page
**Observed**: Confirmation page shows a small broken image placeholder above "Enquiry received!" heading.  
**Impact**: Visual polish issue — unprofessional on an otherwise clean confirmation page.

### AUDIT-R1-B-005 · Pass · End-to-end enquiry submission works
**Observed**: Submitted name, email, message → received confirmation "INQ-XL2LVBEM" → appeared in admin Job Requests within seconds.  
**Verdict**: Core flow passes.

---

## Phase F — Inbox & Operations

### AUDIT-R1-F-001 · Critical · DPF platform meta-language in operator inbox
**Observed**: Job Requests tab header: "Customer-zero inquiry intake is wired to product backlog triage. Use **Send to product backlog** to capture DPF sales or product signals as triaging work for Digital Product Factory."  
Each inquiry is badged "Customer-zero signal".  
**Impact**: A plumber sees "Digital Product Factory", "product backlog triage", and "Customer-zero signal" — platform self-referential terminology with no meaning to a trades operator. This must be filtered by archetype or the plumber template must suppress platform-mode labels.

### AUDIT-R1-F-002 · Important · No detail view or reply action for job requests
**Observed**: Clicking an inquiry row or reference number does nothing. Only available action is "Send to product backlog".  
**Expected**: Clicking an inquiry should open a detail panel showing full contact info, allowing the operator to: mark as read, mark as responded, add a note, or initiate a quote.  
**Impact**: Operator cannot manage incoming jobs from this view — no triage workflow exists beyond forwarding to the product backlog.

### AUDIT-R1-F-003 · Important · Inquiry does not auto-create a customer account
**Observed**: After receiving enquiry from Sandra Hooper (email + name captured), the Customer section still shows "0 accounts" and "No accounts registered yet."  
**Expected**: An enquiry with a name and email should create or suggest a customer account.  
**Impact**: Operator must manually create customer records from data they already entered in the portal.

---

## Phase G — Financial Tally

### AUDIT-R1-G-001 · Important · Currency symbol inconsistent across sections
**Observed**: Finance section (Overview) correctly shows `$0.00` (USD). Customer section (Pipeline) shows `£0 open` (GBP).  
**Root cause**: The Customer CRM pipeline may have a hardcoded or separately-stored currency preference not updated when org-level currency was set to USD.  
**Impact**: Mixed currency symbols visible to operator in the same session.

### AUDIT-R1-G-002 · Pass · Finance overview configured correctly
**Observed**: Finance Configuration shows "Configured: Yes", Outstanding $0.00, Paid this month $0.00. Finance Specialist coworker present. USD applied.  
**Verdict**: Finance setup flow completed end-to-end.

---

## Phase K — Operator Day-to-Day Experience

### AUDIT-R1-K-001 · Important · New customer enquiry not surfaced in "Needs Attention"
**Observed**: After a customer submitted an enquiry, the Workspace home "Needs Attention" section still shows "Nothing needs your attention right now." Customer Accounts = 0, Open Work = 0.  
**Expected**: A new unread enquiry from a customer should surface as an urgent attention item.  
**Impact**: Plumber won't know they have a new customer enquiry unless they actively navigate to the Portal → Job Requests tab.

### AUDIT-R1-K-002 · Minor · CRM vocabulary not archetype-adapted
**Observed**: Customer section uses: Accounts, Engagements, Pipeline, Quotes, Orders, Funnel, Marketing.  
**Expected for plumber**: Customers, Jobs, Estimates, Invoices, Job Pipeline, (no Funnel/Marketing).  
**Impact**: B2B SaaS vocabulary creates cognitive dissonance for a trades operator.

### AUDIT-R1-K-003 · Pass · COO coworker uses plumbing vocabulary
**Observed**: At workspace completion, COO said: "this workspace is where you'll manage incoming job requests and repair tickets in your backlog, coordinate with your team, and monitor the progress of every service call."  
**Verdict**: Coworker vocabulary adaptation working correctly.

### AUDIT-R1-K-004 · Pass · Appropriate coworkers surface per section
**Observed**: Storefront → Storefront Operations Manager; Platform Dev → System Admin; Build Studio → Software Engineer; Workspace → COO; Customer → Customer Success Manager; Finance → Finance Specialist.  
**Verdict**: Coworker routing by section is correct and consistent.

---

## Summary — Run 1 (Plumber / Riverside Plumbing Solutions)

| Severity | Count | IDs |
|---|---|---|
| Critical | 2 | R1-005, R1-F-001 |
| Important | 8 | R1-003, R1-004, R1-006, R1-007, R1-K7-001, R1-B-001, R1-B-002, R1-F-002, R1-F-003, R1-G-001, R1-K-001 |
| Minor | 5 | R1-001, R1-003, R1-P-001, R1-P-002, R1-B-003, R1-B-004, R1-K-002 |
| Pass / Positive | 5 | R1-002, R1-B-005, R1-G-002, R1-K-003, R1-K-004 |

**Top 3 fix targets for plumber archetype:**
1. **GBP default currency** (R1-005) — every US plumber starts with the wrong currency; one-line profile fix
2. **DPF meta-language in job requests inbox** (R1-F-001) — confuses non-technical operators; must be suppressed for non-platform archetypes
3. **New enquiry invisible on workspace home** (R1-K-001) — operators miss incoming customer work; needs a notification/attention feed hook on inquiry creation
