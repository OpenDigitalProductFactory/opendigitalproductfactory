---
status: draft
---

# Principal-bound External Agent Operating Profile Design

**Date:** 2026-08-23

**Status:** Ready for independent spec review

**Backlog:** `BI-11D611B3`

**Epic:** `EP-1FABA22D`

**Parent design:** `docs/superpowers/specs/2026-08-22-external-agent-operating-contract-design.md`

**Extends:**

- `docs/superpowers/specs/2026-08-22-consumer-agent-host-design.md`
- `docs/superpowers/specs/2026-08-22-installation-identity-and-agent-stance-design.md`
- `docs/superpowers/specs/2026-05-09-deployment-contracts.md`, especially Contracts 4, 9, 10, and 12

## 1. Decision

DPF will expose one versioned, principal-bound `ExternalAgentOperatingProfile` as the authenticated orientation contract for source-free installations. The profile is a short-lived projection compiled from existing installation, principal, token, organization, policy, and compatibility authorities. It is not a new persisted business record.

The MCP bootstrap will list `operating_profile_get` in the lean core before broad tool discovery. Public A2A Agent Cards will advertise only contract compatibility and the authenticated discovery location; they will not disclose the profile, organization doctrine, private work, grants, or private capabilities. The generated install-local pointer will name the deployed contract version and digest and will stop clients when the served contract is unavailable or incompatible.

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
| AC-P0-02 | OBJ-P0-AUTHORITY | Observer, employee, development, and admin test authorities produce different policy projections from one pure compiler, and no projection contains bearer secrets or an unfiltered grant inventory. |
| AC-P0-03 | OBJ-P0-AUTHORITY | Missing sponsor, acting-agent identity, organization, authority, expiry, or installation identity returns a typed unavailable result and never a guessed privileged profile. |
| AC-P0-04 | OBJ-P0-PROTOCOL | MCP and A2A compatibility metadata use the same contract-version constants and digest algorithm. |
| AC-P0-05 | OBJ-P0-PROTOCOL | Public Agent Cards expose only safe contract compatibility and an authenticated discovery reference; private organization context, work, authority, and capability inventory remain absent. |
| AC-P0-06 | OBJ-P0-POINTER | The generated pointer states runtime-not-source, MCP discovery, contract version, deployed digest, recovery guidance, and the stop rule for unavailable or incompatible served contracts. |
| AC-P0-07 | OBJ-P0-POINTER | Pointer comparison distinguishes current, stale, missing, and malformed states without treating the pointer as authority or mutating installed runtime files from application request handlers. |
| AC-P0-08 | OBJ-P0-COMPATIBILITY | Existing initialize instructions and organization context remain available as compatibility guidance, while instructing capable clients to fetch the operating profile before acting. |
| AC-P0-09 | OBJ-P0-COMPATIBILITY | Focused unit, MCP route, A2A projection, pointer-generation, guard, typecheck, production-build, and source-free runtime verification pass on the exact branch commit. |

## 3. Existing substrate and ownership

| Fact | Canonical owner | P0 use |
| --- | --- | --- |
| Source-capable vs consumer host | `apps/web/lib/install/host-profile.ts` | Keep the existing classifier; project its safe result. |
| Installation purpose, environment, topology, and brakes | `InstallationOperatingIntentV1`, `InstallationOperatingProfileSnapshot`, `InstanceStanceProfile` | Reuse the snapshot/stance compiler; do not add installation state. |
| Organization identity and operating context | `Organization` and the existing MCP organization-context bundle | Project references and bounded summaries; do not copy the corpus. |
| Human and acting-agent identity | existing MCP authentication, `Principal`/`PrincipalAlias`, session and authority decision context | Require both identities and preserve the dual-principal boundary. |
| Token tier and granted actions | MCP token scope/grants and existing `resolveAgentAuthorityTier` | Derive policy summaries; never widen or persist authority. |
| Tool discovery | core/full tier plus `load_tools` | Put orientation in the core floor and keep all other progressive disclosure behavior. |
| A2A exposure | existing public platform card and access-profile-aware coworker cards | Add one shared compatibility projection; preserve every existing exposure gate. |
| Local discovery pointer | consumer-install pointer template and installer/release projection | Generate from release metadata; application runtime only diagnoses drift. |

No Prisma migration or new durable table is part of P0. If implementation discovers a fact that cannot be resolved from these owners, it must stop and return to design review rather than introduce parallel persistence.

## 4. Contract

```ts
type ExternalAgentOperatingProfileV1 = {
  schemaVersion: "dpf.external-agent-operating-profile/1";
  contractDigest: `sha256:${string}`;
  generatedAt: string;
  expiresAt: string;
  installation: {
    instanceId: string;
    environmentClass: "production" | "development" | "test";
    primaryPurpose:
      | "operate-organization"
      | "evolve-dpf"
      | "deliver-managed-services"
      | "grow-channel"
      | "participate-community";
    topology: "local" | "same-org" | "managed-estate" | "sovereign-peer" | "hive";
    sourceCapable: boolean;
  };
  principal: {
    sessionId: string;
    delegatingPrincipalId: string;
    actingAgentId: string;
    sponsorRef: string;
    tokenTier: "observer" | "employee" | "development" | "admin";
    authorityDigest: `sha256:${string}`;
  };
  organization: {
    organizationId: string;
    purposeSummary: string;
    archetypeRef?: string;
    operatingProfileRef?: string;
    decisionProfileRef?: string;
    locale: string;
    timezone: string;
  };
  entry: {
    workCatalogRef: string;
    surfaceCatalogRef: string;
    attentionRef: string;
    agentCardRef?: string;
  };
  policy: {
    defaultMode: "observed" | "supervised" | "autonomous";
    allowedConsequenceTiers: string[];
    confirmationRulesRef: string;
    stopConditions: string[];
    egressPolicyRef?: string;
  };
  compatibility: {
    protocols: Array<"mcp" | "a2a">;
    workPacketVersions: string[];
    surfaceContractVersions: string[];
  };
};
```

The compiler receives already-authenticated principal and authority context plus loaders for installation and organization facts. It returns either the exact profile or a closed typed failure:

- `operating_profile_unavailable`
- `operating_profile_not_sponsored`
- `operating_profile_not_authorized`
- `operating_profile_incompatible`

The digest is computed over canonical JSON after excluding `generatedAt` and `expiresAt`. The profile is immutable for the response lifetime. Refresh recompiles every authority-bearing field; it never extends or copies a previous profile.

The profile contains references and safe summaries. It must not contain bearer tokens, credential material, raw policy documents, full tool definitions, the complete work catalog, private A2A offers, customer records, or error text from lower layers.

## 5. Compiler allocation

Add one pure contract/compiler seam under the agent-host boundary. Existing install and MCP modules become adapters into it rather than reimplementing host, tier, or stance logic.

The compiler must:

1. require a resolved installation identity and environment class;
2. require organization, sponsor, delegating principal, and acting agent;
3. derive token tier through the existing authority-tier function;
4. compute an authority digest from stable, sorted authority identifiers rather than expose the identifiers themselves;
5. map installation intent/stance to primary purpose, topology, and stop conditions;
6. emit stable, authorization-preserving entry references;
7. keep work and surface inventories out of the profile;
8. return a typed failure if an authority-bearing input is missing or contradictory.

The compiler is pure over an explicit input DTO. Database, install-state, and authentication reads stay in a separate loader so unit tests can prove the projection without process or database fixtures.

## 6. MCP entry

Add `operating_profile_get` as a read-only immediate tool with no side effect and a bounded result. It is available only to authenticated callers and is included in `CORE_MCP_TOOL_NAMES`.

`initialize` remains protocol-compatible. Its concise instructions change from “discover arbitrary tools first” to:

1. fetch `operating_profile_get` before business or platform action;
2. obey its stop conditions and compatibility result;
3. use `load_tools` only after orientation identifies the relevant capability.

Existing host and organization instruction blocks remain during rollout for clients that do not call the profile tool. They are compatibility hints, not a second contract. Their shared facts must be formatted from the same compiler inputs or existing canonical adapters.

The tool handler must not accept caller-supplied organization, sponsor, acting-agent, token-tier, or installation fields. Those are resolved from authenticated server context.

## 7. A2A projection

Introduce a small shared compatibility projection:

```ts
type ExternalAgentContractAdvertisement = {
  profileVersions: ["dpf.external-agent-operating-profile/1"];
  profileDiscovery: { authenticated: true; protocol: "mcp"; tool: "operating_profile_get" };
  profileDigestAlgorithm: "sha256-canonical-json-v1";
};
```

Both public platform cards and access-profile-aware coworker cards may carry that advertisement. It is capability metadata, not the principal-bound profile. Public routes continue to apply their current allow-lists and expose no organization purpose, work, grants, stop conditions, authority digest, or private offer inventory.

Authenticated A2A task and offer routes do not gain authority from the advertisement. Their existing access profile, GAID, terms, data-boundary, and grant checks remain authoritative.

## 8. Generated pointer and drift

The release/installer projection owns the install-local pointer. Its required fields are:

- runtime-install warning;
- MCP configuration/discovery location;
- `operating_profile_get` entry instruction;
- supported profile schema version;
- deployed image/release digest;
- recovery guidance;
- stop rule for missing, malformed, unavailable, or incompatible served contracts.

Generation is atomic and deterministic for a release. Application code may compare the installed pointer metadata with served release metadata and report `current`, `stale`, `missing`, or `malformed`; it must not rewrite host files from an HTTP or MCP request. Repair goes through the governed installer/self-upgrade owner.

The served authenticated profile always wins. A correct local pointer cannot make an unavailable or incompatible profile actionable.

## 9. Failure, privacy, and rollback

- Profile loading fails closed for action orientation. Compatibility initialize prose may still render, but it must direct the client to stop rather than infer authority.
- Safe failures name the missing contract class and one recovery action; they do not include database, filesystem, credential, or policy internals.
- Public A2A output is allow-listed and receives negative tests for private profile fields.
- Authority revocation or token expiry invalidates the next refresh and any later action independently of a previously returned profile.
- Rollback removes the core tool advertisement and restores the prior initialize wording. It leaves installation intent, organization records, tokens, A2A cards, and runtime business records unchanged.

## 10. Scale envelope

P0 guarantees that profile response size and compiler work are independent of tool count, work-item count, coworker count, and customer-record count. It loads one installation snapshot, one organization projection, and one authenticated authority context; inventories remain behind paged catalog references. Any collection included in the profile is a small closed registry or a bounded authority summary with deterministic ordering.

P0 does not claim cross-install fan-out, Work Packet throughput, lease throughput, or fleet-wide profile materialization. `EP-1FABA22D` lifts those ceilings through the named work/concurrency and topology/federation child slices (`BI-D4C110BC`, `BI-AE128860`) and the convergence stream (`BI-F509CC59`). No fixed `take` limit may silently truncate an authoritative list; a future list must be cursor-paged or return an explicit incomplete result.

## 11. Test-first delivery

Write failing tests before production changes for:

1. pure compilation for all four token tiers;
2. missing/contradictory identity and authority inputs;
3. stable digest canonicalization and secret-field absence;
4. MCP tool definition, authenticated context resolution, core-tier listing, and bounded result;
5. initialize instructions pointing to the profile before `load_tools`;
6. public and authenticated A2A advertisement parity plus negative private-field assertions;
7. pointer generation and `current`/`stale`/`missing`/`malformed` comparison;
8. compatibility with existing host-profile, instance-stance, org-context, and card tests.

The exact branch commit then runs the change-impact contract, focused tests, guards, web typecheck, production build, and source-free runtime verification. Runtime verification must prove a real MCP client sees the profile before broad discovery and that public Agent Cards still contain no private context.

## 12. Architecture review outcome

The design extends the existing install, authority, MCP tier, and A2A projection seams and adds no persistence. The profile is a read model with one compiler, while durable facts remain in their canonical owners. Response size is bounded independently of estate and tool cardinality. The local pointer is a release projection and never a second authority.

Independent spec approval remains required before implementation. The approval must pin this exact repository artifact and create the `initiative_scope_baseline` for `BI-11D611B3`; an implementation claim must be retried after that baseline exists.
