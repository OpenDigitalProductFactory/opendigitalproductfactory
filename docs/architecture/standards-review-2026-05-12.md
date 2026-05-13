# TAK + GAID Standards Review — 2026-05-12

Reviewer: Claude (Opus 4.7), against TAK and GAID source markdown.
Scope: external-reference accuracy, adjacent-standards positioning, pseudocode correctness, feasibility, diagram alignment, structural gaps.

This review treats both documents as standards drafts in active development. Items are tagged **MUST-FIX** (factually wrong or normatively unsafe), **SHOULD-FIX** (substantive gap or weak positioning), **CONSIDER** (improvement, not blocking).

---

## 1. Reference Accuracy — Required Citation Fixes

All ten TAK references and twenty-two GAID references were resolved. Findings:

### MUST-FIX

1. **TAK §3, row 1** — `https://www.iso.org/standard/42001` returns 403. ISO catalog numbers are not standard numbers. **Replace with `https://www.iso.org/standard/81230.html`** (the URL GAID §3 already uses correctly). Standardize across both documents.
2. **TAK §3, row 6** — MCP `2024-11-05` is superseded by `2025-11-25` (Tasks, server-side agent loops, parallel tool calls). **Update URL or add "current revision" footnote.** Cite both if historical reference is intended.
3. **GAID §3, row 13** — `https://developers.googleblog.com/es/a2a-a-new-era-of-agent-interoperability/` uses `/es/` (Spanish edition). **Replace with `/en/`** or unprefixed canonical path.
4. **GAID §3, row 20** — SCITT draft has advanced to **`draft-ietf-scitt-architecture-22`**, currently in AUTH48 (RFC publication imminent). **Pin to `-22` now** and replace with the RFC number when assigned. Title: "An Architecture for Trustworthy and Transparent Digital Supply Chains."
5. **GAID §3, row 21** — SLSA Provenance **v1.1 is Retired**; v1.2 is current. **Update URL to `https://slsa.dev/spec/v1.2/provenance`.**

### SHOULD-FIX

6. **GAID §3, row 19** — RFC 9162 is **Experimental**, not Standards Track. The relevance line should add "(Experimental status)" so readers don't infer normative weight greater than the IETF assigned it.
7. **GAID §3, row 22** — `packageurl.org / ECMA-427` claim is **correct** (purl was approved as ECMA-427 in Dec 2025). Consider also citing the ECMA spec URL (`https://ecma-tc54.github.io/ECMA-427/`) as the canonical normative source alongside packageurl.org.
8. **GAID §3** — Verifiable Credentials v2.0 is now a **W3C Recommendation (15 May 2025)**. Current URL resolves correctly. Add the publication date to the relevance text so the maturity is visible.

---

## 2. Missing Citations — Adjacent / Competing / Complementary Work

This is the single largest gap. Between October 2025 and May 2026 the AI-agent-governance landscape produced an order of magnitude more directly-relevant work product than the standards currently cite. Both documents will be perceived as out-of-date on first read by anyone tracking this space.

### MUST-CITE (live work products with formal venue and URL)

**Identity / authorization:**

- **OpenID Foundation AIIM Community Group** — "Identity Management for Agentic AI" (Oct 2025) + March 2026 NIST RFI response. This is the canonical OIDF venue. GAID **should be positioned as the registry/passport layer complementary to OIDF transaction-token work**, not as a competitor.
- **W3C Agent Identity Registry Protocol Community Group** — Call for Participation issued 2026-04-24. This is the W3C-side venue for GAID's exact problem space. **GAID §6 should explicitly mention liaison intent** or risk being viewed as redundant with W3C work.
- **OASIS CoSAI (Coalition for Secure AI), "Agentic Identity and Access Management"** — Published at RSAC 2026 (May 2026). **TAK/GAID should map controls to CoSAI's framework** rather than reinvent terminology.
- **Linux Foundation Agentic AI Foundation (AAIF)** — Now hosts MCP, A2A, goose, and AGENTS.md as donated projects. **TAK should profile AGENTS.md as a declarative tool-/skill-governance artifact** under §8.1 (tool definitions).

**Protocols:**

- **MCP Authorization** (June 2025 OAuth 2.1 baseline + 2026 incremental-scope-consent + role-based annotations). Pulls in **RFC 8707 Resource Indicators** and **RFC 9728 Protected Resource Metadata**. TAK §8 should be expressed as a **profile of MCP authorization**, not a parallel scheme.
- **A2A v1.2** — Declarative auth schemes in agent cards (OAuth 2.0, OIDC, mTLS, API keys); signed agent cards. **GAID §11.5 already mentions A2A but pre-dates v1.2** — update.
- **AP2 (Agent Payments Protocol, Google, v0.1)** — Intent/Cart/Payment Mandates as Verifiable Credentials. Prior art for VC-based action authorization; GAID §10 receipt model overlaps. **Cite as parallel pattern** in the payments domain.
- **GNAP (RFC 9635)** + **RFC 9767** — Negotiated/evolving authorization for cases where static OAuth scopes are insufficient. **TAK §8 should cite GNAP** as the protocol track for negotiated delegated capability.

**Receipts / attestation:**

- **DPoP (RFC 9449)** — Sender-constrained tokens. **GAID §10.4 should reference DPoP key-binding** as the proof-of-possession substrate for agent action receipts.
- **C2PA Content Credentials v2.2 (May 2025) / v2.3 draft** — Cryptographic manifests with `digitalSourceType` for AI/ML actions; **mandated by EU AI Act effective Aug 2026**. Required citation for any GAID receipt covering agent-produced content artifacts.
- **in-toto + Sigstore (cosign, Fulcio keyless, Rekor, DSSE)** — Operational signing substrate for receipts today. **GAID §10.4 currently lists `RFC 9421`, `JOSE`, `COSE`** — add DSSE/in-toto/Sigstore so implementers see a working stack, not a list of envelope formats.

**Threat / control catalogs:**

- **OWASP Top 10 for Agentic Applications 2026** (Dec 2025) + **Agentic AI Threats and Mitigations**. **TAK §15 and §16 should map controls to OWASP risk IDs.** The current OWASP citation is too generic.
- **CSA MAESTRO** (7-layer agentic threat model; v2 in 2026). **TAK §15 should position MAESTRO as the complementary threat model** to TAK's controls.
- **MITRE ATLAS v5.4** (monthly cadence; agent-specific techniques such as "Publish Poisoned AI Agent Tool", "Escape to Host"). **TAK §16 should require red-team coverage of relevant ATLAS techniques** rather than leaving "red team" as a generic verb.

**National / regulatory frameworks:**

- **EU AI Act GPAI Code of Practice** — Final published; enforcement 2 Aug 2026. **Both documents should declare alignment / non-conflict** posture.
- **Singapore IMDA Model AI Governance Framework for Agentic AI** (Jan 2026, announced at WEF) — first national agentic-governance framework. **Cite as national reference.**
- **ISO/IEC 12792:2025** (transparency taxonomy), **ISO/IEC 42102** (AI methods), **ISO/IEC 42109** (human-machine teaming, CD ballot). Position alongside the existing ISO/IEC 42001 citation as the broader SC42 ecosystem.

### SHOULD-CITE (scope-delineation citations)

- **Anthropic RSP v3.1 / OpenAI Preparedness / Google DeepMind FSF** — These govern *model training/deployment*; TAK/GAID govern *runtime agent operation*. Cite to delineate scope so readers do not assume overlap.
- **IEEE P3119** (AI procurement, 5-process). Cite for procurement/lifecycle integration.

---

## 3. Pseudocode Audit

### TAK §8.9 `processInferenceRequest`

**MUST-FIX**

1. **Idempotency / dedup absent.** §8.7 normatively requires "queue resumption does not silently duplicate already-completed actions." The pseudocode shows no idempotency key, no result-cache lookup, no compare-and-set. The strongest claim in the section is unsupported by the illustrative algorithm.
2. **Failed-failover fallthrough bug.** When `retry.success == false`, control falls through to `if result.retry_after_window is not null` — but `result` is the *primary's* result, not `retry`. A failed failover therefore checks the wrong retry window. Either compute a unified `lastResult` or branch on `retry` explicitly.
3. **`tak.provider.backpressure` event is shown in §8.10 but never emitted in the pseudocode.** Gap between event schema and reference behavior. Emit it when `budget.canAdmit` returns false.

**SHOULD-FIX**

4. **HITL tier never consulted.** The function processes inference but does not branch on `request.hitl_tier`. Either make explicit that this is downstream of tool gating (with a `// precondition: tier-gated above` comment) or thread the tier in.
5. **GAID receipt emission missing.** §13 audit requirements and Annex A coupling to GAID mean `tak.inference.completed` should also produce or reference a receipt with provider + model attribution. Show the linkage explicitly.
6. **TOCTOU between `canAdmit` and `admit`.** Real implementations need atomic check-and-admit. Add a one-line note in the prose preceding the code, or rewrite as `budget.tryAdmit(request)`.
7. **Bounded-queue failure path undefined.** §8.7 mandates bounded queues; `queue.defer` could fail because the queue is full. Show the bounded-queue-rejection path (typically escalate or reject).
8. **Cancellation/expiry not modeled.** §8.7 requires "support explicit expiry, cancellation, or operator intervention." Show at least one branch.
9. **Request shape never defined.** The pseudocode reads `request.agent_id`, `request.task_class`, `request.sensitivity_class`, `request.hitl_tier` (implied). Add a short JSON schema sketch above the pseudocode so readers know the minimum request envelope.

**CONSIDER**

10. The pseudocode title implies inference, but the section heading is "Queue and Provider Pseudocode" — many readers will assume tool execution follows the same path. Add a **second short pseudocode block for `processToolInvocation`** showing execution-mode gating, idempotency, and receipt emission. The two together demonstrate the full §8 control surface.

### GAID Annex D `verifyPublicGAID`

**MUST-FIX**

1. **No error paths.** Every `verifyX(...)` call could fail, but the return is hardcoded `subject_identity_valid: true, issuer_valid: true, status_valid: true`. The pseudocode currently asserts success regardless of evidence. Rewrite each step as `if not verifyX(...): return failure(reason)`.
2. **Trust-anchor lookup absent.** §6.10 lists five architecture options; the verifier needs an explicit "resolve issuer trust list / federation root" step before `verifyIssuerStatus`. Without it the verifier cannot distinguish a malicious issuer from a legitimate one.

**SHOULD-FIX**

3. **Profile fingerprint check absent.** §7.5 requires verifiers to distinguish "same subject" from "same validated operating state." Add `verifyOperatingProfileContinuity(aidoc.operating_profile_fingerprint, expected_fingerprint)`.
4. **Receipt-verification pseudocode missing.** §10 normatively defines receipts but Annex D only verifies identity. Add a sibling `verifyReceipt(receipt, aidoc)` sketch covering signature, chain-of-custody parent link, trace context, and freshness.
5. **Status-freshness policy undefined.** Real verifiers cache. `verifyCurrentStatus` should take a `max_age` parameter (or the prose should say so).
6. **DID/VC branch absent.** §6.15 permits a decentralized portability profile; the pseudocode is implicitly HTTPS-issuer. Either generalize `resolveAIDoc(gaid)` or document the two resolution paths.

---

## 4. Feasibility Issues

### TAK

1. **§7.8 "stronger protected attestation material" is unspecified.** What technology? TPM, AMD SEV-SNP, Intel TDX, Sigstore signing, hardware-rooted enclaves, software DSSE? Without a profile, "MUST support" is not actionable. Recommendation: add an informative annex listing acceptable attestation substrates (with SCITT/in-toto/Sigstore as the operational baseline) and let conformance profiles require one of them.

2. **§8.5 "predictive backpressure"** presupposes signals providers don't always emit. In practice, predictive state is *inferred* from prior 429s, `Retry-After`, token-usage headers, and contract knowledge. Add a sentence acknowledging that predictive signals are best-effort and that compliant implementations may rely on observed-rate inference.

3. **§10.2 "user cannot override [immutable directive] by prompt alone"** is a behavioral claim about the model, not a runtime guarantee. Reword to "the runtime MUST present the directive unchanged on every model call AND MUST detect/record any output that contradicts an immutable directive." That is testable; the current wording is not.

4. **§16.1 "MUST evaluate ... fabrication resistance"** without specifying a benchmark or rate is unfalsifiable. Either cite a benchmark (TruthfulQA, HaluEval, MT-Bench-Hallucination, or a profile thereof) or state that implementations MUST publish their evaluation methodology and baseline rates.

### GAID

5. **§6.2 syntax `gaid:<scope>:<issuer-prefix>:<agent-local-id>`** collides conceptually with URN syntax (RFC 8141). Either profile as `urn:gaid:...` (and register the NID with IANA), or commit to URI scheme registration. Either way, IANA registration is normatively expected for new colon-delimited identifier families and should be acknowledged.

6. **§6.4 private namespace** does not require any element identifying the issuing installation. A `gaid:priv:contoso.internal:hr-agent` minted at one site collides with `gaid:priv:contoso.internal:hr-agent` minted at another site if the prefix is reused. **Mandate** that private issuer prefixes include a stable identifier (domain or UUID5) from day one, so later federation does not require renaming.

7. **§7.2 AIDoc has 26+ MUST/SHOULD fields.** The adoption burden is significant. Add a **"Minimum Viable AIDoc"** subsection showing only the MUST fields populated for a private-tier agent (5–7 fields). Move the rich example to Annex B (already partly there) and add the minimal one inline.

8. **§6.6/§6.13 accredited-issuer model and economic model.** Both presuppose a federation that does not yet exist. The standard acknowledges this in §6.14 but gives no transition path. Add a **§6.16 "Bootstrap and Recognition Path"** describing how an early ecosystem can operate via mutual-recognition trust lists (similar to how WebPKI bootstrapped via Mozilla/Microsoft/Apple root programs) without requiring a single root authority on day one.

9. **§10.2 `target_ref`** is not typed. Cross-system references will require a URI/URN/pURL/CloudEvents-subject decision. Specify or profile.

---

## 5. Diagram-vs-Text Alignment

### TAK

1. **Figure 2 (`11-neutral-trust-model`)** shows `M` (memory) feeding directly into `O` and `S` (agents), bypassing `K` (control plane). But §12.1 normatively requires that memory be governed by the kernel. **Reroute the memory edge through `K`** or add a parallel governance edge.
2. **Figure 3 (`08-directive-injection`)** is cited at §10.3 but the diagram name suggests flow, not immutability semantics. **Add an "immutable" badge or border** on the directive nodes so the visual matches the normative point.
3. **No threat-model diagram.** Section 15 lists threats in prose; a one-page attacker/asset diagram (insider, compromised provider, compromised tool, lateral agent, prompt-injected user) would significantly improve §15's authority. Reference MITRE ATLAS / CSA MAESTRO.

### GAID

4. **Figure 2 (`05-public-verification-architecture`)** depicts only one architecture (PRIV→MAP→PUB→AIDOC→LOG→VERIFIER). But §6.10 lists five architecture options. **Add a sibling figure showing the option matrix** (directory-first / domain-anchored PKI / federated trust-list / decentralized / hybrid) or label this figure as "preferred hybrid model" matching §6.11.
5. **No AIDoc structural diagram.** §7.2 is a 26-row table. Add an entity diagram showing `Subject → OperatingState[] → Badge[] → Evidence[]` and `Subject → Receipt[]` so the relationships in §6.9, §7, §8, and §10 are visualizable.
6. **No verifier-flow diagram.** Annex D pseudocode has no corresponding diagram. A simple swim-lane (Relying Party | Resolver | Issuer | Transparency Log) would help.

---

## 6. Structural Gaps

### Both documents

1. **No versioning policy for the standards themselves.** SemVer? IETF-style draft numbering? ISO revision cycle? State it. Suggested: SemVer-like `<major>.<minor>.<patch>` with normative-only-changes-in-major guarantee.
2. **No explicit threat model section.** §15 (TAK) and §12 (GAID) are security *considerations*; neither is a threat model. Recommend adding an informative annex enumerating assumed attackers, assumed assets, assumed trust boundaries, and out-of-scope threats — mapped to MITRE ATLAS, CSA MAESTRO, OWASP Top 10 Agentic.
3. **No conformance test rubric.** Both documents declare conformance profiles but neither provides a test rubric. Recommend a companion `tak-conformance-tests.md` and `gaid-conformance-tests.md` with one assertion per `MUST`. The existing `agent-standards-dpf-conformance.md` is an *implementation* assessment, not a normative test suite.
4. **No "MUST NOT" enumeration of anti-patterns.** Both documents have many MUST/SHOULD/MAY but few MUST NOT (TAK has 8; GAID has 6). Anti-patterns deserve more weight: silent badge reuse after material change (GAID), failover bypass of GAID scope (TAK already has this — good), fabricated completion claims (TAK has it — good), private GAID published as accredited (GAID has it — good), etc. Audit for missing MUST NOTs.
5. **No data-protection / privacy crosswalk.** Receipts are personal data under GDPR Recital 30 / Article 4 in many cases; AIDocs may reveal organizational structure. Add a privacy-impact subsection citing GDPR, the EU AI Act, and ISO/IEC 27701.
6. **No standards-lifecycle disposition.** State the intended forum and disposition: IETF Independent Submission? Industry consortium spec? OASIS Open Project? OpenID Foundation? Until this is stated readers will assume "internal whitepaper."

### TAK-specific

7. **§11 delegation lacks impersonation hardening.** A compromised orchestrator delegating with forged child identity is currently not addressed. Cross-reference GAID §10.3 parent-child receipts as the runtime enforcement substrate.
8. **§12 governed memory** lacks any treatment of cross-user memory leakage in shared agents. Add a normative item: "the runtime MUST NOT expose memory derived from one principal to another principal without explicit policy permission."
9. **§16 evaluation cadence undefined.** Every quarter? On material change? On model swap? On every release? Specify, even loosely.
10. **§8.4 default safety rule** uses SHOULD where MUST would be safer. "Then the runtime SHOULD default that tool to `proposal`" — given the criticality of the listed conditions (production state change, identity change, publish/deploy), MUST default to `proposal` with an explicit policy override.

### GAID-specific

11. **§8.7/§8.8 material-change list** does not include credential / key-material rotation. Add it — rotation is a routine event that triggers signature reverification.
12. **§9.2 authorization class vocabulary** lacks `monitor` (passive observation with alerting) and `report` (read + publish summary). Consider.
13. **§11.10 UI profile** should require disclosure of *receipt identifier* alongside agent identity for approvals, so human approvers can later reference what they approved.
14. **Annex B AIDoc skeleton** lacks `evidence_refs` at the top level (only nested in badge) and lacks `operating_profile_fingerprint` despite §7.2 listing both. Fix the example to match the schema.

---

## 7. Recommended Sequence

If only one batch of edits can land before the next review cycle:

1. **Reference fixes (§1)** — 30 minutes; pure correctness.
2. **Adjacent-standards citations (§2 MUST-CITE)** — 2 hours; the largest credibility delta.
3. **Pseudocode fixes (§3 MUST-FIX items)** — 1 hour; protects the standard from "the reference algorithm has a bug" criticism.
4. **Feasibility hardening (§4 items 1, 5, 6)** — 1 hour; protects against "this isn't implementable" criticism.
5. **Diagram fixes (§5 items 1, 4)** — 30 minutes for `.mmd` edits.
6. **Structural items 1, 3, 6** — declare versioning, conformance-test plan, and standards-lifecycle disposition.

Items 2 + 5 above need source URLs added to the references table; item 3 needs new pseudocode bodies which I have ready as patches if you want them applied.

---

## 8. Items Not Found Wrong

For symmetry, the following are correctly cited and well-specified:

- NIST AI RMF 1.0 URL and relevance
- NIST AI Agent Standards Initiative URL
- NCCoE Feb 2026 IPD URL and relevance
- W3C Trace Context, RFC 9421, RFC 4512, RFC 7643/7644, RFC 9162 (modulo Experimental note), DID v1.0, VC v2.0
- ECMA-427 / purl claim (the user's suspicion was incorrect — claim is right)
- The TAK conformance profile structure (Basic / Managed / Assured) is well-shaped and matches comparable standards (NIST AI RMF tiers, ISO/IEC 27001 control sets).
- The GAID staged-adoption model (§6.12) is realistic and matches DNS / ISBN / PKI precedent.
- The TAK/GAID division of labor (runtime vs identity) is clean and defensible.
- The treatment of identity continuity vs validation continuity (TAK §7.7, GAID §6.8/§6.9) is one of the strongest contributions of the family and is rare in adjacent work.
