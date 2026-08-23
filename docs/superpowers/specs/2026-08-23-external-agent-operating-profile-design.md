---
status: draft
---

# Principal-bound External Agent Operating Profile Design

**Date:** 2026-08-23

**Status:** Revised after independent review of `19552b0849c2`; ready for fresh re-review

**Backlog:** `BI-11D611B3`

**Epic:** `EP-56AE0F69`

**Parent design:** `docs/superpowers/specs/2026-08-22-external-agent-operating-contract-design.md`

**Extends:**

- `docs/superpowers/specs/2026-08-22-consumer-agent-host-design.md`
- `docs/superpowers/specs/2026-08-22-installation-identity-and-agent-stance-design.md`
- `docs/superpowers/specs/2026-05-09-deployment-contracts.md`, especially Contracts 4, 9, 10, and 12

## 1. Decision

DPF will expose one versioned, principal-bound `ExternalAgentOperatingProfile` as the authenticated orientation contract for source-free installations. The profile is a short-lived projection compiled from existing installation, principal, token, organization, work-policy, and compatibility authorities. It is not a new persisted business record.

The MCP bootstrap will list `operating_profile_get` in the lean core before broad tool discovery. Public A2A Agent Cards will advertise only schema compatibility and the authenticated discovery location through the standard A2A `AgentCapabilities.extensions` seam; they will not disclose the principal-bound profile, organization doctrine, private work, grants, or private capabilities. The generated install-local pointer will name the deployed profile schema, schema digest, and release-image digest and will stop clients when the served contract is unavailable or incompatible.

This slice completes orientation only. Work catalogs, Work Packets, business-work leases, and operator workflow UX remain in their named child backlog items.

## 2. Governed scope manifest

- **OBJ-P0-ORIENTATION:** Give an authenticated external agent one bounded orientation response before it searches or invokes the wider DPF tool surface.
- **OBJ-P0-AUTHORITY:** Ensure the response is compiled for the current installation, organization, human sponsor, acting agent, token tier, grants, and expiry without granting new authority.
- **OBJ-P0-PROTOCOL:** Publish the same operating-profile version and digest semantics through MCP and A2A discovery while keeping public A2A metadata non-sensitive.
- **OBJ-P0-POINTER:** Make the source-free install-local pointer a generated, subordinate compatibility hint with deterministic drift and stop behavior.
- **OBJ-P0-COMPATIBILITY:** Preserve existing host-profile, instance-stance, organization-context, progressive-disclosure, and A2A card contracts while introducing the new orientation seam.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-P0-01 | OBJ-P0-ORIENTATION | A granted MCP caller can invoke `operating_profile_get` from the lean core without first loading the full tool catalog. |
| AC-P0-02 | OBJ-P0-AUTHORITY | Observer, employee, development, and admin test authorities produce their correct descriptive tier and distinct authority digest from one pure compiler without manufacturing global policy; no projection contains bearer secrets or an unfiltered grant inventory. |
| AC-P0-03 | OBJ-P0-AUTHORITY | Missing sponsor, acting-agent identity, organization, authority, expiry, or installation identity returns a typed unavailable result and never a guessed privileged profile. |
| AC-P0-04 | OBJ-P0-PROTOCOL | MCP and A2A compatibility metadata use the same profile-schema version, schema digest, RFC 8785 canonicalizer identifier, and authenticated discovery tool; the principal-bound profile digest is never published through A2A. |
| AC-P0-05 | OBJ-P0-PROTOCOL | Public Agent Cards carry one optional DPF `AgentExtension` under `capabilities.extensions` and expose only allow-listed schema compatibility plus an authenticated discovery reference; private organization context, work, authority, profile digest, and capability inventory remain absent. |
| AC-P0-06 | OBJ-P0-POINTER | The generated pointer states runtime-not-source, MCP discovery, profile-schema version, contract-schema digest, release-image digest, recovery guidance, and the stop rule for unavailable or incompatible served contracts. |
| AC-P0-07 | OBJ-P0-POINTER | Pointer comparison distinguishes current, stale, missing, and malformed states by comparing schema and release identities without treating the pointer as authority, containing a principal-bound profile digest, or mutating installed runtime files from application request handlers. |
| AC-P0-08 | OBJ-P0-COMPATIBILITY | Existing initialize instructions and organization context remain available as compatibility guidance, while instructing capable clients to fetch the operating profile before acting. |
| AC-P0-09 | OBJ-P0-COMPATIBILITY | Focused unit, MCP route, A2A projection, pointer-generation, guard, typecheck, production-build, and source-free runtime verification pass on the exact branch commit. |

## 3. Existing substrate and ownership

| Fact | Canonical owner | P0 use |
| --- | --- | --- |
| Source-capable vs consumer host | `apps/web/lib/install/host-profile.ts` | Keep the existing classifier; project its safe result. |
| Installation purpose, environment, relationships, and brakes | `InstallationOperatingIntentV1`, `InstallationOperatingProfileSnapshot`, `InstanceStanceProfile` | Reuse the intent/snapshot/stance compiler; do not add installation state or a lossy topology label. |
| Organization identity and operating context | `Organization` and the existing MCP organization-context bundle | Project references and bounded summaries; do not copy the corpus. |
| Human and acting-agent identity | existing MCP authentication, `Principal`/`PrincipalAlias`, session and authority decision context | Require both identities and preserve the dual-principal boundary. |
| Token tier and granted actions | MCP token scope/grants and existing `resolveAgentAuthorityTier` | Project the descriptive tier and authority digest; never derive global policy or widen/persist authority. |
| Installation brakes | `InstanceStanceProfile` and its closed `CredentialStance`, `TeardownStance`, `SourceAuthorityStance`, and `PeerWriteStance` registries | Project the current brakes without translating them into permission. |
| Per-work autonomy and action gating | `WorkCasePolicyEnvelope`, Work Case action/source registries, and `evaluateWorkCasePolicy` | State that work policy is unresolved until a governed work context is selected; do not manufacture a global autonomy mode from token tier. |
| Consequence classification | the action-owning registries, including `ConsequenceTier` only where `coordination-proposal.ts` owns that action family | Do not publish a cross-platform allowed-tier list until one canonical consequence registry exists. |
| Tool discovery | core/full tier plus `load_tools` | Put orientation in the core floor and keep all other progressive disclosure behavior. |
| A2A exposure | existing public platform card and access-profile-aware coworker cards | Add one shared compatibility projection; preserve every existing exposure gate. |
| Local discovery pointer | consumer-install pointer template and installer/release projection | Generate from release metadata; application runtime only diagnoses drift. |
| JSON canonicalization | RFC 8785 JSON Canonicalization Scheme | Canonicalize UTF-8 JSON with explicit field removal and set-like array ordering before SHA-256. |
| Release identity | the installer/self-upgrade image identity contract | Keep the OCI/release digest distinct from schema, profile, and authority digests. |

No Prisma migration or new durable table is part of P0. If implementation discovers a fact that cannot be resolved from these owners, it must stop and return to design review rather than introduce parallel persistence.

## 4. Contract

```ts
type ExternalAgentProfileSchemaVersion = "dpf.external-agent-operating-profile/1";
type Sha256Digest = `sha256:${string}`;

type ExternalAgentProfileActiveBrakeCode =
  | "credential-operator-only"
  | "work-policy-unresolved"
  | "source-authority-none"
  | "peer-write-read-only"
  | "teardown-forbidden"
  | "capture-required-before-teardown";

type ExternalAgentProfileInvalidatorCode =
  | "profile-expired"
  | "authority-revoked";

type EntryAvailability =
  | { status: "available"; protocol: "mcp"; tool: string }
  | { status: "available"; protocol: "a2a"; path: string }
  | { status: "deferred"; backlogItemId: string; recovery: string };

type ExternalAgentOperatingProfileV1 = {
  profileDigest: Sha256Digest;
  generatedAt: string;
  installation: {
    instanceId: string;
    environmentClass: "production" | "development" | "test";
    primaryPurpose:
      | "operate-organization"
      | "evolve-dpf"
      | "deliver-managed-services"
      | "grow-channel"
      | "participate-community";
    relationshipIntents: FederationRelationshipPreset[];
    sourceCapable: boolean;
  };
  principal: {
    sessionId: string;
    delegatingPrincipalId: string;
    actingAgentId: string;
    sponsorRef: string;
    tokenTier: "observer" | "employee" | "development" | "admin";
    authorityDigest: Sha256Digest;
    expiresAt: string;
  };
  organization: {
    organizationId: string;
    purposeSummary: string;
    archetypeRef?: string;
    locale: string;
    timezone: string;
  };
  entry: {
    capabilityDiscovery: { status: "available"; protocol: "mcp"; tool: "load_tools" };
    workCatalog: EntryAvailability;
    attention: EntryAvailability;
    agentCard?: EntryAvailability;
  };
  policy: {
    instanceBrakes: {
      credentials: CredentialStance;
      teardown: TeardownStance;
      sourceAuthority: SourceAuthorityStance;
      peerWrite: PeerWriteStance;
    };
    workPolicy: {
      status: "requires-work-context";
      owner: "WorkCasePolicyEnvelope";
      instruction: string;
    };
    activeBrakes: ExternalAgentProfileActiveBrakeCode[];
    invalidatesOn: ExternalAgentProfileInvalidatorCode[];
  };
  compatibility: {
    protocols: Array<"mcp" | "a2a">;
    profileSchema: {
      version: ExternalAgentProfileSchemaVersion;
      digest: Sha256Digest;
      digestAlgorithm: "sha256-rfc8785-v1";
    };
  };
};

type OperatingProfileGetError =
  | { code: "operating_profile_unavailable"; recovery: "reconnect" }
  | { code: "operating_profile_incompatible"; recovery: "request-compatible-client" }
  | { code: "external_agent_not_sponsored"; recovery: "request-sponsorship" }
  | { code: "external_agent_not_authorized"; recovery: "request-authorization" };

type OperatingProfileGetResult =
  | { ok: true; profile: ExternalAgentOperatingProfileV1 }
  | {
      ok: false;
      error: OperatingProfileGetError;
    };
```

The compiler receives already-authenticated principal and authority context plus loaders for installation and organization facts. It returns either the exact profile or a closed typed failure:

- `operating_profile_unavailable` → `reconnect`
- `operating_profile_incompatible` → `request-compatible-client`
- `external_agent_not_sponsored` → `request-sponsorship`
- `external_agent_not_authorized` → `request-authorization`

The discriminated union makes every failure/recovery pair exhaustive and rejects cross-paired values at compile and schema-validation time.

The four digests have separate owners and preimages:

| Digest | Visibility | Preimage |
| --- | --- | --- |
| `compatibility.profileSchema.digest` | MCP, public A2A, pointer | The RFC 8785 canonical UTF-8 bytes of the checked-in V1 JSON Schema object. The schema object contains neither this digest nor release/principal data. `compatibility.profileSchema` is the sole owner of schema version, digest, and digest algorithm. |
| `profileDigest` | Authenticated profile only | The RFC 8785 canonical UTF-8 bytes of the complete profile after removing only `profileDigest`. `generatedAt` and `principal.expiresAt` remain in the preimage, so this identifies the exact response. |
| `authorityDigest` | Authenticated profile only | The RFC 8785 bytes of the exact `AuthorityDigestPreimageV1` below. Token id/version, raw token scopes, and effective grant ids are not returned. Allow-listed `delegatingPrincipalId`, `actingAgentId`, and `sponsorRef` remain explicit authenticated profile fields and are excluded from public A2A output. |
| `releaseImageDigest` | Pointer and release metadata | The OCI/release identity already owned by installer/self-upgrade. It is not a profile or schema digest. |

`sha256-rfc8785-v1` means RFC 8785 JCS, UTF-8 encoding, then SHA-256 rendered as lower-case hexadecimal with the `sha256:` prefix. Object members follow JCS lexical ordering. Arrays whose semantics are sets are sorted by their canonical string id before they enter the canonicalizer; ordered protocol arrays retain declared order.

The authority preimage is not an informal concatenation. Its literal domain tag and closed shape are:

```ts
type AuthorityDigestPreimageV1 = {
  domain: "dpf.external-agent-operating-profile.authority/v1";
  token: {
    id: string;
    version: number;
    scope: string[]; // sorted canonical scope ids
    expiresAt: string;
  };
  sponsorId: string;
  actingAgentId: string;
  effectiveGrantIds: string[]; // sorted canonical grant ids
};
```

The implementation ships three fixed vectors. The first proves the shared JCS/SHA-256 primitive:

```text
canonical bytes: {"compatibility":{"protocols":["a2a","mcp"]},"principal":{"tokenTier":"observer"},"schemaVersion":"dpf.external-agent-operating-profile/1"}
sha256:          c1085222f991336a52915886d41373b8e4f03b98a3b4b1a7ef8cf5a635e5eef2
```

The second proves authority domain separation and set ordering:

```text
canonical bytes: {"actingAgentId":"AGT-TEST","domain":"dpf.external-agent-operating-profile.authority/v1","effectiveGrantIds":["grant:a","grant:z"],"sponsorId":"USR-TEST","token":{"expiresAt":"2030-01-01T00:00:00.000Z","id":"TOK-TEST","scope":["mcp:read","work:read"],"version":3}}
sha256:          f67850ae4da9c41141f2da39d0234141e86311003872b0a85b3107e9fb03f618
```

The third is a complete V1 profile fixture after removing only `profileDigest`. Optional `archetypeRef` and `agentCard` are absent by design; all other V1 fields are present:

```text
canonical bytes: {"compatibility":{"profileSchema":{"digest":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","digestAlgorithm":"sha256-rfc8785-v1","version":"dpf.external-agent-operating-profile/1"},"protocols":["a2a","mcp"]},"entry":{"attention":{"backlogItemId":"BI-D4C110BC","recovery":"Wait for the attention slice.","status":"deferred"},"capabilityDiscovery":{"protocol":"mcp","status":"available","tool":"load_tools"},"workCatalog":{"backlogItemId":"BI-D4C110BC","recovery":"Wait for the work-catalog slice.","status":"deferred"}},"generatedAt":"2030-01-01T00:00:00.000Z","installation":{"environmentClass":"test","instanceId":"INST-TEST","primaryPurpose":"evolve-dpf","relationshipIntents":[],"sourceCapable":false},"organization":{"locale":"en-US","organizationId":"ORG-TEST","purposeSummary":"Test purpose","timezone":"UTC"},"policy":{"activeBrakes":["source-authority-none","work-policy-unresolved"],"instanceBrakes":{"credentials":"local-permitted","peerWrite":"none","sourceAuthority":"none","teardown":"permitted"},"invalidatesOn":["authority-revoked","profile-expired"],"workPolicy":{"instruction":"Resolve a Work Case before action.","owner":"WorkCasePolicyEnvelope","status":"requires-work-context"}},"principal":{"actingAgentId":"AGT-TEST","authorityDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","delegatingPrincipalId":"USR-TEST","expiresAt":"2030-01-01T00:00:00.000Z","sessionId":"SESSION-TEST","sponsorRef":"USR-TEST","tokenTier":"observer"}}
sha256:          e5b358408760dc8ba69a3535361569693c6f349a6ecbc6fdc118af4a7dd7aabd
```

This follows RFC 8785's signature guidance: derive the integrity value from canonical content before adding the integrity property, and remove that property before verification. The profile is immutable for the response lifetime. Refresh recompiles every authority-bearing field; it never extends or copies a previous profile.

The profile contains references and safe summaries. It must not contain bearer tokens, credential material, raw policy documents, full tool definitions, the complete work catalog, private A2A offers, customer records, or error text from lower layers.

### 4.1 Parent-contract refinement

The parent design's §6.1 shape was intentionally provisional. This P0 slice is authoritative for the fields it implements. Every parent field is disposed below; a field not listed here is not silently inherited:

| Parent field | P0 refinement and owner |
| --- | --- |
| `contractVersion` | Replaced by `compatibility.profileSchema.version`, because the value identifies the wire schema rather than a deployment. |
| `contractDigest` | Split into `compatibility.profileSchema.digest`, `profileDigest`, `principal.authorityDigest`, and installer-owned `releaseImageDigest`; no digest is reused across preimages or visibility classes. |
| `installation.instanceId`, `environmentClass`, `primaryPurpose` | Preserved. `sourceCapable` is added from the canonical install host profile; it is not inferred from purpose. |
| `installation.topology` | Replaced by canonical `FederationRelationshipPreset[]` without a lossy label mapping. Cross-install topology is owned by `BI-AE128860`. |
| `principal.sessionId`, `actingAgentId`, `sponsorRef`, `tokenTier`, `authorityDigest`, `expiresAt` | Preserved, with the authority digest preimage closed above. |
| `principal.delegatingUserId` | Renamed to `delegatingPrincipalId`; the authenticated delegator may be a non-user principal, and the identity/authority substrate owns resolution. |
| `organization.organizationId`, `purposeSummary`, `archetypeRef`, `locale`, `timezone` | Preserved as bounded organization context. |
| `organization.operatingProfileRef`, `decisionProfileRef` | Omitted: P0 projects the bounded facts needed for orientation and does not expose unresolved policy-document references. Organization doctrine remains in its canonical WWWD/organization owners. |
| `entry.workCatalogRef`, `attentionRef` | Replaced by availability-tagged `workCatalog` and `attention`; P0 returns `deferred` with owner `BI-D4C110BC` and recovery instead of a dead reference. |
| `entry.surfaceCatalogRef` | Replaced for P0 by the already-resolvable `capabilityDiscovery` entry (`load_tools`). It does not claim a versioned semantic surface catalog. Any future profile-level surface contract is owned through umbrella `BI-9549EE48`, not invented here. |
| `entry.agentCardRef` | Refined to optional availability-tagged `agentCard`; it is emitted only when the existing exposure gate yields a resolvable A2A path. |
| `policy.defaultMode`, `allowedConsequenceTiers`, `confirmationRulesRef`, `egressPolicyRef` | Omitted without canonical global owners. Per-work autonomy and confirmation remain in `WorkCasePolicyEnvelope`. |
| `policy.stopConditions` | Split into `activeBrakes` and `invalidatesOn`. Installation verification is failure-only and cannot appear in a successful profile. |
| `compatibility.protocols` | Preserved. |
| `compatibility.workPacketVersions` | Deferred to `BI-D4C110BC`; P0 emits no version until a Work Packet schema is live. |
| `compatibility.surfaceContractVersions` | Omitted because P0 does not define a versioned surface contract. A future version registry requires an explicit child under `BI-9549EE48`. |

The parent failure codes `external_agent_not_sponsored` and `external_agent_not_authorized` are preserved exactly; P0 does not introduce a second failure taxonomy.

The binding consumer-host design is narrower than the umbrella parent but overlaps this slice. These are its exact dispositions:

| Consumer-host section | P0 disposition |
| --- | --- |
| `Decisions / Agent contract: MCP plus a pointer` | Superseded only where it names initialize prose as behavioral authority and places progressive tool discovery first. MCP initialize remains the bootstrap; the authenticated profile is the behavioral operating contract. |
| `Canonical architecture / Instruction ordering` | Superseded by §6: `operating_profile_get` precedes action and `load_tools`; compatibility prose is generated from the same inputs. |
| `Canonical architecture / Release pointer` | Superseded by §8: the neutral template remains, but the installer generates schema- and release-bound content atomically. |
| acceptance criteria 1–3 | Amended to the generated pointer and profile-first instruction behavior above. |
| upgrade boundary, host-profile classifier, self-upgrade support, owner experience, security/scale, and stray-runtime-file sections | Retained unchanged and still binding. |

### 4.2 Brake and invalidation mapping

`activeBrakes` describes restrictions that are true for the returned profile now. `invalidatesOn` describes future events after which the caller must refresh and the server independently rechecks authority. The compiler applies this closed mapping and lexically sorts emitted codes:

| Canonical input | Active brake |
| --- | --- |
| `credentials = operator-only` | `credential-operator-only` |
| `credentials = local-permitted` | none |
| `teardown = forbidden` | `teardown-forbidden` |
| `teardown = capture-required` | `capture-required-before-teardown` |
| `teardown = permitted` | none |
| `sourceAuthority = none` | `source-authority-none` |
| `sourceAuthority = governed-worktree` | none |
| `peerWrite = read-only` | `peer-write-read-only` |
| `peerWrite = governed-write` or `none` | none |
| no selected Work Case policy | `work-policy-unresolved` |

Every successful profile includes `authority-revoked` and `profile-expired` in `invalidatesOn`. These are not asserted to be active. Missing or contradictory installation identity is not a brake: the compiler returns `operating_profile_unavailable`, so `installation-unverified` is not part of either successful-profile registry.

## 5. Compiler allocation

Add one pure contract/compiler seam under the agent-host boundary. Existing install and MCP modules become adapters into it rather than reimplementing host, tier, or stance logic.

The compiler must:

1. require a resolved installation identity and environment class;
2. require organization, sponsor, delegating principal, and acting agent;
3. derive token tier through the existing authority-tier function;
4. compute schema, profile, and authority digests from their separate preimages, consume release identity only in the installer-owned pointer projection, and never expose token id/version, raw scopes, or effective grant ids;
5. project the existing relationship-intent registry unchanged, map installation stance to `ExternalAgentProfileActiveBrakeCode`, attach the closed `ExternalAgentProfileInvalidatorCode` refresh events, and return an `OperatingProfileGetError` for failure-only states;
6. mark `workCatalog` and `attention` as `deferred` to `BI-D4C110BC` until their authenticated targets exist, while advertising the already-resolvable `load_tools` capability entry;
7. omit `agentCard` when no access-appropriate card route is resolvable, and otherwise emit only the route already selected by the A2A exposure owner;
8. keep work and surface inventories out of the profile;
9. return a typed failure if an authority-bearing input is missing or contradictory.

The compiler is pure over an explicit input DTO. Database, install-state, and authentication reads stay in a separate loader so unit tests can prove the projection without process or database fixtures.

The allocation is deterministic:

| Output | Exact source | Missing-source behavior |
| --- | --- | --- |
| installation identity/environment | installer state plus `InstallationOperatingProfileSnapshot` | `operating_profile_unavailable`; never infer a non-production environment. |
| purpose/relationships | `InstallationOperatingIntentV1.primaryPurpose` and its canonical `FederationRelationshipPreset[]` | reject malformed values through the existing intent validator; cross-install topology remains deferred to `BI-AE128860`. |
| installation brakes | `InstanceStanceProfile` closed registries | preserve the cautious resolved stance. |
| sponsor/delegating/acting identity | authenticated MCP context and canonical `Principal`/`PrincipalAlias` resolution | `external_agent_not_sponsored` or `operating_profile_unavailable`; never use caller arguments. |
| token tier | `resolveAgentAuthorityTier` over server-resolved scope/grants | `external_agent_not_authorized`. Tier is descriptive and does not create allowed actions. |
| work autonomy/confirmation | `WorkCasePolicyEnvelope` after a work context is selected | emit `requires-work-context` and `work-policy-unresolved`; no global default is guessed. |
| consequence gating | action/source registries and the work policy evaluator at action time | no allowed-tier projection in P0. Existing `ConsequenceTier` remains local to the coordination action family until a universal registry exists. |
| organization summary/locale | the existing organization-context bundle and locale resolver | `operating_profile_unavailable` when organization identity or locale is absent. |
| egress policy | no canonical universal owner found in P0 substrate | omitted. Adding it requires a reviewed owner rather than a nullable invented reference. |

There is no umbrella stop-code registry. `ExternalAgentProfileActiveBrakeCode` owns current cautious restrictions, `ExternalAgentProfileInvalidatorCode` owns future refresh events, and `OperatingProfileGetError` owns failure-only code/recovery pairs. Each value is derived from a specific source row above. Additional human-readable explanation may be formatted at the MCP edge from the typed value, but it is not part of the authority calculation.

## 6. MCP entry

Add `operating_profile_get` as a read-only immediate tool with no side effect, an input schema with no caller-selectable authority fields, and a bounded output schema for `OperatingProfileGetResult`. It is available only to authenticated callers and is included in `CORE_MCP_TOOL_NAMES`. The handler returns the profile in MCP `structuredContent` and repeats its serialized form in one text block for backwards compatibility, matching the MCP 2025-06-18 tool-result contract.

`initialize` remains the MCP bootstrap transport, while the principal-bound profile is the behavioral operating source of truth. Its concise instructions change from “discover arbitrary tools first” to:

1. fetch `operating_profile_get` before business or platform action;
2. obey its active brakes, compatibility result, and refresh invalidators;
3. use `load_tools` only after orientation identifies the relevant capability.

Existing host and organization instruction blocks remain during rollout for clients that do not call the profile tool. They are compatibility hints, not a second contract. Their shared facts must be formatted from the same compiler inputs or existing canonical adapters.

This section mechanically supersedes only the agent-contract, instruction-ordering, release-pointer, and corresponding acceptance-criterion text in `2026-08-22-consumer-agent-host-design.md`; that document's self-upgrade support projection and all unrelated decisions remain binding. The amended host document carries the same disposition at its affected sections.

The tool handler must not accept caller-supplied organization, sponsor, acting-agent, token-tier, or installation fields. Those are resolved from authenticated server context.

## 7. A2A projection

Introduce one shared A2A 0.3 `AgentExtension` projection:

```ts
type ExternalAgentOperatingProfileExtension = {
  uri: "urn:dpf:a2a:extension:external-agent-operating-profile:v1";
  description: "Authenticated DPF external-agent orientation compatibility";
  required: false;
  params: {
    profileSchema: {
      version: "dpf.external-agent-operating-profile/1";
      digest: `sha256:${string}`;
      digestAlgorithm: "sha256-rfc8785-v1";
    };
    discovery: {
      authenticated: true;
      protocol: "mcp";
      tool: "operating_profile_get";
      endpoint: {
        resolution: "agent-card-origin";
        path: "/api/mcp/v1";
      };
    };
  };
};
```

The extension is appended to `A2aAgentCard.capabilities.extensions`; no new top-level Agent Card field is introduced. Both public platform cards and access-profile-aware coworker cards carry the same extension only when they already pass their current exposure gates. Extension-unaware A2A clients ignore it because `required` is `false`.

The `params` object is an explicit allow-list. It contains only `profileSchema` and `discovery`, projected from the same constants and route owner as the authenticated profile. It must not contain `profileDigest`, `authorityDigest`, release identity, organization identity or purpose, sponsor or acting-agent identity, work, active brakes, invalidators, grants, or private capability/offer inventory. Negative tests serialize the public card and assert those field names and representative private values are absent.

`agent-card-origin` is a normative resolution rule: parse the already-served Agent Card URL, keep only its scheme and authority, and resolve the exact absolute path `/api/mcp/v1` on that origin. Query, fragment, and A2A transport path are discarded. The path is the canonical DPF MCP route constant, not free text from a card author. Projection tests cover direct origin, reverse-proxy HTTPS origin, a card below a nested A2A path, and rejection of any non-canonical path. This makes the advertised authenticated discovery location resolvable without treating the Agent Card's A2A transport URL as an MCP endpoint.

Authenticated A2A task and offer routes do not gain authority from the advertisement. Their existing access profile, GAID, terms, data-boundary, and grant checks remain authoritative.

## 8. Generated pointer and drift

The release/installer projection owns the install-local pointer. Its required fields are:

- runtime-install warning;
- MCP configuration/discovery location;
- `operating_profile_get` entry instruction;
- supported profile schema version projected from `compatibility.profileSchema.version`;
- schema digest projected from `compatibility.profileSchema.digest`;
- digest algorithm projected from `compatibility.profileSchema.digestAlgorithm`;
- installer-owned `releaseImageDigest` for the deployed OCI/release bytes;
- recovery guidance;
- stop rule for missing, malformed, unavailable, or incompatible served contracts.

The pointer never contains a principal-bound `profileDigest` or `authorityDigest`. Generation is atomic and deterministic for a release. Application code reports:

- `current` when the pointer's three schema identity fields equal the single `compatibility.profileSchema` constant and its release-image digest equals the runtime's canonical release identity;
- `stale` when the pointer parses but either identity differs;
- `missing` when the file does not exist; and
- `malformed` when required fields, digest prefixes/lengths, or schema version are invalid.

Application code must not rewrite host files from an HTTP or MCP request. Repair goes through the governed installer/self-upgrade owner.

The served authenticated profile always wins. A correct local pointer cannot make an unavailable or incompatible profile actionable.

## 9. Failure, privacy, and rollback

- Profile loading fails closed for action orientation. Compatibility initialize prose may still render, but it must direct the client to stop rather than infer authority.
- Safe failures name the missing contract class and one recovery action; they do not include database, filesystem, credential, or policy internals.
- Public A2A output is allow-listed and receives negative tests for private profile fields.
- Authority revocation or token expiry invalidates the next refresh and any later action independently of a previously returned profile.
- Rollback removes the core tool advertisement and restores the prior initialize wording. It leaves installation intent, organization records, tokens, A2A cards, and runtime business records unchanged.

## 10. Scale envelope

P0 guarantees that profile response size and compiler work are independent of tool count, work-item count, coworker count, and customer-record count. It loads one installation snapshot, one organization projection, and one authenticated authority context. Deferred inventories are represented by constant-size availability records, not fabricated catalog references. Any collection included in the profile is a small closed registry or a bounded authority summary with deterministic ordering.

P0 does not claim cross-install fan-out, Work Packet throughput, lease throughput, or fleet-wide profile materialization. `EP-1FABA22D` lifts those ceilings through the named work/concurrency and topology/federation child slices (`BI-D4C110BC`, `BI-AE128860`) and the convergence stream (`BI-F509CC59`). No fixed `take` limit may silently truncate an authoritative list; a future list must be cursor-paged or return an explicit incomplete result.

## 11. Test-first delivery

Write failing tests before production changes for:

1. pure compilation for all four token tiers;
2. missing/contradictory identity and authority inputs plus exhaustive rejection of every invalid failure-code/recovery cross-pair;
3. RFC 8785 primitive, authority-preimage, and complete-profile vectors; separation of all four digest identities; exact profile-integrity field removal; and secret-field absence;
4. MCP tool definition and output schema, authenticated context resolution, core-tier listing, backwards-compatible text plus structured content, and bounded result;
5. initialize instructions pointing to the profile before `load_tools`, plus conformance with the mechanically amended consumer-host contract;
6. exhaustive stance-to-`activeBrakes` mapping, `invalidatesOn` behavior, failure-only unverified installation, `requires-work-context` behavior, and absence of invented autonomy/consequence/egress policy;
7. `available`/`deferred` entry projection with no syntactically valid dead reference;
8. public and authenticated A2A `capabilities.extensions` parity, origin-relative canonical MCP endpoint resolution, extension-unaware compatibility, and negative private-field assertions;
9. pointer generation from the sole `profileSchema` constants and `current`/`stale`/`missing`/`malformed` comparison across schema and release identities;
10. compatibility with existing host-profile, instance-stance, org-context, and card tests.

The exact branch commit then runs the change-impact contract, focused tests, guards, web typecheck, production build, and source-free runtime verification. Runtime verification must prove a real MCP client sees the profile before broad discovery and that public Agent Cards still contain no private context.

## 12. Research and benchmarking

This slice inherits the product/agent-runtime comparisons in the parent design and makes three implementation-level standards choices:

| Reference | Adopt | Reject |
| --- | --- | --- |
| [MCP 2025-06-18 lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle) and [tools contract](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) | Keep `initialize` protocol-compatible, advertise the tool capability, put the orientation tool in DPF's already-existing lean core, and return schema-validated `structuredContent` plus a compatibility text block. | A proprietary pre-initialize request or an untyped prose-only profile. |
| [A2A 0.3 AgentCapabilities and AgentExtension](https://a2a-protocol.org/v0.3.0/specification/#552-agentcapabilities-object) | Use the standard optional `capabilities.extensions` array, a stable URI identifier, `required: false`, and a typed allow-listed `params` object. | A DPF-only top-level Agent Card field or public principal-bound content. |
| [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html) and its open reference implementations | Use JCS over UTF-8, remove the integrity property before hashing, domain-separate schema/profile/authority inputs, and ship fixed vectors. | Ad hoc recursive key sorting, `JSON.stringify` as an undocumented wire algorithm, or one digest reused for schema, response, authority, and release identity. |

The existing DPF `WorkCasePolicyEnvelope` is preferred over importing a second agent-policy engine. The existing A2A coordination `ConsequenceTier` remains local to its action family; P0 does not promote it into a universal policy registry without a separate substrate decision.

## 13. Architecture review outcome

The independent review of `af2f4085198a` returned **revise / do not approve**. This revision disposes every finding:

| Finding | Disposition |
| --- | --- |
| self-referential and conflated digest | split four digest identities; remove only `profileDigest` from its own RFC 8785 preimage; publish fixed bytes/hash vector. |
| no standards-compliant A2A placement | place one optional, URI-identified extension in `capabilities.extensions` with an exact safe `params` allow-list. |
| policy fields lacked canonical owners | project only `InstanceStanceProfile` brakes; preserve `WorkCasePolicyEnvelope` as the per-work owner; omit unowned consequence and egress claims. |
| mandatory references targeted deferred capabilities | replace them with constant-size availability unions and point deferral to the owning live BIs. |
| child vocabulary drifted from the parent | add the §4.1 refinement table and preserve the parent failure codes. |

The independent re-review of `02d4847ad95e` also returned **revise / do not approve**. This revision disposes its findings:

| Finding | Disposition |
| --- | --- |
| binding consumer-host contract disagreed | mechanically amend only its agent-contract, instruction-ordering, release-pointer, and corresponding acceptance text; record exact retained/superseded sections in §4.1. |
| schema identity had two homes | make `compatibility.profileSchema` the sole version/digest/algorithm owner and project A2A and pointer values from it. |
| public A2A discovery was not resolvable | advertise the canonical `/api/mcp/v1` path with an exact Agent Card origin-resolution rule and proxy/nested-path tests. |
| parent refinement was incomplete | disposition every §6.1 parent field, including delegator, surface, Work Packet, and surface-contract fields, with an owner or explicit omission. |
| `stopConditions` conflated state classes | split current `activeBrakes` from future `invalidatesOn`, map every canonical stance value, and make unverified installation a compile failure. |
| authority domain separation lacked an exact preimage | define the literal domain tag and preimage schema and add primitive, authority, and complete-profile fixed vectors. |

The independent review of `19552b0849c2` returned **revise / do not approve** on three residual taxonomy statements. This revision disposes them:

| Finding | Disposition |
| --- | --- |
| stale generic stop-code owner | remove the undefined umbrella registry and name the active-brake, invalidator, and failure owners independently. |
| failure code/recovery cross-product | replace independent unions with one exhaustive discriminated `OperatingProfileGetError` union and require negative cross-pair tests. |
| privacy statement contradicted returned principal refs | name only token id/version, raw scopes, and effective grant ids as hidden preimage fields; retain allow-listed authenticated principal refs and keep them out of public A2A. |

The revised design extends the existing install, authority, Work Case policy, MCP tier, and A2A extension seams and adds no persistence. The profile is a read model with one compiler, while durable facts remain in their canonical owners. Schema, profile, authority, and release identities have non-overlapping preimages and visibility. Response size is bounded independently of estate and tool cardinality. Deferred entries cannot masquerade as live references. The local pointer is a release projection and never a second authority.

Independent spec approval remains required before implementation. The approval must pin this exact repository artifact and create the `initiative_scope_baseline` for `BI-11D611B3`; an implementation claim must be retried after that baseline exists.
