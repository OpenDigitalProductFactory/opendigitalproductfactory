# Tool Evaluation: authentik

**Backlog item:** `BI-27E462BA`
**Epic:** EP-24741BBF — Absorb identity into DPF: the Directory Service
**Decision:** reject as runtime; conditional approval for bounded source absorption
**Risk:** medium
**Confidence:** 0.82
**Re-evaluate after:** 2027-02-23, or immediately on any authentik licence change or an advisory affecting its LDAP provider

authentik is an open-source identity provider offering OAuth2/OIDC, SAML, LDAP and
RADIUS from one platform. It has been named across ten DPF documents since
2026-03 and never evaluated. The 2026-04-22 enterprise-auth spec went further and
**ratified** it — "DPF should incorporate authentik as the identity edge runtime"
(line 383), provisioning DPF principals outward via SCIM (line 674) — with no
evaluation on record. EP-24741BBF reverses that stance. This document is the
evidence that reversal must cite, so the new decision is not made the same way the
old one was.

**Two different questions are evaluated here**, because the decision compares them:

- **Scenario A — adopt as runtime.** Run authentik as a service on DPF installs.
- **Scenario B — absorb from source.** Study its MIT-licensed implementation and
  build the capability natively in DPF.

## Corrections to claims previously asserted in DPF documents

Verified 2026-08-23 against primary sources. **Three claims that circulated in the
epic brief and in the EP-24741BBF design are wrong and are corrected here.**

| Claim as circulated | Verified fact | Source |
| --- | --- | --- |
| "Non-human identity accounts are Enterprise-only ($5/user/month)" | **False.** The pricing page states "No cost for service accounts." Non-human identities are free. | authentik pricing page |
| Implied: absorbing authentik's LDAP provider source into DPF is a code-lift | **Impractical.** The LDAP provider runs as an *outpost* — a separate container written in **Go**. DPF's runtime is TypeScript. The absorbable artifact is schema and protocol *semantics*, not source. | authentik architecture and LDAP provider docs |
| "authentik core is MIT" | **True, with a carve-out** that must be respected precisely. See Compliance. | repository `LICENSE` |

The pricing correction removes one of the five arguments the EP-24741BBF design
gave for absorbing. **The decision does not change** — it rests on the
architectural and practical grounds below, which are stronger and verified — but
the design is corrected rather than left standing on a false premise.

## Verified facts

**Architecture.** A layered monolith: Django 5.2 / Python 3.14 core with Django REST
Framework, Channels for WebSockets, and PostgreSQL as the sole supported database.
Protocol edges are **outposts** — separate containers, written in Go, connected to
the core by API. Proxy, LDAP and RADIUS are each an outpost.

**LDAP provider.** Requires an outpost. Supports LDAPS, code-based MFA, basic LDAP
schema compatibility, and SSSD integration. Two bind modes (direct, cached) and two
search modes (direct, cached). Exposes standard user attributes — `cn`, `uid`,
`uidNumber`, `mail`, `memberOf`, `homeDirectory` — with `objectClass` values `user`
and `goauthentik.io/ldap/user`; groups expose `cn`, `gidNumber`, `member` and
`goauthentik.io/ldap/group`. **No write operations are documented — the provider is
read-only.** No Enterprise-only restriction applies to it.

**Pricing.** Open Source: free. Enterprise: $5/user/month billed annually, plus
$0.02/external user/month. Enterprise Plus: from $20k annually. **No cost for
service accounts.**

**Security record (rolling ~12 months).** Four authentication-bypass-class
advisories:

| CVE | Nature | Fixed in |
| --- | --- | --- |
| CVE-2026-42849 | Reflected XSS in AutosubmitStage, Simple Flow Executor. **CVSS 9.3** | 2025.12.5, 2026.2.3 |
| CVE-2026-49448 | Source stage bypass via empty HTTP POST | 2025.12.6, 2026.2.4, 2026.5.1 |
| CVE-2026-25748 | Forward-authentication bypass in Proxy Provider with Traefik/Caddy | 2025.10.4, 2025.12.4 |
| CVE-2026-25922 | SAML assertion injection before a legitimately signed assertion | 2025.8.6, 2025.10.4, 2025.12.4 |

**This record is read as evidence of a healthy disclosure process, not as a mark
against the project.** authentik publishes a documentation page per CVE with
affected and fixed versions — better practice than most. The relevant findings are
narrower and two-sided:

1. Adopting it means inheriting a **patch treadmill** on every install, for a
   component sitting directly on the authentication path.
2. **Every one of the four is in a surface DPF would not absorb** — proxy
   forward-auth, SAML source, flow executor. None is in the LDAP provider. That
   materially lowers the risk of Scenario B relative to Scenario A.

## CoSAI security findings

Severity is stated per scenario where they differ. "A" = adopt as runtime,
"B" = absorb from source.

| # | Category | Severity | Finding | Required treatment |
| --- | --- | --- | --- | --- |
| 1 | Authentication | A: high · B: low | A: authentik becomes an authentication authority beside DPF's own, and four bypass-class CVEs in 12 months land squarely on this surface. B: no runtime authentication path is imported. | A: rejected. B: absorb read-only directory semantics only; never import flow-executor or proxy logic. |
| 2 | Access control | A: medium · B: n/a | authentik has its own RBAC over its own user store. Under A, DPF's `Principal` grants and authentik's permissions are two authorization models that must agree. | Reject A. Under B, authorization stays entirely in DPF (`authorization-classes.ts`, grants ∩ role capabilities); the directory publishes identity, never authority. |
| 3 | Input validation | A: high · B: low | CVE-2026-42849 (CVSS 9.3, reflected XSS) and CVE-2026-49448 (empty-POST bypass) are input-validation failures in the flow layer. | Under B none of that layer is absorbed. Any absorbed protocol decoding must be fuzzed against malformed BER/DER before it serves a bind. |
| 4 | Data/control boundary | low | authentik handles identity assertions, not prompts or business content. No LLM surface, so no prompt-injection or tool-poisoning vector. | Pass. If a directory attribute ever carries free text into an agent context, treat it as untrusted per the standing rule. |
| 5 | Data protection | A: high · B: low | A: to be useful authentik must hold a copy of DPF's workforce identities — the 2026-04-22 SCIM design provisions them outward. That is a second copy of personal data with its own backup, retention and breach surface. | Reject A. Under B no personal data leaves DPF; the directory is a derived projection of `Principal`. |
| 6 | Integrity controls | A: medium · B: medium | A: image pinning by digest required. B: absorbed design must be attributable to a specific upstream revision, or provenance is unauditable later. | Under B, cite the exact upstream commit or release for anything derived, in-file. |
| 7 | Session/transport | A: medium · B: medium | The cached-bind mode documents that **"revoking sessions does not remove them from the outpost."** A revoked credential can keep binding until the cache expires. | **Absorb this as a negative lesson.** DPF's listener must not cache binds in a way that outlives revocation; deactivation is transactional (design §7.3, §11). Add a test. |
| 8 | Network isolation | A: medium · B: low | A: adds a service, an admin UI, a database and one container per protocol outpost to every install's attack surface. | Reject A. Under B, the listener binds only the configured interface, TLS from org PKI, no admin surface. |
| 9 | Trust boundary | A: high · B: low | A: DPF would no longer be the authority for its own identities — it becomes a source provisioning into someone else's directory. This is the epic's governing objection and is independent of price or quality. | Reject A. |
| 10 | Resource management | A: low · B: medium | B: an LDAP listener is an unauthenticated-until-bound network surface. Unbounded search is a denial-of-service and an enumeration vector. | Bound result size and search depth; require authorization on search; treat anonymous enumeration as a release blocker. |
| 11 | Operational security | A: medium · B: low | A: a second audit log that must be correlated with DPF's own for any investigation. | Reject A. Under B, bind and search events land in DPF's existing audit trail. |
| 12 | Supply chain | A: high · B: low | A: imports Django, DRF, Channels, Postgres, Redis and per-outpost Go toolchains onto every install — a large tree in two languages DPF does not otherwise run. B: imports no runtime dependency at all. | Reject A. Under B, add no new runtime dependency without its own evaluation; note that no maintained Node LDAP **server** library exists (`ldapjs` MIT but archived 2024-05-14; `ldapts` is client-only). |

## Compliance

**Licence.** The repository `LICENSE` is **MIT**, with explicit carve-outs:

- "All content that resides under the `authentik/enterprise/` directory of this
  repository, if that directory exists, is licensed under the license defined in
  `authentik/enterprise/LICENSE`."
- Website content is CC BY-SA 4.0. Client-side JavaScript is MIT Expat.

The **Enterprise licence is not open source** and is explicitly incompatible with
absorption. Its terms: production use requires agreeing to the Subscription Terms
plus a valid subscription for the correct seat count; **"It is forbidden to copy,
merge, publish, distribute, sublicense, and/or sell the Software"** without proper
licensing; modification and patch publication require a subscription covering the
seat count; authentik Security Inc. retains rights to modifications. Copying and
modifying for development and testing is permitted without a subscription.

**Consequences that bind implementation:**

1. **Nothing under `authentik/enterprise/` may be read for absorption purposes.**
   The dev/test exception does not extend to deriving DPF product code. Treat that
   directory as off-limits, not merely unused.
2. MIT-licensed portions may be absorbed **with attribution**: the MIT notice and
   copyright line must travel with anything derived, in the file that derives it.
3. Because the LDAP outpost is Go and DPF is TypeScript, in practice what is
   absorbed is *design* — object-class mapping, attribute naming, bind/search
   semantics. Design and interface conventions are not themselves copyrightable
   expression, but where implementation is consulted, attribute the source anyway:
   the cost is one comment and the alternative is an unauditable provenance claim.

**Data residency.** Scenario A moves workforce identity data into a second store
(and, per the superseded SCIM design, out of DPF as the authority). Scenario B moves
no data anywhere.

**Regulatory.** Not an AI system; no EU AI Act classification. Identity data is
personal data, which is the whole of the residency concern above.

## Architecture fit

Scenario A is a poor fit for a reason that has nothing to do with authentik's
quality: it is a good product solving a different problem. authentik federates and
brokers identity for organizations that already have an authority. EP-24741BBF's
requirement is that **DPF be the authority** for installs that have none. Adopting
authentik satisfies the requirement by moving it — the install still depends on a
second identity system, and DPF is demoted to a provisioning source.

It also collides with a defect DPF already has. `apps/web/lib/govern/auth.ts` never
reads `Principal`: authentication is `User`-rooted while all TAK/GAID authorization
is `Principal`-rooted. DPF is already paying the cost of two identity roots. Adding
a third, across a network hop with a sync protocol, compounds a defect the epic
exists to retire.

Scenario B fits. DPF already has the spine (`Principal` + `PrincipalAlias`, with
GAID as an alias type), the projection (`/platform/identity/directory`), the
credential store (`User.passwordHash`), and machine trust (org PKI via Step CA).
The genuinely missing piece is a protocol listener.

**Independent corroboration worth noting:** authentik's LDAP provider is read-only
and layers a vendor auxiliary objectClass (`goauthentik.io/ldap/user`) over standard
attributes. The EP-24741BBF design independently chose exactly that shape — derived
read-only projection, standard `inetOrgPerson` plus `dpfAgent`/`dpfServiceAccount`
auxiliary classes. Two independent designs converging is evidence the shape is right.

## Integration evidence

**No integration test was run, and none should be.** Scenario A is rejected on
architecture, so installing authentik to benchmark it would burn capacity proving a
conclusion already reached on stronger grounds. Scenario B introduces no runtime
dependency to test. The evidence base for this evaluation is primary-source
documentation, the licence files, the published CVE record, and the DPF substrate
sweep recorded in the EP-24741BBF design.

This is a deliberate departure from the pipeline's Phase 5 and is called out rather
than silently skipped.

## Verdict

**Scenario A — adopt as runtime: REJECT.** Not on cost and not on quality. It cannot
deliver the requirement (DPF as the authority), it creates a second identity truth
and a second copy of workforce personal data, and it imports a large two-language
dependency tree plus a patch treadmill on the authentication path of every install.

**Scenario B — absorb from source: CONDITIONAL APPROVAL.**

The honest position, now that the pricing claim is corrected: **adoption is cheaper
and more capable than the epic assumed.** The LDAP provider and service accounts are
both free, and authentik would deliver working LDAP far faster than building one.
The case for absorbing does not rest on authentik being expensive or weak. It rests
on three verified points:

1. **Architecture.** Adoption relocates the dependency rather than removing it, and
   demotes DPF from authority to provisioning source. This is the governing
   constraint and it is not negotiable on cost grounds.
2. **Data.** Adoption requires a second copy of workforce personal identity, with
   its own retention and breach surface.
3. **Practicality.** There is no in-process option in DPF's runtime. authentik's
   own LDAP edge is a separate Go container, and no maintained Node LDAP *server*
   library exists. Every adoptable path is a separate process.

The cost of absorbing is real and is accepted with eyes open: DPF takes on a
protocol maintenance tail, including its CVEs, with no upstream that will fix them.

## Conditions

1. **Nothing under `authentik/enterprise/` is read, consulted, or derived from.**
   Its licence forbids copying and distribution without a subscription.
2. Anything derived from MIT-licensed authentik source carries the MIT notice and
   an upstream revision reference in the deriving file.
3. Absorption is limited to **directory semantics** — object classes, attribute
   naming, bind and search behaviour. No flow-executor, proxy, or SAML logic is
   absorbed; those are where all four recent bypass CVEs live.
4. The DPF listener is **read-only**. No LDAP write operations.
5. **Bind caching must not outlive revocation** — the explicit negative lesson from
   authentik's cached-bind mode. Covered by a test.
6. Search requires authorization and bounded results. Anonymous enumeration of the
   tree is a release blocker.
7. Any new runtime dependency introduced to serve the protocol gets its own
   evaluation before adoption.
8. This verdict covers absorption for the **LDAP** surface only. SAML, OIDC and
   SCIM are out of scope and each needs its own decision.

## Execution record (2026-08-28)

The absorb decision has been carried out. What it produced, and how the
conditions above were met:

- **Nothing was vendored.** The BER codec and LDAP message layer were written
  against RFC 4511. No authentik source and no `ldapjs` source was copied, so
  **condition 2 (carry the MIT notice) did not come into force** — there is
  nothing derived to attribute. Condition 1 held throughout: nothing under
  `authentik/enterprise/` was read.
- **Condition 3** — absorption stayed at directory semantics. The object-class
  shape and the read-only posture match what the evaluation observed in
  authentik's provider; none of its flow-executor, proxy or SAML logic, where
  all four recent bypass CVEs live, was touched.
- **Condition 4** — the listener is read-only. Writes are refused with
  `unwillingToPerform`, not left unimplemented.
- **Condition 5** — there is no bind cache at all, so the negative lesson from
  authentik's cached-bind mode ("revoking sessions does not remove them from the
  outpost") cannot recur here.
- **Condition 6** — search requires a successful bind and is bounded; anonymous
  enumeration is refused, verified against a real `ldapsearch` client.
- **Condition 7** — no new runtime dependency was introduced.

The one prediction that proved wrong in DPF's favour: the evaluation warned that
absorbing means owning a protocol maintenance tail with no upstream to fix its
CVEs. That remains true, but the surface is smaller than expected, because
implementing only bind and search against a read-only projection avoids most of
what makes an LDAP server dangerous.

## Re-evaluation

- **Schedule:** 2027-02-23.
- **Triggers:** any change to authentik's MIT licensing or the enterprise carve-out;
  any advisory affecting the LDAP provider specifically; a maintained Node/TypeScript
  LDAP server library appearing, which would reopen the implementation question in
  BI-F7317D65; or a DPF decision to serve SAML/OIDC/SCIM, which reopens Scenario A
  on a broader surface.

## Sources

- authentik repository `LICENSE` (MIT with `authentik/enterprise/` carve-out) —
  <https://github.com/goauthentik/authentik/blob/main/LICENSE>
- authentik Enterprise Edition licence —
  <https://github.com/goauthentik/authentik/blob/main/authentik/enterprise/LICENSE>
- LDAP Provider documentation —
  <https://docs.goauthentik.io/add-secure-apps/providers/ldap/>
- Pricing —
  <https://goauthentik.io/pricing/>
- CVE-2026-25748 —
  <https://docs.goauthentik.io/security/cves/CVE-2026-25748/>
- CVE-2026-42849 — <https://app.opencve.io/cve/CVE-2026-42849>
- `ldapjs` archival and decommission notice —
  <https://github.com/ldapjs/node-ldapjs>
- DPF substrate sweep and current-state verification —
  `docs/superpowers/specs/2026-08-23-directory-service-identity-absorption-design.md` §2
