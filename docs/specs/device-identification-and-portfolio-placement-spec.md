# Device Identification & Portfolio Placement — Spec

**Status:** Draft (spec-first)
**Owner:** Platform / Estate (Portfolio Analyst + Estate Specialist coworkers)
**Date:** 2026-06-04; updated 2026-07-24 for triage-to-investigation last-mile wiring and process-loop correction
**Surface:** discovery signal capture, fingerprinting, DPPM portfolio placement, hive mind, public device catalog
**IT4IT value streams:** Detect-to-Correct (discover → identify the estate) feeding Strategy-to-Portfolio (place each device in the DPPM portfolio); the published catalog is a Request-to-Fulfill knowledge asset.
**Backlog / decision / capsule anchors:** BI-E4A86393 (discovery triage sprint — `lifecycle_unverified` / `catalog_match_ambiguous` queues, epic `ce08a3e894513bcdc7bd4c3dd`); BI-9FE9D48D (edge-node detection engine, `services/edge-node-go/` — the signal-capture dependency); BI-8405FDA5 (edge-event envelope / ChangeEvent); DI-8D7873165D9D (2026-07-23 WWMD `principle_decide` recommendation for triage-to-investigation wiring); DI-96CADFE0F9EF (2026-07-24 WWMD recommendation to promote the process correction into a kernel principle + `AGENTS.md` pointer); WC-CD886F70 (2026-07-23 WWMD-scoped branch wiring for `needs-more-evidence` → coworker device investigation); BI-72DC6422 (EP-PROACTIVE-OPS follow-up for discovered-device criticality after identity/placement improves). _Prior drafts cited `IP-0DCAC` / `IP-6F240` (ImprovementProposals, not buildable BIs); now filed as **`BI-CA1688BB`** (DPPM placement algorithm) and **`BI-4FACD527`** (unknown-device investigation) under EP-AI-OPSMAP._
**Builds on:** `packages/db/data/discovery_fingerprints/`, `DiscoveryFingerprintRule` / `Observation` / `Review`, `evaluateFingerprintRule`, `discovery-triage`, `classifyEstateProvenance`, `redactFingerprintEvidence`, `contribute_to_hive`, EP-HIVE-SCOUT, `services/edge-node-go/internal/oui`.

---

## 1. Problem

A discovered digital product (a Reolink NVR, a TP-Link plug, a UniFi gateway) must be (a) **identified** — "what is this?" — and (b) **placed** — "which DPPM portfolio + sub-portfolio + product type?". Today both happened **manually** (operator + agent reasoning + one-off SQL). That is not procedural, not reproducible across discovery passes (live edits get churned), and not shareable. The operator's directive: move the cognitive load **operator → AI coworker → code → shared seed → hive**, make identification **consistent for every new occurrence**, and **publish** identified products as a value proposition.

## 2. How the field does this (research)

| System | Signals | Sharing model | Takeaway for DPF |
|---|---|---|---|
| **Fingerbank** (Inverse/Akamai; powers PacketFence) | DHCP fingerprint (Option 55 PRL + Option 60 vendor class), MAC OUI, HTTP User-Agent, TLS ClientHello, mDNS | **Crowd-sourced** — agents report "unknown fingerprints"; a curated central DB (110K+ devices, 6M+ fingerprints) is redistributed via API | This is exactly the operator's model: report-unknown → curate → redistribute. DPF's hive = our Fingerbank. |
| **DHCP Option 55 fingerprinting** (PacketFence, EfficientIP, ManageEngine) | Ordered parameter-request-list per OS/device class | Static + crowd-sourced DBs | Add DHCP fingerprint as a first-class signal alongside OUI |
| **Multi-protocol IoT ID** (academic, 2020-2025: USENIX, NDSS, MDPI) | mDNS/SSDP/UPnP service strings, DNS, early-packet metadata; ML / LLM classifiers for unknowns | Research datasets | Multi-signal beats any single signal; LLM/agent step is the modern "unknown" path |
| **IEEE OUI registry** | MAC OUI → vendor | Public registry | Vendor only — and only the *module* vendor for OEM radios (Espressif, Sichuan AI-Link); never sufficient alone |

**Key lessons:** (1) no single signal is enough — fuse OUI + DHCP-55/60 + mDNS/SSDP/UPnP + hostname + open ports; (2) detect **randomized/locally-administered MACs** (privacy addresses; IEEE 802 U/L bit, RFC 7844 anonymity profile) and **module-vendor OUIs** as inherently-unresolvable-by-OUI; (3) the durable pattern is **report-unknown → curate → redistribute** — a hive.

## 3. Substrate — what exists, and what to build (verified against the codebase 2026-06-04)

The spec is precise about reuse-vs-build so the implementation does not reinvent what exists or assume what does not.

### 3a. Exists and is load-bearing — reuse, do NOT rebuild
- **`DiscoveryFingerprintRule` / `Observation` / `Review`** (`packages/db/prisma/schema.prisma`) — the observation → review → rule-activation pipeline, with `matchExpression` (JSON `{all|any: clause[]}`), `resolvedIdentity`, `taxonomyNodeId` FK + `taxonomyConfidence`, `identityConfidence`, `requiredEvidenceFamilies`, `status`, `scope`, `redactionReport`.
- **`evaluateFingerprintRule`** (`packages/db/src/discovery-fingerprint-rules.ts`) — already supports comparators `exact` / `contains` / `regex` / `snmp_oid_prefix` over a `{ path, value|pattern }` clause, with `all`/`any` logic and required-evidence-family gating. **mDNS / SSDP / UPnP / DHCP-60 / hostname matching needs NO new comparator** — it is `contains`/`regex` against a new `signalClass` path. This is *data*, not engine code.
- **Evidence-family taxonomy** (`packages/db/src/discovery-fingerprint-types.ts`) — already enumerates `mdns` and `dhcp` (alongside `snmp`, `http_banner`, `tls_certificate`, `prometheus_target`, `human_confirmation`, …). Declared; nothing populates them yet (see §4).
- **MAC OUI resolution** (`services/edge-node-go/internal/oui`) — embedded IEEE dataset (~39k entries), `Lookup`, `NormalizeMAC`, `ShortVendor`. **OUI→vendor already works**; do not add a second OUI library.
- **`discovery-triage`** (`packages/db/src/discovery-triage.ts` + `apps/web/lib/discovery-triage*`) — applies active rules to entities; defines the triage thresholds (deterministic auto-apply → coworker review → operator) and a `countIndependentSignals()` helper whose `dhcpHints` / `mdnsServices` / `upnpDescriptors` / `netbiosNames` fields are declared but unpopulated.
- **`classifyEstateProvenance`** + promotion policy (`packages/db/src/discovery-promotion-policy.ts`) — `real_estate` vs `platform_internal`, `LEGACY_PROMOTABLE_TYPES`, `NON_PRODUCT_ENTITY_TYPES`/name gates, `AUTO_PROMOTE_THRESHOLD = 0.9`.
- **`redactFingerprintEvidence`** (`packages/db/src/discovery-fingerprint-redaction.ts`) — recursive PII redaction returning status `not_required` | `redacted` | `blocked_sensitive`; the hive path reuses it as a **fail-closed gate** (§7).
- **`contribute_to_hive`** + **Hive Scout / EP-HIVE-SCOUT** (`apps/web/lib/mcp-tools.ts`, `packages/db/src/hive-scout-config.ts`, `apps/web/lib/queue/functions/hive-scout-ingest.ts`) — cross-install contribution + autonomous curation substrate.
- **Foundational taxonomy** (`packages/db/data/taxonomy_v3.json`) — Building Management / Network / Voice / Client Compute nodes already seeded; placement targets an existing `taxonomyNodeId`, not a new portfolio object.
- **report-kit UI primitives** (`apps/web/components/ui/report-kit/`) — the browsable-catalog page (§8) builds on these.

### 3b. Exists but INCOMPLETE — must be built/extended (do NOT assume done)
- **DPPM placement logic (device class → Foundational sub-portfolio).** The *infrastructure* exists (provenance, promotion thresholds, type/name gates, the taxonomy tree) but the **placement algorithm itself is not implemented.** Build it on `taxonomy_v3.json` + `discovery-promotion-policy.ts`; file as a `BI-` (§10).
- **Identity shape.** `resolvedIdentity` is `{ kind, name, vendor }` — **no `model` or `deviceClass`**. Extend it (§5), do not add a parallel object.
- **Randomized / locally-administered-MAC + module-vendor flagging.** The OUI lookup does **not** check the U/L bit or flag module vendors. Small new helper (§5).
- **DHCP Option 55 ordered parameter-request-list match.** No comparator expresses "ordered list / sequence." This is the **one genuinely new comparator** needed (§5).

### 3c. Critical dependency — signal capture (the multi-signal premise rests on this)
The ladder (§6) and the fused fingerprint (§5) assume a rich signal set. **Today the estate only captures:** MAC + IP via ARP (`services/edge-node-go/internal/collect/arp.go`, OUI-enriched), local hostinfo, and **ping-only** nmap (`-sn`, no service/port detection). **Not captured:** DHCP Option 55/60, mDNS, SSDP/UPnP, open ports/banners.

**Therefore this spec has a hard upstream dependency on BI-9FE9D48D (edge-node detection engine).** `services/edge-node-go` is the correct home for L2/L3 capture (DHCP sniffing, mDNS/SSDP queries, port probes), emitting on the edge-event envelope (BI-8405FDA5) into `DiscoveryFingerprintObservation` with the right `evidenceFamilies`. **Sequencing rule:** fingerprint rules may only fuse signals capture actually emits — a rule matching `dhcp.option55` is dead weight until the detector populates it.

**Day-one available signals (no capture work):** OUI vendor + locally-administered-MAC flag + hostname + ARP-derived presence. Phase 2 (§8) is scoped to *these* so the ladder delivers value before the richer capture lands.

## 4. The cognitive-load escalation ladder (the core design)

Each discovered device flows **down** a deterministic ladder; only what a layer can't resolve escalates **up**; every resolution crystallizes **down** for next time. Layer boundaries reuse the **existing** triage thresholds (§3a), not new ones.

```
0. SEED FINGERPRINTS (shared, code) ── deterministic, fast, offline
   multi-signal match over signals capture emits (§3c):
   OUI + DHCP-55/60 + mDNS/SSDP/UPnP + hostname + ports
   → identity (vendor, model, deviceClass) + DPPM placement (taxonomyNodeId)
        │ miss / confidence below auto-apply threshold
        ▼
1. AI COWORKER INVESTIGATION (Estate Specialist / Portfolio Analyst)
   OUI analysis (incl. randomized-MAC + module-vendor detection),
   manufacturer web-research, evidence heuristics → identity + placement + confidence
        │ genuinely ambiguous (randomized MAC, unconfigured module device)
        ▼
2. OPERATOR (one click) ── only the irreducible unknowns, WITH evidence + a specific question
        │ answer / override (recorded as a DiscoveryFingerprintReview)
        ▼
   CRYSTALLIZE: the resolution becomes a new fingerprint rule (layer 0) ──┐
                                                                          │
   SHARE: the rule is contributed to the HIVE (layer 0 for everyone) ─────┘
```

**This is the operator's "load movement" made literal:** operator (layer 2, shrinking) → AI coworker (layer 1) → code/seed (layer 0) → hive (layer 0 for all installs). Over time, layer 2 approaches zero for known device classes. **Conflict handling:** when two layer-0 rules match one device, resolve by `identityConfidence`/`taxonomyConfidence` and the observation's existing `candidateMargin`; a sub-margin tie escalates to layer 1 rather than guessing.

### 4.1 Last-mile runtime contract: `needs-more-evidence` must trigger investigation

The daily discovery triage pass must not stop at another `DiscoveryTriageDecision(outcome="needs-more-evidence")` row when it has enough device signals to investigate. The runtime contract is:

1. Build a day-one `FingerprintRuleObservation` from the `InventoryEntity` name + properties, including MAC/OUI/vendor, hostname, and the operator-facing observed name (`operatorName`, `displayName`, `deviceName`, or item name).
2. Upsert a `DiscoveryFingerprintObservation` with `sourceKind="discovery-triage"`, `signalClass="device_identity_gap"`, `decisionStatus="pending_coworker_review"`, and the triage confidence/evidence snapshot.
3. Invoke the layer-1 coworker investigation core (`investigateUnidentifiedDevice`) immediately in the same pass.
4. Persist the result through `recordInvestigationOutcome`:
   - `auto_resolve` authors a **draft** `DiscoveryFingerprintRule` and a coworker `DiscoveryFingerprintReview`;
   - `escalate` records exactly one specific operator question and no rule;
   - failure in this side path must not prevent the original triage decision from being durable.
5. Update the observation status to the investigation summary (`draft`, `escalated`, or `dismissed`) after the review/rule write completes.

This contract converts the self-improvement loop from "coworker noticed a gap" into "coworker attempted to close the gap or left a durable review artifact." It also preserves epistemic discipline: a generic printer signal can place the device in Client & End User Compute, and an oven signal can place the device in Connected Appliances, but the system must not invent an exact model unless DHCP/mDNS/SNMP/IPP/UPnP or another corroborating source supplies it.

**2026-07-23 WWMD decision basis.** The branch-level decision for this contract was routed through the DPF kernel. `principle_decide` recorded ledger interaction `DI-8D7873165D9D` and recommended `reuse-existing-fingerprint-loop` with high confidence (composite 11.208; margin 7.835) over manual live-row fixes, a new parallel gap model, or looser AI identity inference. Work Capsule `WC-CD886F70` carries the branch activity and evidence. Applicable principles:

- `fix-the-seed-not-the-runtime`: patch the source-level triage/investigation path, not the live rows for this one printer/oven.
- `live-state-over-seed-data`: use the current `InventoryEntity`, quality-issue, triage-decision, and identity-resolution state as evidence for the gap.
- `responsible-capacity-utilization`: once the platform has authorized backlog/coworker capacity and a safe source-level path, idle detection is waste; the coworker should create durable evidence or surface a blocker.

The approved direction is to reuse the existing `DiscoveryFingerprintObservation` / `Review` / draft-rule substrate and the existing DPPM placement map. A parallel device-gap model, one-off SQL correction, or model hallucination of HP/oven details is rejected.

**2026-07-24 process-loop correction.** This thread exposed a second gap: an agent can correctly identify the implementation fix while initially missing the governance path. WWMD ledger interaction `DI-96CADFE0F9EF` recommended promoting the rule into the shared founder kernel plus an `AGENTS.md` pointer. The resulting principle is `docs/founder-kernel/wiki/principles/classify-ambiguous-requests-before-acting.md`: ambiguous requests that mix product symptoms with AI coworkers, proactivity, autonomy, backlog, WWMD, process gaps, or self-improvement must be classified before code edits, and fix-first sequencing cannot waive docs/spec/backlog/decision continuity.

**Criticality follow-up.** This branch closes the identity/placement investigation last mile. It does not infer operational criticality for devices like printers or ovens. That is intentionally tracked as `BI-72DC6422` under `EP-PROACTIVE-OPS`, because criticality needs context-driven posture, monitoring consumption, and either evidence or explicit operator confirmation. The next loop should reuse that epic rather than smuggling criticality inference into the fingerprint rule.

## 5. Robust multi-signal fingerprint — the narrow, real extensions

A `DiscoveryFingerprintRule` matches on a **fused** evidence set via `matchExpression.all`/`any`. Reuse the existing comparators and OUI library; the only net-new work is:

1. **DHCP Option 55 comparator** — a new `ordered_list_prefix` (or `sequence`) match `type` in `evaluateFingerprintRule` for the ordered parameter-request-list (the Fingerbank discriminant). Everything else (`mdns`, `ssdp`, `upnp`, `dhcp.option60`, hostname, banner) uses existing `contains`/`regex` against new `signalClass` paths — **data, not code**.
2. **MAC classification helper** — flag locally-administered (randomized; U/L bit set) MACs and known **module/OEM vendors** (Espressif, Sichuan AI-Link, FN-Link) as `vendor ≠ device`, so the evaluator can demand a corroborating non-OUI signal before resolving identity. Extends the existing OUI path; does not replace it.
3. **Identity extension** — extend `resolvedIdentity` from `{ kind, name, vendor }` to `{ kind, name, vendor, model, deviceClass }`. Migration + fixture update.
4. **Placement = existing `taxonomyNodeId`.** Do **not** add a parallel `placement {portfolio, taxonomyNode, productType}` object — the taxonomy tree path already encodes portfolio → sub-portfolio → product type. A rule resolves to an existing `taxonomyNodeId` with `taxonomyConfidence`; the DPPM algorithm (§3b) maps device class → that node.

Each rule therefore carries `resolvedIdentity {vendor, model, deviceClass}` + `identityConfidence`, and `taxonomyNodeId` + `taxonomyConfidence`, plus positive/negative fixtures (the existing validation gate). Confidence is **not a parallel scale** — it reuses the triage thresholds and `AUTO_PROMOTE_THRESHOLD = 0.9` (§3a) so the ladder's auto/review/escalate boundaries match the rest of discovery.

## 6. Hive mind integration (this is the value engine)

- **Contribute (outbound, fail-closed):** when layer-1/2 resolves an unknown, the install proposes a fingerprint rule via `contribute_to_hive` — the **fingerprint shape + identity + placement only**, never the operator's MAC/IP/hostname/SSID. `redactFingerprintEvidence` runs first; **any `blocked_sensitive` status aborts the contribution** (fail-closed, not best-effort). The `redactionReport` is attached for audit.
- **Curate:** Hive Scout / governance reviews contributed fingerprints (dedup, confidence, conflict resolution) — same evidence-gate discipline as backlog triage.
- **Trust inbound (supply chain):** a curated fingerprint rule is **executable placement logic authored by another install** — a poisoned or wrong rule could mis-identify/mis-place devices estate-wide. Inbound rules therefore: (a) carry **provenance** (contributing-install pseudonym + curation record); (b) ship `status: "draft"` / non-global `scope` and **activate locally only after the install's own positive/negative fixtures pass** against them; (c) are tracked under the estate's supply-chain posture (align with EP-ASSURANCE-LEDGER). No inbound rule auto-activates sight-unseen.
- **Redistribute:** curated, fixture-validated fingerprints ship in the seed catalog (`discovery_fingerprints/`) on the next release, so **every install gets smarter from every other install's discoveries** — recursive self-improvement applied to the estate.

### 6.1 Contribution consent — opt-in, default-on, unified surface

Fingerprint-pattern contribution is **opt-in, defaulted to opt-in (on)**. The default is on because outbound fingerprints are **PII-free** — the fingerprint *shape* → identity → DPPM placement only, never the operator's MAC / IP / hostname / SSID (enforced by `redactFingerprintEvidence`, fail-closed per §6) — and because the collective value compounds: every install's discoveries make every install smarter. Opt-out is a single toggle, honored immediately (no further patterns leave the install; already-curated rules remain in the shared catalog).

This sits **alongside but is distinct from** the existing **source / improvement** contribution mode (code, builds, improvement proposals contributed via PR with DCO sign-off). Similar intent (give back to the hive), different consent semantics:

| | Device fingerprint patterns | Source / improvements |
|---|---|---|
| Payload | PII-stripped fingerprint → identity → DPPM placement | Code, builds, improvement proposals |
| Primary risk | **Privacy** (must redact MAC/IP/hostname) | **IP / license** (DCO sign-off) |
| Default | **Opt-in (on)** | Per existing contribution policy |
| Mechanism | fingerprint contribution → Hive Scout curation → seed + public catalog | `contribute_to_hive` PR + DCO |

**All hive-contribution opt-ins are combined and aggregated into ONE surface** — a single **"Hive Contributions"** settings page (Admin → Hive), not scattered per-feature toggles:

- **Per-type toggles** — Device fingerprints *(default on)*, Source/improvements *(existing policy)*, with room for future contribution types — each with a plain-language statement of exactly what leaves the install.
- **One shared obfuscated contributor identity** (stable pseudonym, per the "obfuscated, not anonymous" principle) used across every contribution type, so contributions are attributable without being personally identifying.
- **One contribution ledger** — what was shared, when, and its curation status — for transparency and audit.
- **A master "pause all contributions"** control.

One place to see and govern everything that flows to the hive: aggregated, granular, defaulted to the value-creating choice, and trivially reversible.

## 7. Published device catalog (the value proposition)

- A **public, queryable device-identification catalog** (DPF's Fingerbank): "this OUI + DHCP-55 + mDNS shape = Reolink RLN8 NVR → Foundational / Building Management / Security & Surveillance."
- Read API + a browsable page (report-kit), versioned with the catalog `schemaVersion`.
- Outbound entries are PII-free fingerprint→identity→placement mappings — safe to publish (guaranteed by the §6 fail-closed gate).
- Positioning: the open, **portfolio-aware** device-identification database — Fingerbank tells you *what*; DPF tells you *what AND where it belongs in your digital product estate*. That portfolio-placement layer is the differentiated value.

## 8. Implementation plan (capture-led phases)

0. **Signal capture (dependency — BI-9FE9D48D).** Extend `services/edge-node-go` to capture DHCP-55/60, mDNS, SSDP/UPnP, and open ports; emit on the edge-event envelope into `DiscoveryFingerprintObservation` with the correct `evidenceFamilies`. _Until this lands, later phases are scoped to day-one signals (§3c)._
1. **Schema/rule extension** — add the `ordered_list_prefix` comparator (DHCP-55) + the MAC-classification helper to `evaluateFingerprintRule`; extend `resolvedIdentity` with `model`/`deviceClass` (migration + fixtures). _mDNS/SSDP/UPnP need no comparator work — data only._
2. **DPPM placement algorithm** — implement device class → Foundational sub-portfolio (`taxonomyNodeId`) on `taxonomy_v3.json` + `discovery-promotion-policy.ts`. File as a `BI-` (§10).
3. **Seed the current estate's identifications** — crystallize the 2026-06 estate-classification run's device classifications into seeded fingerprint rules + fixtures, so they reproduce procedurally on every discovery, no SQL. _Cite the discovery-run ID in the BI; do not reference "this session."_
4. **AI investigation wiring** — the coworker (Estate Specialist / Portfolio Analyst) fills gaps using day-one + captured signals and escalates only irreducible unknowns; resolutions auto-author draft rules and record a `DiscoveryFingerprintReview`. **Last-mile contract:** `needs-more-evidence` triage outcomes invoke this path immediately (§4.1), so the daily triage job produces a durable investigation artifact instead of leaving the queue inert.
5. **Unified contribution consent surface** — one "Hive Contributions" page aggregating all opt-ins (device fingerprints [default on] + source/improvements + future types), one obfuscated identity, one ledger, master pause. Wire each contribution path to honor its toggle.
6. **Hive contribution + curation** — fail-closed redacted fingerprint contribution (gated on the §6.1 opt-in); Hive Scout curation; provenance-tagged, fixture-gated inbound activation; redistribution into the seed catalog.
7. **Public catalog** — read API + browsable report-kit page; publish the curated fingerprint→identity→placement DB, versioned with the catalog `schemaVersion`.

**Acceptance (measurable):**
- A re-discovered estate auto-identifies + auto-places **100% of previously-seen device classes** with **zero operator input and zero manual SQL**.
- A brand-new device class escalates to the operator **exactly once**, then auto-resolves on every subsequent occurrence — locally and (post-curation) for every install in the hive.
- A `needs-more-evidence` device with day-one fingerprint signals produces either a coworker-authored draft rule or a single-question escalation review in the same triage pass; the triage decision remains durable even if the investigation side path fails.
- **Operator-escalation rate trends down** across successive discovery passes on a stable estate (the load-movement metric).
- Every contributed rule is PII-free (`redactionReport` shows no `blocked_sensitive` leakage) and passes its fixtures before local activation.

## 9. Standards & references

- Fingerbank (open DHCP/OUI/UA fingerprint DB; PacketFence sister project): https://www.fingerbank.org/ , https://www.fingerbank.org/usage/
- DHCP Option 55 fingerprinting: EfficientIP glossary; ManageEngine; PacketFence.
- MAC privacy / randomization: IEEE 802 locally-administered (U/L) bit; RFC 7844 (anonymity profiles for DHCP).
- Multi-protocol IoT identification: USENIX Security 2020 (mobile/IoT from WiFi), NDSS 2025 (ML IoT ID), MDPI Electronics 2025 (early DHCP/DNS metadata), arXiv 2510.13817 (LLMs for IoT device ID).
- IEEE OUI registry (MAC vendor) — already embedded in `services/edge-node-go/internal/oui`.
- The Open Group: "The Shift to Digital Product" + "Digital Product Portfolio Management" (the placement model).

## 10. Non-functional requirements & open items

- **Offline / deterministic:** layer 0 must resolve known device classes with **no network egress** (seed catalog is local); web-research is layer 1 only.
- **Catalog compatibility:** `catalog.json` already carries `schemaVersion`. Define a forward/backward-compat policy for redistributed rules — a new comparator (`ordered_list_prefix`) bumps `schemaVersion`, and older installs must **skip rules they can't evaluate rather than crash**.
- **Scale:** discovery passes process the full estate; rule evaluation is O(rules × observations) — keep `requiredEvidenceFamilies` gating as the cheap pre-filter so most rules short-circuit.
- **Catalog API:** define authn/rate-limit posture for the public read API; entries are PII-free, so the surface is read-only and cacheable.
- **Conflict resolution:** multi-rule match resolved by confidence + `candidateMargin`; sub-margin escalates (§4).
- **Backlog hygiene before build:** DONE — `BI-CA1688BB` (DPPM placement algorithm) and `BI-4FACD527` (unknown-device coworker investigation) filed under EP-AI-OPSMAP (`ce08a3e894513bcdc7bd4c3dd`); the legacy `IP-0DCAC`/`IP-6F240` ImprovementProposals are superseded by these IDs.
