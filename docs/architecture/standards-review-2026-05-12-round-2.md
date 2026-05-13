# TAK + GAID Standards Review — Round 2 — 2026-05-12

Round 1 review: [standards-review-2026-05-12.md](standards-review-2026-05-12.md).

This round re-reads the updated source markdown with a critical eye, audits which round-1 items were resolved, and looks for new issues a second pass surfaces.

Verdict: substantially stronger. Virtually every round-1 MUST-FIX and SHOULD-FIX has been addressed. Companion `tak-conformance-tests.md`, `gaid-conformance-tests.md`, and `agent-standards-threat-model.md` now exist and are internally coherent. The remaining items below are smaller — none block publishing for review, but several are worth fixing before external circulation.

---

## 1. Round-1 Items Resolved

For audit traceability:

**TAK references** — ISO/IEC 42001 URL fixed (`/81230.html`); MCP bumped to 2025-11-25; added MCP Authorization, LF AAIF, AGENTS.md, RFC 9728, RFC 9635, RFC 9767, RFC 9449, OpenAI Preparedness, Anthropic RSP, Google DeepMind FSF, CoSAI Agentic IAM, OWASP Agentic Top 10, in-toto, Sigstore, CSA MAESTRO, MITRE ATLAS, IMDA, ISO/IEC 12792:2025, ISO/IEC DIS 42102.

**GAID references** — A2A blog URL changed to `/en/`; SCITT pinned to `-22`; SLSA bumped to v1.2; Experimental note added for RFC 9162; added OpenID AIIM CG, AIIM whitepaper, NIST RFI response, W3C Agent Identity Registry Protocol CG, CoSAI, MCP Authorization, AGENTS.md/LF AAIF, RFC 9728, RFC 9635, RFC 9767, RFC 9449, in-toto, Sigstore, C2PA v2.2 + Implementation Guidance, AP2, OWASP Agentic Top 10, CSA MAESTRO, MITRE ATLAS, EU GPAI CoP, GDPR, IMDA, ISO/IEC 27701:2025, ISO/IEC 12792:2025, ISO/IEC DIS 42102.

**TAK pseudocode (§8.9)** — idempotency check added; failed-failover `lastResult` bug fixed; `tak.provider.backpressure` event emitted.

**GAID pseudocode (Annex D)** — error paths added; trust anchor lookup added; operating-profile fingerprint check added; status freshness `max_status_age` added; resolution-profile branching added. **New Annex E** added for receipt verification — addresses round-1 §3 SHOULD-FIX 4.

**Feasibility** — §7.8 lists concrete attestation substrates (TPM/TDX/SEV-SNP/DSSE/in-toto/Sigstore/SCITT); §8.5 acknowledges predictive backpressure is inferred; §10.2 reworded to runtime-testable behavior; §16.1 fabrication-resistance methodology requirement added; GAID §6.2 IANA registration plan stated; GAID §6.4 private-namespace discriminator MUST added; GAID §7.4 "Minimum Viable Private AIDoc" added; GAID §6.16 Bootstrap and Recognition Path added; GAID §10.2 `target_ref` typed.

**Structural** — versioning + lifecycle disposition statements added to both (§2.1); threat-model alignment added (TAK §15.5, GAID §12); cross-principal memory leakage MUST NOT added (TAK §12.2); evaluation cadence MUST added (TAK §16.4); §8.4 SHOULD → MUST upgrade; verification-key rotation added to material-change list (GAID §8.8); `monitor`/`report` authorization classes added; receipt-id disclosure added (GAID §11.10); AIDoc skeleton now includes `evidence_refs` and `operating_profile_fingerprint`.

**Companion docs created** — `tak-conformance-tests.md` (15 assertions), `gaid-conformance-tests.md` (15 assertions), `agent-standards-threat-model.md` (assets, actors, boundaries, abuse paths, control-family mapping). All coherent and well-shaped.

---

## 2. Items Where the Fix Is Incomplete

### 2.1 TAK pseudocode — idempotency is dangling **(SHOULD-FIX)**

The new opening block reads from a completed-inference cache by `request.idempotency_key`:

```text
prior = findCompletedInferenceByIdempotencyKey(request.idempotency_key)
if prior is not null:
  emit("tak.inference.reused", request, prior)
  return prior
```

…but the success paths never write back. After `result.success` is true, `executeWithProvider` results are returned without a `recordCompletedInference(request.idempotency_key, result)` call. A second request with the same key will not find a prior. The check is decorative as written.

**Fix:** add `recordCompletedInference(request.idempotency_key, result)` immediately before each `emit("tak.inference.completed", ...)` branch, or wrap `tryPrimaryExecution` / `executeWithProvider` in a memoizing helper. Either fixes the duplicate-prevention claim that §8.7 requires.

A related smaller issue: the check only catches *completed* requests. An *in-flight* identical request is not coalesced. For queue replay during recovery this is the actual high-risk path. Either explicitly state that in-flight coalescing is an implementation choice, or add a `findInflight(...)` branch.

### 2.2 TAK §8.9 — request envelope still not documented **(SHOULD-FIX)**

The pseudocode now references `request.agent_id`, `request.task_class`, `request.sensitivity_class`, and `request.idempotency_key` — but the standard never defines the minimum request shape. A reader implementing against this can't tell which fields are required. A one-paragraph "the minimum runtime request envelope includes…" precondition block above the code, or a JSON schema sketch, would close this.

### 2.3 TAK §8.9 — bounded-queue rejection path still undefined **(CONSIDER)**

§8.7 mandates a bounded queue. The pseudocode calls `queue.defer(...)` and `queue.admit(...)` with no failure branch. A queue at capacity will silently fail. Round 1 flagged this; not addressed. Either show the escalate-on-full path, or note in prose that bounded-queue rejection is treated as an escalation incident.

### 2.4 GAID §6.10 — five architectures listed, one diagram **(CONSIDER)**

Round 1 noted Figure 2 depicts only the hybrid model while §6.10 lists five. The caption was updated to "Preferred hybrid `GAID` verification composes…" which makes the figure scope honest. Fine as a minimum, but the option matrix is still not visualized. Sibling figure or table would help.

### 2.5 GAID Annex E — receipt signature verification against *current* AIDoc material **(MUST-FIX)**

```text
if not verifyReceiptSignature(receipt, aidoc.verification_material):
  return failure("invalid_receipt_signature")
```

This will reject historically valid receipts after a routine key rotation, because `aidoc.verification_material` is current, not historical. Real systems verify against the key/cert that was current at the time the receipt was signed, via:

- a `signing_key_ref` / `key_id` field on the receipt
- a transparency log lookup or historical key material store
- a per-receipt embedded certificate chain

**Fix two things:**
1. **Add `signing_key_ref` (or `key_id`) to the §10.2 receipt fields table** — it's currently missing entirely. Without it, historical verification is impossible by design.
2. **Update Annex E** to resolve the historical signing material via `signing_key_ref` and the transparency log rather than the current `aidoc.verification_material`.

This is the highest-impact remaining issue. As written, the receipt model encodes a silent failure mode: tamper-evident receipts that become unverifiable on routine key rotation.

### 2.6 GAID §11.5 A2A — signed agent cards, not just `securitySchemes` **(SHOULD-FIX)**

Updated text says "where `A2A` agent cards advertise `securitySchemes` or authenticated extended cards". A2A v1.2 specifically introduced **signed agent cards** as a discrete feature beyond `securitySchemes`. Reword to: "where `A2A` agent cards are signed or carry authenticated extended-card material, the published `GAID` projection `SHOULD` remain consistent across both public and authenticated card variants, and the canonical `GAID` `SHOULD` be bound to the agent card signature where signing is available."

### 2.7 TAK §3.1 — A2A claim without A2A reference **(SHOULD-FIX)**

§3.1 says: "`MCP` and `A2A` are protocol-profile targets, not substitutes for runtime governance." But A2A is not in the TAK §3 reference table. GAID references it; TAK does not. Either add the A2A specification row to TAK §3, or drop the A2A mention from §3.1. Current state asserts a profiling intent against an uncited standard.

---

## 3. New Findings (Not in Round 1)

### 3.1 Right-to-erasure tension for receipts **(SHOULD-FIX)**

GAID §10.5 references GDPR and ISO/IEC 27701 — good. But it does not address the well-known tension between tamper-evident / transparency-logged receipts and **GDPR Article 17 right to erasure**. A receipt containing personal data that is published to an append-only log conflicts with the data-subject's erasure right.

Add a paragraph:

> Implementations that publish receipts to long-lived or append-only transparency logs `SHOULD` store identifiable human content out-of-band and reference it from the receipt by digest, pseudonymous reference, or sealed-evidence pointer, so that erasure obligations can be honored without invalidating receipt integrity. Where erasure would invalidate a receipt that remains operationally needed for accountability, the implementation `SHOULD` document its lawful basis under the applicable privacy regime.

This is a recognized pattern (SCITT, IETF transparency, content-credential systems all face it) and addressing it strengthens the privacy story considerably.

### 3.2 RFC 9334 / RATS architecture missing **(SHOULD-FIX)**

TAK §7.8 lists "hardware-rooted measurements such as `TPM`, `TDX`, or `SEV-SNP`, as well as software evidence stacks such as `DSSE`, `in-toto`, `Sigstore`, or `SCITT`." The umbrella architecture for remote attestation is **IETF RFC 9334 (RATS Architecture)** — the standard that gives `attester`, `verifier`, `relying party`, and `evidence` their normative meanings, and RFC 9711 (EAT — Entity Attestation Token) is the envelope work.

Add to TAK §3:

| [RFC 9334 RATS Architecture](https://www.rfc-editor.org/rfc/rfc9334) | Remote attestation architecture and role vocabulary for verifier-relying-party flows |

Without it the §7.8 attestation list reads as a parts-bin rather than a layered standard.

### 3.3 TAK §10.3 hidden-instruction governance should require a content hash **(SHOULD-FIX)**

§10.3 requires recording "effective version". Recording an **effective version hash** makes immutability verifiable rather than merely declared. Strengthen to:

> - effective version, including a content hash or equivalent integrity reference

Otherwise a malicious actor could rename the version label while changing content.

### 3.4 TAK §13.2 missing GAID receipt linkage **(SHOULD-FIX)**

§13.2 evidence fields list everything except a `receipt_ref` field. Annex A explicitly says GAID provides receipts for non-repudiation. The runtime audit record should carry the GAID receipt identifier where one was emitted:

> - linked `GAID` `receipt_id` reference where the runtime emitted or relied on one

Without this, the TAK ↔ GAID coupling claimed in Annex A is undocumented at the field level.

### 3.5 TAK §16.4 evaluation cadence has no periodic floor **(CONSIDER)**

The four triggers (material change, model/provider substitution, instruction/tool change, new exposure state) cover all *change-driven* re-evaluation. A system that doesn't change never re-evaluates. The OpenAI Preparedness / Anthropic RSP analogs typically also specify a periodic floor (annual or biannual).

Recommend: "and at minimum periodically for production systems, with `TAK-Managed` SHOULD re-evaluating at least annually and `TAK-Assured` SHOULD re-evaluating at least semi-annually."

### 3.6 TAK §8.1 — conflict resolution between AGENTS.md and kernel metadata **(SHOULD-FIX)**

§8.1 now allows AGENTS.md as a complementary surface but doesn't resolve what happens on conflict. Add:

> Where `AGENTS.md` or equivalent declarative content conflicts with kernel-governed metadata, the kernel-governed metadata `MUST` prevail and the conflict `SHOULD` be surfaced to operators.

Otherwise a `AGENTS.md` shipped in a repository could shadow runtime policy.

### 3.7 GAID §6.16 Bootstrap and Recognition Path — trust-list publishers themselves **(CONSIDER)**

§6.16 lets organizations publish "mutual-recognition trust lists." But a malicious actor could publish a malicious trust list claiming legitimacy. Add a sentence about publisher attestation: "Trust-list publishers `SHOULD` be themselves authenticated through out-of-band means such as domain-controlled certificates, recognized sector alliances, or accredited identity material, so a malicious trust list cannot promote itself as legitimate."

This mirrors how the WebPKI root-program governance works in practice.

### 3.8 GAID §10.2 — `result_hash` algorithm not specified **(CONSIDER)**

The field exists but no content-addressing scheme is specified. Recommend allowing `<algorithm>:<digest>` (e.g., `sha256:...`, multi-algorithm support via [multihash](https://github.com/multiformats/multihash)) and stating the baseline is SHA-256.

### 3.9 Both — confidential AI / TEE attestation envelope not named **(CONSIDER)**

TAK §7.8 names the substrates but not the standard envelopes. The Confidential Computing Consortium (CCC) and **RFC 9711 (EAT — Entity Attestation Token)** define attestation token formats. If §7.8 is going to enumerate substrates, name an envelope (EAT or DSSE) so verifiers can interop. Otherwise each implementation invents an envelope.

### 3.10 Companion threat model — missing concrete mappings **(CONSIDER)**

`agent-standards-threat-model.md` lists abuse paths but does not map them to specific OWASP / MAESTRO / ATLAS IDs. The companion doc would be more useful as a starter artifact if each abuse path had at least one external identifier:

> - prompt injection that attempts to override immutable or governed instructions → **OWASP LLM01:2025 Prompt Injection**, **ATLAS AML.T0051**

Lighter than a full crosswalk but enough that implementers know where to start.

### 3.11 Companion conformance tests — missing version + change-control mention **(CONSIDER)**

`tak-conformance-tests.md` and `gaid-conformance-tests.md` have no version/date header and no change-control statement. For documents that will be cited by implementers as their compliance basis, those headers matter. Add a one-line version + last-revised header to each.

---

## 4. Items Specifically Worth Flagging Before External Circulation

If both documents are about to be circulated to external reviewers (NIST, AIIM CG, W3C, CoSAI, AAIF), the items most likely to draw immediate critique are:

1. **§2.5** — historical-receipt signature verification (real bug; auditors will spot it immediately)
2. **§2.1** — TAK idempotency is dangling (any reviewer reading the pseudocode will notice)
3. **§3.1** — right-to-erasure tension (EU reviewers will raise this within 24 hours)
4. **§3.4** — TAK ↔ GAID receipt linkage at the field level (standards-coupling reviewers will ask "where is the join key?")
5. **§3.2** — RATS architecture / RFC 9334 missing (IETF reviewers will note the absence immediately)

These five items, plus the §2.6 A2A signed-card phrasing fix, would be a clean second-pass batch and would substantially harden the documents.

---

## 5. Items Not Found Wrong

Acknowledging the strengths so the next reviewer sees what's working:

- The TAK / GAID division of labor is clear and consistently maintained across all section cross-references.
- The new GAID §6.16 Bootstrap and Recognition Path is a *materially better* answer to round-1's "no transition path" criticism than I expected. The framing of "interoperable recognition first, accreditation convergence later" is historically accurate and politically realistic.
- The companion `tak-conformance-tests.md` and `gaid-conformance-tests.md` rubrics are well-scoped (15 assertions each, one per major control). Adding evidence-publication guidance is exactly right.
- The new GAID §7.4 Minimum Viable Private AIDoc is the right adoption shape — implementers can start with 9 fields.
- Stating the lifecycle disposition (§2.1: "publication as an open industry specification with liaison into NIST, AAIF, OASIS/CoSAI, IETF") puts the documents on a credible standards trajectory rather than leaving them as internal white papers.
- The treatment of identity vs validation continuity (TAK §7.7, GAID §6.8/§6.9) remains the family's strongest distinct contribution.
