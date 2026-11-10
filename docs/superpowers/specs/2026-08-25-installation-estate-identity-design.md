---
status: draft
---

# Installation Estate Identity, Badge, MCP Self-Identification, and Peer Pre-Fill

| Field | Value |
| --- | --- |
| Date | 2026-08-25 |
| Epic | `EP-1FABA22D` (purpose-aware installation) |
| Backlog | `BI-7626A660`, `BI-C7151B1B`, `BI-6052C2C2`, `BI-06005FE0` |
| Workroom | `WC-DF6943D2` |
| Surface | Shell header, workspace home, `/ops`, MCP initialize, federation discovery, copy |
| Related | `2026-08-22-installation-identity-and-agent-stance-design.md`; `2026-08-23-zero-touch-organization-federation-design.md` (binding); `2026-08-06-federation-zero-shell-autodiscovery-increment.md`; `2026-08-07-federation-discovery-pairing-redesign.md` |

## 1. Decision

An installation shall carry a **name of its own** — an estate identifier naming
who operates it, plus the operational role it already declares — and that pair
shall be the single value rendered wherever an operator or an agent needs to know
*which box they are on*.

The estate identifier is **not** new substrate. It sources
`OrganizationTrustAnchor.organizationRef`, a field the binding zero-touch
federation design already defined, already refuses on
(`organization-ref-mismatch`), and which no code currently populates.

## 2. The observation

Five defects were reported together on 2026-08-25. They are one defect wearing
five hats: **an installation has no identity of its own, so every surface that
needs one either invents a description or says nothing.**

| Reported as | Actual cause |
| --- | --- |
| Identity panel eats the workspace front page | Nothing compact enough to put in the header, so the whole panel is the disclosure |
| MCP cannot tell two installs apart | `serverInfo.name` is the constant `"dpf-platform"`; nothing distinguishes two installs of one organization |
| Pairing needs typed URLs and pasted tokens | Discovery is built but inert; and a discovered peer has no *name* to show |
| LDAP status unclear | Separate program, correctly deferred; see section 9 |
| Copy reads as odd self-declaration | The readability gate rewards fragments; identity copy is the worst-hit surface |

### Verified live state (this install, 2026-08-25)

- `PlatformConfig` holds `installation.environment-class.v1` and
  `installation.operating-intent.v1`. Neither carries a name.
  `pairedProductionInstallationRef` names the *other* install, not this one.
- Host name is `DESKTOP-A290QNG`, so auto-derivation yields nothing an operator
  would recognise.
- `EdgeNode` = 0 rows. `EdgeNodeCapability` = 0 rows. No edge service in the
  running compose project.
- `FederationLink` = 0, `FederationPairingSession` = 0,
  `FederationIntroductionCandidate` = 0.
- No `federation.identity` `PlatformConfig` row: this install has never minted the
  Ed25519 device ID that `lib/federation/instance-identity.ts` implements.
- `evaluateOrganizationEnrollment` has **zero production callers**. The
  auto-enrolment decision core shipped as a pure function wired to nothing.

## 3. Why estate identity is not `Organization`

`AGENTS.md` section 8 makes `Organization` the canonical platform identity model
and forbids a parallel store. This design does not create one, and the distinction
is load-bearing rather than cosmetic:

- `Organization` is **the business the installation runs**. On this install that is
  Second Chance Animal Rescue.
- The estate identifier is **who operates the installation**. On this install that
  is Northwind.

They coincide on a company running its own single production install, and they
diverge in exactly the cases DPF already models. An MSP operating fifty customer
installs is one estate and fifty organizations —
`FEDERATION_RELATIONSHIP_PRESETS` already separates `same-organization` from
`service-provider` for precisely this reason. A dev/prod pair is one estate, and
the dev install may carry a demo organization that the production install does
not.

The estate identifier is therefore the **name of the federation trust root**, which
is what `OrganizationTrustAnchor.organizationRef` already is. Sourcing that field
is convergence, not a second home.

## 4. Research and benchmarking

Every system that lets one operator hold several installations solves this with
the same two-part shape: a **fleet/trust-root name** plus a **per-node name**, both
visible in the client and both carried by discovery.

| System | Fleet identity | Node identity | Where a human sees it | DPF decision |
| --- | --- | --- | --- | --- |
| [Syncthing](https://docs.syncthing.net/dev/device-ids) | introducer-rooted cluster | Device name, editable; device ID is a cert hash | Device name in UI, device ID for equality | **Adopt both halves.** Name for humans, `did_` fingerprint for equality — DPF already has the fingerprint. |
| [Tailscale](https://tailscale.com/kb/1136/tailnet) | Tailnet name, org-level | Machine name, auto-suggested then editable | `machine.tailnet.ts.net` | **Adopt the pairing.** Estate is the tailnet; role plus name is the machine. |
| [HashiCorp Consul](https://developer.hashicorp.com/consul/docs/agent/config/config-files) | `datacenter` | `node_name` | Every API response and the UI | **Adopt the precedent** that the fleet name travels in the discovery payload, which is what makes pre-fill possible. |
| [Kubernetes kubeconfig](https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/) | Cluster name | Context name | Shell prompt integrations such as `kube-ps1` exist *because* acting on the wrong cluster is the classic failure | **Adopt the lesson**, not the mechanism: the guard against wrong-box action is a persistent, always-visible, low-cost indicator. |
| [MCP specification](https://modelcontextprotocol.io/specification) | not applicable | `serverInfo.name` and `title` | Client connector list | **Adopt:** `serverInfo` is the designated slot, and DPF currently wastes it on a constant. |

**Rejected:**

- *Deriving the name from the host name.* Yields `DESKTOP-A290QNG`; it also
  changes when a machine is renamed, which would silently break an identity an
  operator reasons about.
- *Deriving it from `Organization.name`.* Wrong for the MSP and dev/prod cases in
  section 3, and it would make the badge on this install read "Second Chance
  Animal Rescue DEV", which names the tenant rather than the operator.
- *A new `Installation` table.* The two facts are single-row installation
  configuration. `PlatformConfig` already holds the environment class and the
  operating intent with a working precedence chain; a table would add migration
  cost and a second identity home for no gained capability.
- *A `kube-ps1`-style always-on banner including production.* The founder's
  requirement is the inverse, and it is better security ergonomics: production is
  the unmarked default, and every deviation is marked. A badge that is always
  present stops being read.

## 5. Contracts

### 5.1 Estate identity record

New `PlatformConfig` key `installation.estate-identity.v1`:

```ts
interface InstallationEstateIdentityV1 {
  schemaVersion: 1;
  /** Operator-facing name of the estate that runs this install, e.g. "Northwind". */
  estateName: string;
  /** How the value arrived. Discovery pre-fill is still operator-confirmed. */
  source: "operator" | "installer" | "discovered-peer" | "organization-join";
  declaredAt: string;
  declaredByPrincipalId?: string;
}
```

Validation: 1 to 48 characters, matching `/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,47}$/`.
The grammar is deliberately narrower than a display string because the value is
slugified into `serverInfo.name` and published in an mDNS TXT record.

**Precedence**, mirroring `environment-class-contract` exactly so the two halves of
the badge cannot disagree about where authority lives:

```
process env override -> installer state -> portal declaration -> unset
```

`unset` is a first-class state, not an error. An install with no estate name shows
a role-only badge and states plainly that nobody has named it.

### 5.2 Resolved installation identity

One server-side resolver, `resolveInstallationIdentity()`, returns the value every
surface reads. No surface re-derives either half:

```ts
interface ResolvedInstallationIdentity {
  estateName: string | null;
  environmentClass: InstallationEnvironmentClass;
  /** True only for `production`. Drives whether the badge renders at all. */
  isProduction: boolean;
  /** `did_ab12...9f0c`, or null before the keypair is minted. */
  shortDeviceId: string | null;
}
```

### 5.3 Badge

Rendered in `components/shell/Header.tsx`, on the logo line, **only when
`isProduction` is false**:

| Estate | Role | Badge |
| --- | --- | --- |
| `Northwind` | development | `NORTHWIND DEV` |
| `Northwind` | test | `NORTHWIND TEST` |
| unset | development | `DEV` |
| any | production | nothing |

`Header.tsx` is a `"use client"` component. The resolved value therefore arrives
as a prop from the server layout. Importing the resolver into the header would
drag `node:fs/promises` into the client chunk and break the production build —
the failure documented at the head of
`lib/installation-journey/identity-presentation.ts`, and one that only
`pnpm --filter web build` catches.

### 5.4 Full detail moves to `/ops/installation`

`InstallationIdentityPanel` leaves the workspace home. The badge links to it.

Noted as accepted debt at the founder's direction: `/ops` has accumulated enough
routes that navigation needs a pass. This design adds one more rather than
blocking on that refactor, and records the debt rather than hiding it.

### 5.5 MCP self-identification

`buildMcpInitializeResult` stops returning a constant:

- `serverInfo.name` becomes `dpf-<estate-slug>-<role>`, for example
  `dpf-northwind-dev`, falling back to `dpf-<role>` and then `dpf-platform` when
  the estate is unset, so a client listing two connectors shows two names.
- `serverInfo.title` carries the human form: `Northwind DEV`.
- The stance briefing gains one line before the existing identity line:
  `INSTALLATION: Northwind DEV (did_ab12...9f0c).`

The device ID is the equality-safe discriminator; the name is for humans. This is
the Syncthing split, applied to the one field MCP already reserves for it.

**Identity must resolve without a federation call.** Today the keypair is minted
lazily by `demand-identity.ts` on first federation read, which is why this install
has none. Minting moves to install and first boot, so the handshake can always
state it.

### 5.6 Discovery pre-fill

The estate name travels in the existing mDNS TXT record on
`_dpf-federation._tcp.local.`, alongside the device ID the advertisement already
carries. On first boot, before asking an operator to type anything, the install
browses for peers and pre-fills the estate name from a peer that advertises one.

The operator still confirms. Discovery grants no trust — that remains the
certificate chain's job — but it removes the typing, which is the reported defect.
A peer whose estate name is confirmed and later mismatches the organization root
is refused by `evaluateOrganizationEnrollment` with the existing
`organization-ref-mismatch` reason, so a typo cannot silently auto-enrol.

**Prerequisite, and the reason this is inert today:** mDNS lives in the Edge Node,
and no Edge Node is provisioned. Every install must run one carrying
`federation.discovery`, which the 2026-08-06 increment already required and which
never landed.

### 5.7 Copy

`buildIdentityHeadline()` stops emitting standalone-fragment self-declaration.

- Before: `A development installation. Its job: safely improve another dpf.`
- After: `This installation is set up for development work. Its job is to safely improve another DPF.`

The replacement is **more** readable by Flesch-Kincaid, not less: FK counts
syllables per word as heavily as words per sentence, so plain verbs and full
clauses pay for themselves. The heading `What this installation is` becomes
`About this installation`.

## 6. Safety invariants

1. **The badge never claims production.** It renders only for non-production, so a
   rendering failure degrades to "no badge", never to a false "PROD".
2. **One resolver, two consumers.** The badge and `/ops/installation` read the same
   `resolveInstallationIdentity()`. A header that could disagree with the ops page
   about the environment class would be worse than no header.
3. **The estate name is not an authorization input.** It is a label. Trust stays
   with the certificate chain, exactly as section 4.3 of the zero-touch design
   requires.
4. **Discovery pre-fill is a suggestion, never a grant.** An operator confirms; a
   mismatch against the organization root still refuses.
5. **Renaming an estate does not re-key anything.** The device ID is the identity;
   the name is presentation.
6. **A real estate name is runtime data and never appears in source.** The
   pre-commit private-identity guard refused the first draft of this very document
   for naming the operator's actual estate, which is the correct behaviour and is
   the reason the worked example throughout is a fictional one. Tests, fixtures,
   seeds, and defaults must use fictional names; a real estate name reaches the
   repository only as an operator-entered `PlatformConfig` value. See
   `docs/operations/oss-repo-identity-hygiene.md`.

## 7. Non-goals

- No change to the LDAP and Directory Service program (section 9).
- No change to cross-organization enrolment or the projection contract.
- No new identity table, and no second trust root.
- No navigation refactor, though this design adds to the pressure for one.

## 8. Acceptance criteria

1. A production install renders no badge; a development install with estate
   `Northwind` renders `NORTHWIND DEV` next to the logo; an unnamed development
   install renders `DEV`.
2. The workspace home renders no installation-identity panel; `/ops/installation`
   renders it in full.
3. Two installs connected to one MCP client present different `serverInfo.name`
   values and different `INSTALLATION:` briefing lines.
4. `pnpm --filter web build` passes — the client-bundle hazard in section 5.3 is
   proven absent, not assumed.
5. An install with an Edge Node carrying `federation.discovery` lists a same-LAN
   peer and pre-fills its estate name with no operator typing.
6. The identity copy contains no standalone sentence fragments, and its route stays
   inside the existing UX reading-grade budget.

## 9. Relationship to the Directory Service program

`EP-24741BBF`, "absorb identity instead of federating to someone else's", owns
LDAP, the directory projection, service accounts, and the eventual authentication
root, sequenced in `2026-08-23-directory-service-identity-absorption.md`. All four
phases are deferred with a 2026-09-22 review, and none is implemented.

This design neither advances nor blocks that program. It is deliberately upstream
of it: the estate identifier is the name the directory base DN will eventually
derive from, so establishing it now removes a decision from Phase 2 rather than
adding one.

One inconsistency is worth reconciling separately.
`docs/architecture/workos-iam-equivalence-scorecard.md` still classes enterprise
SSO, SCIM, and Directory Sync as **identity-edge adapter**, which is the adopt
posture that `BI-1E0AB1E5` retired when the epic became *absorb*. The scorecard is
a living document and is now behind the decision.

## 10. Decision record

- **Source the field that already exists.** `OrganizationTrustAnchor.organizationRef`
  was defined, refused on, and never populated. Giving it a source is convergence;
  a new estate table would have been a second identity home.
- **Name for humans, fingerprint for equality.** Every benchmarked system splits
  these. DPF already had the fingerprint and was missing the name.
- **Mark the exception, not the rule.** Badging only non-production keeps the
  signal readable, and it fails safe when identity cannot be resolved.
- **Fix the gate, not just the sentence.** Rewriting one headline leaves the
  incentive that produced it. The readability cap stays; what changes is that
  satisfying it with fragments stops being the cheapest path.

## Addendum 2026-09-06: the organization named at setup is the lowest tier (BI-CA54ACC8)

Found on the live pair while proving EP-ZERO-CONFIG-FEDERATION: production showed its Organization name in the banner yet refused every membership proof with `no-local-organization`, because the membership statement compares the estate name and nothing had ever moved an existing install forward onto it (the installer never writes `estateName`, no migration seeded it, and the operator had not opened the installation page).

The precedence gains one more speaking tier below `portal-declaration`: `organization-name`, the Organization row the setup wizard created. `resolveEstateNamePrecedence` takes `organizationName`, reports `organizationNameValue`, and `EstateIdentityStore.readOrganizationName` (optional) supplies it; `prismaEstateIdentityStore` is the one builder Prisma-backed callers use. The installation page keeps the Operator name field empty while this tier is in force and says which organization applies meanwhile (kernel decision DI-0B1E2E643EB3), so a typed name remains a real declaration. `unset` still exists: an install with no Organization row and no declaration is unnamed, and says so.
