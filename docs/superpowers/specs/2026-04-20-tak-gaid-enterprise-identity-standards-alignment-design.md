# TAK + GAID Enterprise Identity Standards Alignment Design

**Date:** 2026-04-20  
**Status:** Draft  
**Intent:** Standards-first reference for implementation in `DPF`  
**Primary Question:** Should `TAK` and `GAID` remain independent standards concepts, be narrowed and aligned to adjacent standards, or be replaced by existing enterprise identity standards?  
**Answer:** Keep both, narrow both, and explicitly compose them with `LDAP`, `SCIM`, workload identity standards, and agent-facing protocol standards.

---

## 1. Executive Summary

This design argues that `TAK` and `GAID` still address a real gap, but only if they stop trying to be monolithic identity stacks.

The strongest model is:

- `GAID` defines the enduring identity of an AI agent subject
- `TAK` defines the immutable trusted runtime envelope that loads and enforces the agent's approved operating state
- `LDAP` projects directory identity, bind authentication, groups, and coarse authority for enterprise compatibility
- `SCIM` projects lifecycle provisioning and synchronization
- workload identity and federation standards continue to own credential transport and cross-boundary trust where they already fit well
- agent-facing protocols such as `MCP` and `A2A` carry these identity and trust semantics, but do not replace them

The key gap not solved cleanly by existing standards in combination is:

- enduring AI subject identity
- versioned operating state beneath that identity
- capability and assurance badging tied to that state
- runtime proof that the live agent is operating inside a trusted immutable harness
- continuity when an internal agent later becomes externally exposed
- transparent invalidation and revalidation when core dependencies drift

`DPF` is a strong proving ground for this because it already has:

- route-aware AI coworkers
- human roles and group-based authority
- tool grants and runtime gating
- emerging `TAK` governance mechanics
- early `GAID` and badging thinking

---

## 2. Problem Statement

Modern organizations increasingly need one operational identity system that includes:

- humans
- AI coworkers
- service/workload identities

Those subjects often need to interact in the same business processes and enterprise systems.

Traditional IAM patterns model this only partially:

- humans are first-class
- services are usually second-class
- AI agents are usually not modeled well at all

This creates several failures:

1. AI agents are treated as UI labels, not governed subjects.
2. Changes in model, prompt, tool surface, or autonomy posture are not reflected in identity and trust semantics.
3. External systems can consume coarse group membership, but cannot tell whether they are interacting with the same previously validated AI operational subject.
4. Internal-only agents often receive a different identity when they become externally visible, breaking continuity and auditability.
5. Silent dependency drift, especially model-provider behavior changes, can invalidate capability assumptions without visible trust-state changes.

The design problem is therefore not simply "add AI agents to LDAP."  
The problem is:

**How should a single identity and trust model represent AI coworkers as enduring subjects whose capabilities, assurances, authorizations, and runtime integrity evolve over time, while still interoperating cleanly with enterprise identity systems and agent-facing protocols?**

---

## 3. Current State In DPF

Relevant repo-local context already exists:

- `User`, `UserGroup`, `PlatformRole`, `Team`, and `TeamMembership` provide human governance anchors
- the AI coworker registry and runtime already provide stable local agent identities, tool grants, route context, supervisors, and delegation metadata
- `AgentGovernanceProfile`, `DelegationGrant`, and related governance work provide an emerging authority model
- `ToolExecution` and approval flows already provide meaningful audit evidence
- `GAID` and `TAK` work already exists as architectural standards material

Key current references:

- [GAID.md](D:/DPF/docs/architecture/GAID.md)
- [agent-standards-dpf-conformance.md](D:/DPF/docs/architecture/agent-standards-dpf-conformance.md)
- [2026-03-13-unified-identity-access-agent-governance-design.md](D:/DPF/docs/superpowers/specs/2026-03-13-unified-identity-access-agent-governance-design.md)
- [2026-03-26-agent-rbac-action-audit-design.md](D:/DPF/docs/superpowers/specs/2026-03-26-agent-rbac-action-audit-design.md)
- [2026-04-18-tak-gaid-standards-family-design.md](D:/DPF/docs/superpowers/specs/2026-04-18-tak-gaid-standards-family-design.md)

This means the design should be additive and reference-implementation-oriented, not a greenfield replacement thesis.

---

## 4. Research & Benchmarking

### 4.1 Standards and ecosystems reviewed

#### Enterprise identity and directory standards

- `LDAP` authentication and security mechanisms (`RFC 4513`)
- `SCIM` core schema and protocol (`RFC 7643`, `RFC 7644`)
- active `SCIM` working-group activity and agent drafts
- current workload identity standards direction via `WIMSE`

#### Open implementations and directory platforms

- `OpenLDAP`
- `FreeIPA`
- `authentik`
- `Keycloak`

#### Agent-facing ecosystems

- `MCP`
- `A2A`

### 4.2 What existing standards solve well

#### `LDAP`

`LDAP` solves:

- hierarchical directory query
- bind-style authentication
- group lookup
- attribute-based lookup for relying systems
- coarse authority projection

It is widely implemented and valuable as an enterprise compatibility surface.

What `LDAP` does **not** naturally solve:

- AI subject identity continuity across private and public exposure
- versioned operating profiles beneath a stable agent identity
- badging and assurance semantics
- runtime proof that the live agent is operating under an approved immutable harness
- transparent invalidation of capability trust when model dependencies drift

#### `SCIM`

`SCIM` solves:

- provisioning and deprovisioning
- synchronization of users and groups
- HTTP/JSON lifecycle flows

Current `SCIM` agent drafts suggest that standards momentum for agent lifecycle is moving there rather than into new `LDAP` schema efforts.

Implication:

- `SCIM` is the right place to align lifecycle and provisioning semantics
- `GAID` should not attempt to replace `SCIM`

#### Workload identity standards

Workload identity and federation ecosystems solve or are attempting to solve:

- non-human credential exchange
- cross-system trust
- workload attestation and identity portability

Implication:

- `TAK` should not invent a parallel general-purpose credential protocol
- `TAK` should define what a trusted agent runtime must prove and enforce, then map onto appropriate credential and attestation transport where possible

### 4.3 Best-of-breed implementation patterns

From current directory products and implementations:

- published directory structure is often separate from internal canonical state
- downstream systems usually consume groups as the primary coarse authority surface
- read-only consumer accounts are common even where the underlying directory is writable
- placement in a directory tree is not the only reliable signal of principal type; explicit attributes and object classes are also used

This supports a DPF pattern of:

- canonical internal model first
- `LDAP` projection second
- `SCIM` projection third

### 4.4 Benchmark conclusion

There is no strong evidence that a mature, `LDAP`-native agent identity standard already solves this problem end-to-end.

There **is** evidence that:

- `SCIM` is the active place for agent lifecycle/provisioning work
- workload identity efforts are active around non-human trust
- existing directory protocols remain highly useful as interoperability surfaces

Therefore:

- `GAID` should focus on the missing AI subject identity and trust semantics
- `TAK` should focus on the missing runtime trust and immutability semantics
- both should explicitly map onto `LDAP`, `SCIM`, and workload identity standards

Representative references:

- `RFC 4513`: <https://datatracker.ietf.org/doc/rfc4513/>
- `RFC 7643`: <https://datatracker.ietf.org/doc/html/rfc7643>
- `RFC 7644`: <https://datatracker.ietf.org/doc/html/rfc7644>
- `SCIM` charter, updated **2026-03-18**: <https://datatracker.ietf.org/doc/charter-ietf-scim/>
- `draft-wahl-scim-agent-schema-01`: <https://datatracker.ietf.org/doc/html/draft-wahl-scim-agent-schema-01>
- `draft-abbey-scim-agent-extension`: <https://datatracker.ietf.org/doc/draft-scim-agent-extension/>
- `WIMSE` charter: <https://datatracker.ietf.org/doc/charter-ietf-wimse/>
- `OpenLDAP` admin guide: <https://www.openldap.org/doc/admin12/index.html>
- `FreeIPA` LDAP guidance: <https://www.freeipa.org/page/HowTo/LDAP>
- `authentik` LDAP provider docs: <https://docs.goauthentik.io/docs/add-secure-apps/providers/ldap/>
- `Keycloak` server admin guide: <https://www.keycloak.org/docs/latest/server_admin/>

---

## 5. Design Goals

1. Preserve one enduring AI coworker identity from creation through external exposure.
2. Keep capability, assurance, and authorization as versioned governed state beneath that identity.
3. Make runtime trust depend on `TAK` immutability, not on directory metadata alone.
4. Publish identity and coarse authority into enterprise systems without making `LDAP` the canonical model.
5. Support both enterprise-private and externally visible AI agents with one coherent identity model.
6. Make material change and dependency drift visible to users and relying systems.
7. Avoid redundant overlap with `SCIM`, workload identity, and directory standards.

---

## 6. Recommended Standards Boundary

### 6.1 What `GAID` should own

`GAID` should define:

- the enduring AI subject identity
- issuer lineage and origin authority
- `AIDoc`-style identity metadata
- identity continuity across:
  - private
  - federated
  - public exposure states
- references to profile versions
- references to badging and assurance state
- references to verification and revocation material
- chain-of-custody identity semantics

`GAID` should **not** define:

- provisioning transport
- directory query protocol
- password or token exchange protocol
- the runtime policy engine itself

### 6.2 What `TAK` should own

`TAK` should define:

- the immutable trusted harness
- approved operating profile loading
- runtime enforcement of tool grants, autonomy, delegation, HITL, and instructions
- runtime identity proof posture
- how a relying party can know that the live agent is operating under an approved kernel-governed state
- how runtime trust changes when the approved operating profile or its dependencies materially change

`TAK` should **not** define:

- public identifier namespace governance
- generic directory protocol behavior
- general-purpose credential transport
- full provisioning APIs

### 6.3 What existing standards should continue to own

- `LDAP`
  - directory search
  - bind authentication
  - group lookup
  - coarse authority projection
- `SCIM`
  - identity lifecycle provisioning
  - group synchronization
- workload identity standards
  - non-human credential exchange
  - federation
  - attestation transport where suitable
- `MCP`, `A2A`, and similar protocols
  - interaction transport
  - tool and capability exchange
  - protocol-level metadata carrying identity references

---

## 7. Core Subject Model

### 7.1 Stable AI subject identity

Each AI coworker gets one stable `GAID` at creation time.

That `GAID` identifies the enduring subject, not a single ephemeral runtime session.

The `GAID` should survive:

- prompt changes
- model upgrades
- tool additions and removals
- autonomy changes
- badge changes
- internal-to-external exposure changes

This is analogous to:

- a durable subject identity in the real world
- a work identity in `ISBN`
- a canonical package identity in `purl`

The stable identifier is important because relying systems need continuity even when the operational state evolves.

### 7.2 Subject versus state

The design must distinguish:

- **subject identity**: who this agent is
- **operating state**: what this agent is currently approved and able to do

The subject stays stable.  
The operating state changes.

This distinction is the basis of the whole architecture.

---

## 8. Operating Profile Model

### 8.1 Operating profile definition

An operating profile is the governed, materially relevant bundle that defines how a specific `GAID` currently runs.

The profile includes at minimum:

- model/provider family and declared version
- prompt and instruction bundle references
- enabled tools and tool-grant classes
- autonomy and HITL posture
- environment and runtime references
- verifier references
- badge set
- authorization posture

### 8.2 Same `GAID`, new profile version

A material change to any of those inputs does not create a new identity by default.

Instead it creates a new profile version for the same `GAID`.

This yields:

- one enduring agent identity
- many versioned operational states over time

### 8.3 Profile state lifecycle

Each profile version should support lifecycle states such as:

- `draft`
- `pending-validation`
- `validated`
- `restricted`
- `revoked`
- `retired`

Only a validated and currently approved profile should be eligible for higher-trust runtime operation.

---

## 9. Badge Model

### 9.1 Badge purpose

Badges are structured claims about the current profile state, not substitutes for identity.

They should express at least four categories:

- **capability**
  - can use tools
  - can operate with a certain reasoning tier
  - can act in a certain domain
- **assurance**
  - self-asserted
  - organization-attested
  - independently evaluated
- **authorization posture**
  - approved autonomy band
  - allowed data sensitivity class
  - external-facing approval
- **status**
  - active
  - stale
  - pending revalidation
  - revoked

### 9.2 Badges are version-specific

A badge attaches to a profile version, not permanently to the `GAID` in the abstract.

This is important because:

- capability can improve
- capability can degrade
- model behavior can drift
- new tool use may appear
- previously validated assumptions may no longer hold

### 9.3 Badge invalidation

When a material change occurs, relevant badges should not silently continue as if nothing changed.

Badges should move to a state such as:

- `stale`
- `pending-revalidation`
- `restricted`

until policy says otherwise.

---

## 10. Material Change And Dependency Drift

### 10.1 Material change triggers

A material change should include:

- declared profile change:
  - prompt/instruction bundle changed
  - tools changed
  - autonomy changed
  - model selection changed
- dependency change:
  - model provider changes behavior under the same named model family
  - runtime/harness version changes
  - safety behavior changes
  - undocumented model drift is detected
- governance context change:
  - badge criteria changes
  - internal risk policy changes
  - validation policy changes

### 10.2 Identity continuity versus validation continuity

The same `GAID` may continue to refer to the same agent subject while validation continuity is broken.

This is one of the most important conceptual contributions of the design:

- same subject
- not necessarily the same validated operational state

### 10.3 Transparency requirement

If a material change happens:

- the user interacting with the agent must be able to tell
- relying systems must be able to tell
- hidden drift is unacceptable

The exact runtime policy response can vary by risk class, but transparency cannot.

---

## 11. Fingerprint And Attestation Model

### 11.1 Public profile fingerprint

Every materially relevant profile should produce a derived fingerprint or digest.

The fingerprint should change when any materially relevant element changes.

The fingerprint is not the identity. It is the public marker of the operational state under that identity.

### 11.2 Protected attestation material

The system should distinguish:

- a visible profile marker for comparison
- stronger protected proof material controlled by `TAK`

This supports two distinct questions:

- **Who is this?**
  - the `GAID`
- **Is this the same validated operational subject I dealt with before?**
  - compare the profile fingerprint and validation state

### 11.3 Relationship to `TAK`

`TAK` should participate in establishing or attesting the binding between:

- `GAID`
- approved profile version
- profile fingerprint
- runtime state

This is what makes identity and capability posture harder to spoof casually.

---

## 12. TAK As Trusted Runtime Proof Substrate

### 12.1 Kernel analogy

The role of `TAK` is analogous to a trusted kernel:

- immutable core
- controlled loading of approved state
- authoritative enforcement of governance boundaries

It is not just an execution convenience layer.

### 12.2 What `TAK` makes possible

Because `TAK` governs the live runtime, an agent can identify itself not merely by claiming:

- "I am agent X"

but by proving a richer statement:

- "I am `GAID` subject X"
- "I am running approved profile Y"
- "I am executing under trusted harness Z"

This is a central difference between ordinary service identity and the proposed AI agent identity model.

### 12.3 Immutable artifact concept

The approved operating profile bundle loaded by `TAK` should be treated as an immutable governed artifact for runtime purposes, including:

- model binding
- prompt/instruction bundle
- tool grants
- autonomy settings
- verifier references
- badge/authorization state

---

## 13. LDAP Projection Model

### 13.1 Role of LDAP

`LDAP` should be a projection surface, not the source of truth.

It should be used to:

- publish principals
- allow enterprise-compatible authentication scenarios
- publish groups and memberships
- project coarse authority to relying systems

### 13.2 Principal branches

Recommended high-level directory shape:

- `ou=people`
- `ou=agents`
- `ou=services`
- `ou=groups`

This is helpful for compatibility and discoverability, but the directory tree alone should not be the only principal-type signal.

### 13.3 Explicit type

Every published principal should also carry an explicit type marker such as:

- `human`
- `agent`
- `service`

Suggested DPF projection attribute examples:

- `dpfPrincipalType`
- `gaid`
- `dpfProfileFingerprint`
- `dpfValidationState`
- `dpfAuthorityClass`
- `dpfExposureState`

### 13.4 Role and group projection

For downstream compatibility, roles should be projected primarily through groups.

This avoids unnecessary duplication because many consumers already reason about coarse authority through group membership.

`LDAP` therefore becomes:

- identity surface
- group/role compatibility surface
- coarse authority surface

not the home of the full `TAK` governance model.

### 13.5 Example conceptual agent entry

Illustrative only:

```ldif
dn: gaid=gaid:priv:dpf.internal:marketing-specialist-001,ou=agents,dc=dpf,dc=internal
objectClass: top
objectClass: person
objectClass: organizationalPerson
objectClass: inetOrgPerson
objectClass: dpfAiAgent
cn: Marketing Specialist
sn: Marketing Specialist
uid: agt-marketing-specialist-001
gaid: gaid:priv:dpf.internal:marketing-specialist-001
dpfPrincipalType: agent
dpfProfileFingerprint: sha256:8f2...
dpfValidationState: validated
dpfExposureState: private
memberOf: cn=marketing,ou=groups,dc=dpf,dc=internal
memberOf: cn=can-use-tool-class-basic,ou=groups,dc=dpf,dc=internal
```

The details will evolve, but the projection principle should remain stable.

---

## 14. SCIM Projection Model

### 14.1 Role of SCIM

`SCIM` should be the provisioning and synchronization projection, not the full identity standard.

It should support:

- creation and update of AI coworker identity records in downstream systems
- synchronization of group memberships
- lifecycle operations:
  - activate
  - suspend
  - deprovision
- propagation of selected agent metadata that downstream systems can consume

### 14.2 Relation to current drafts

The active SCIM agent drafts suggest an industry path where agent lifecycle is expressed through SCIM-style resources and extensions.

`DPF` should align with that direction and use its implementation experience to inform the standards rather than ignoring them.

### 14.3 Mapping concept

Conceptually:

- `GAID` remains the canonical AI subject identifier
- profile fingerprint and validation state become SCIM-mappable attributes or extensions
- groups remain coarse authority projection objects

---

## 15. Internal-To-External Transition

The design requires a seamless path from:

- internal-only AI coworker
- to externally visible or externally callable AI coworker

That means:

- same `GAID`
- same subject history
- same profile lineage
- stronger published verifier and issuer material over time if needed
- different exposure and assurance state, not different subject identity

This was a core motivation behind `GAID`, and the design should preserve it.

---

## 16. Security Goals

The design should explicitly defend against:

- identity spoofing
- silent capability drift
- unauthorized use of stale badges
- hidden changes in model or prompt posture
- over-reliance on display names or directory placement

The trust model should bind together:

- subject identity (`GAID`)
- approved operating profile version
- profile fingerprint
- runtime execution under `TAK`
- published validation status

This is the minimum needed for meaningful enterprise authorization decisions about AI agents.

---

## 17. Why TAK And GAID Still Matter

If `LDAP`, `SCIM`, and workload identity standards already existed, why keep `TAK` and `GAID` at all?

Because none of the adjacent standards fully own the combined semantics of:

- enduring AI subject identity
- versioned operational state under that identity
- capability and assurance badging tied to that state
- immutable runtime proof posture
- continuity from internal to external exposure
- transparent invalidation and revalidation when model dependencies drift

That combination is the real niche.

So the standards should survive, but narrowed:

- `GAID` = identity and claim semantics
- `TAK` = runtime trust and enforcement semantics

Everything else should be reused where possible.

---

## 18. DPF Reference Implementation Direction

The first implementation work should prioritize:

1. canonical AI coworker subject identity with `GAID`
2. versioned operating profile model
3. badge model with invalidation and revalidation semantics
4. profile fingerprint generation
5. `TAK` binding to approved immutable profile bundles
6. `LDAP` projection for:
   - agents
   - humans
   - services
   - groups
7. `SCIM` projection design as the next lifecycle layer

The broader unified enterprise principal model may still be useful later, but it is secondary to the agent identity and trust problem this spec is trying to solve first.

---

## 19. Open Questions

1. What exact `LDAP` object classes and attributes should DPF publish for `GAID`, profile fingerprint, and validation state?
2. What should be publicly visible versus internally protected in the attestation model?
3. Which workload identity mechanisms should DPF prefer first for authenticating AI coworkers in more stringent real-world scenarios?
4. How should badge vocabularies be standardized so they are portable without becoming too vague?
5. What conformance evidence should DPF produce to show that `TAK` claims are actually enforced?
6. How should `MCP` and `A2A` carry identity, fingerprint, and receipt references consistently?

---

## 20. Summary

The correct direction is not to kill `TAK` and `GAID`, and not to let them sprawl into giant overlapping stacks.

The correct direction is to:

- keep `GAID` as the enduring AI subject identity layer
- keep `TAK` as the immutable trusted runtime layer
- align `LDAP` as the enterprise directory/auth/coarse-authority projection
- align `SCIM` as the lifecycle and provisioning projection
- align workload identity standards as the non-human credential and federation layer
- align agent-facing protocols as transport surfaces carrying these semantics

`DPF` should implement this as a reference proving ground and use what it learns in practice to refine the standards.
