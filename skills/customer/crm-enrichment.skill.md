---
name: crm-enrichment
description: "Enrich a thin prospect/account from public sources with citations — identity-gated, grounded-or-blank, propose-then-apply"
category: customer
assignTo: ["customer-advisor"]
capability: "operate_customer"
taskType: "conversation"
triggerPattern: "enrich|research (the|this) (company|account|prospect)|fill in|look up|thin|scant|find (their|the) website|who are they"
userInvocable: true
agentInvocable: true
allowedTools: [search_public_web, fetch_public_website, propose_crm_enrichment, apply_crm_enrichment, list_customer_accounts]
composesFrom: []
contextRequirements: []
riskBand: medium
enforces:
  - never-fabricate
  - evidence-before-diagnosis
  - structural-verification-is-not-functional
---

# Enrich a thin CRM record from public sources

A prospect/account (or contact) has thin detail and the user wants it strengthened from public
sources. Your job is to research responsibly, propose a cited diff, and let a human approve the
write — **never** guess, and **never** enrich the wrong company.

This flow is grounded-or-blank: a field you cannot verify from a cited source is left blank and
surfaced as a gap, not filled with a plausible value.

## Preconditions

- You need external web access enabled for this turn (the web toggle). If `search_public_web`
  and `fetch_public_website` are not available to you, say so plainly — do not improvise facts
  from memory. Enrichment without a live source is fabrication.
- Enrichment writes are governed: `propose_crm_enrichment` files a review task (no write);
  `apply_crm_enrichment` is the approved write. Follow that order.

## Steps

1. **Confirm the record and its gaps.** Identify the account in PAGE DATA or via
   `list_customer_accounts`. Note which fields are thin (website, industry, employee count,
   location, notes).

2. **Ask permission and confirm scope.** State plainly *which sources* (their website, general
   web search) and *which fields* you will research. Get an explicit yes before any external
   lookup. Respect the proactivity level: at "quiet" you offer nothing unless asked.

3. **Establish the identity anchor BEFORE harvesting anything.** This is the most important step
   — a same-named but different company is the classic way to poison a record.
   - Find the anchor: the company's **own domain** is the strongest key; if there is none, use
     **name + geography (city/region) + one corroborating fact** (a named owner, a phone area
     code, an industry).
   - Every source you then read must **agree on that anchor**. A page about a different
     "TeamLogic IT" in another city is not evidence about *this* prospect.
   - If you cannot confidently resolve the anchor, **stop and ask the human "is this the right
     company?"** with the candidates you found. Propose nothing.

4. **Run an accuracy-first source waterfall, stopping at the first confident match per field.**
   Order sources by reliability, not convenience:
   - **Firmographics** (industry, size, location, description): the company's **own website**
     first (`fetch_public_website`), then general web search (`search_public_web`) for
     registries / news / reputable directories.
   - Use `search_public_web` to *discover* the site and corroborate; use `fetch_public_website`
     to read the company's own pages.
   - Stop researching a field once you have one source-backed, anchor-agreeing value — do not
     pile on redundant lookups.

5. **Grounded-or-blank, with a citation per field.** For each field you fill, you must have the
   value *present in* a source you can cite (URL / search result). If the value is not entailed
   by a passage you actually read, leave it blank. Constrain `industry` to a sensible standard
   label. Treat masked/partial values (`g***@…`, "500+ employees") as evidence of a gap, **not**
   as the value — never materialize them.

6. **Respect the compliance bright line.** This protects the customer's trust and ours.
   - **Never scrape LinkedIn (or any site whose terms forbid it) directly.** A LinkedIn URL is
     an identifier you may record, not a page to harvest.
   - **Firmographic** data (from the company's own site, registries, news) is low-risk — fine to
     propose.
   - **Personal-contact** fields (a person's email, mobile) are high-risk: do not propose a
     personal email/phone from public scraping. If asked, explain that personal contact data
     needs a lawful basis and a suppression check, and leave it as a gap for the human.

7. **Propose the diff — do not write yet.** Call `propose_crm_enrichment` with the confirmed
   `scope` (sources + fields) and your `findings` (each: `field`, `value`, `source`,
   `sourceRef`, optional `confidence`). The tool drops anything masked/partial, computes the
   before→after diff, cites every field, files a steward review task, and returns the
   unverifiable fields as **gaps**.

8. **Show the human the diff and the gaps.** Present the proposed changes (old → new, with the
   source for each) and the confirm-what's-needed gaps. Ask for approval.

9. **Apply on approval.** On an explicit yes, call `apply_crm_enrichment` with the returned
   `taskId`. It writes the fields with provenance, records the scant→enriched diff on the account
   timeline, and resolves the review task. Confirm what landed and restate the remaining gaps.

10. **Note freshness.** Mention that enriched fields are "as of today" and can be re-verified
    later; firmographics drift slowly, contact data quickly.

## Guidelines

- Blank is a correct answer. A cited "not found" beats a confident guess every time.
- One anchor, many corroborators: never harvest a field from a source that doesn't agree on the
  identity anchor.
- Propose, then apply — two steps, with the human between them for anything consequential.
- If web access is off or a search returns nothing usable, say so and stop; do not fill from
  training-data priors.
- Keep the customer's data-trust front of mind: you are augmenting their record, not building a
  dossier — B2B, public, cited, and reversible.
