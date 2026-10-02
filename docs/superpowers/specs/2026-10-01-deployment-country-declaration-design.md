---
status: draft
---

# Deployment country declaration over federation: design (BI-06EA3167)

| Field | Value |
|-------|-------|
| **Created** | 2026-10-01 |
| **Author** | Claude Opus 5.5 for Mark Bodman |
| **Backlog** | `BI-06EA3167` · epic `EP-SPATIAL-OPERATIONAL-VIEWS` |
| **Parent** | [Geographic footprint, coverage and live overlays](./2026-09-23-geographic-footprint-coverage-and-live-overlays-design.md) §3.1.1, option 2 |
| **Builds on** | [Market footprint world view](./2026-09-26-market-footprint-world-view-design.md) (shipped, PR #5801) · the operational-posture contract (`packages/db/src/federated-operational-posture-contract.ts`) |
| **Decision** | WWMD `DI-CC664F8746CC`: a new opt-in record type, chosen with high confidence over widening operational posture or publishing in the public discovery advert |
| **Out of scope** | Coordinates of any kind, automatic telemetry, a public directory of installs, de-duplicating installs that are both CRM-tracked and federated (see §6) |

## 1. Problem

The world view counts deployments only for installs DPF sells directly. A deployment is a customer site whose edge node runs an active fulfilment (`apps/web/lib/footprint/market-footprint.server.ts`). Self-installed open-source deployments are invisible, even when they federate with the vendor install. The parent spec rejected phone-home telemetry. Its preferred source was a consented, country-only declaration carried over federation, which an install opts into and can withdraw.

## 2. What this item delivers

1. **Contract.** `packages/db/src/federated-deployment-declaration-contract.ts` defines `DeploymentDeclarationV1` as `specVersion: "dpf.deployment-declaration/1"`, with these fields:
   - `originInstallationId`, `originVersion` and `payloadDigest`;
   - `countryCode`, an ISO 3166-1 alpha-2 code;
   - `declaredAt`;
   - `state`, either `declared` or `withdrawn`.

   The file also holds the field allow-list `DEPLOYMENT_DECLARATION_FIELDS`, a denylist covering anything with coordinates or an address, a projection template and a validator. The validator rejects an unknown country code and any denylisted field. It follows the posture contract's pattern.
2. **Opt-in.** An install-level setting, `federation.deploymentCountry.share`, is off by default. Turning it on reads the country from `Organization.address` through `parseOrgAddress(...).countryCode`. That is the canonical organization identity, so the operator never types the country twice. If the address has no country, the toggle explains that and stays off.
3. **Egress.** When the setting is on, a declaration is sent through the existing federation push and egress gate (`apps/web/lib/federation/push.ts`). It goes only on trusted links where this install's role is `managed-by` or `channel-downstream`, the same upward links federated demand already uses (`apps/web/lib/federation/demand-read-model.ts`). It never goes to the public `/.well-known/dpf-federation.json` advert. Turning the setting off sends a `withdrawn` declaration on the same links. Changing the organization's country sends a new `declared` record.
4. **Receipt.** The receiving install upserts the record into `FederatedRecordMirror` with `recordType: "deployment-declaration"`, so no schema change is needed. A `withdrawn` record sets the mirror's `syncStatus` to `withdrawn`. A record arriving on a revoked link is refused.
5. **World view.** `loadMarketFootprint` adds each live, `declared` mirror on a non-revoked link as a deployment row `{siteId: originInstallationId, country}`. Each origin install counts once. The deployments layer and the table already show deployment counts, so no UI change is needed beyond a one-line source note: "includes installs that chose to share their country".
6. **Settings surface.** One switch sits on the federation connections page (`/platform/federation-links`): "Share this install's country with the organizations you federate with". Beside it, a line of text shows the country that would be sent, and another lists which links receive it.

## Objectives and acceptance

- **OBJ-DCD-CONSENT:** An install shares its deployment country only after its operator turns the setting on, and turning it off withdraws what was shared.
- **OBJ-DCD-MINIMAL:** Only an ISO 3166-1 alpha-2 country code, plus the minimum record identity, ever leaves the install for this purpose. It never includes coordinates or an address, and it never goes to a public or automatic channel.
- **OBJ-DCD-COUNT:** The receiving install's market-footprint world view counts each declaring install once in its declared country, and stops counting it when the declaration is withdrawn or the link is revoked.

| Acceptance | Objectives | Statement |
|---|---|---|
| AC-DCD-CONSENT-1 | OBJ-DCD-CONSENT | With the setting off (the default), no deployment-declaration record is produced or sent on any link. |
| AC-DCD-CONSENT-2 | OBJ-DCD-CONSENT | Turning the setting off after it was on sends a `withdrawn` declaration on every link that received a `declared` one. |
| AC-DCD-MINIMAL-1 | OBJ-DCD-MINIMAL | The projected payload contains only the allow-listed fields, and the validator rejects a payload carrying any coordinate or address field, or a country code outside ISO 3166-1 alpha-2. |
| AC-DCD-MINIMAL-2 | OBJ-DCD-MINIMAL | Declarations are sent only on trusted links where this install's role is `managed-by` or `channel-downstream` and never appear in `/.well-known/dpf-federation.json`. |
| AC-DCD-COUNT-1 | OBJ-DCD-COUNT | `loadMarketFootprint` counts each `declared` mirror on a non-revoked link once in its country, and excludes `withdrawn` mirrors and revoked links. |

## 3. Design choices and their reasons

| Choice | Alternatives rejected | Why |
|---|---|---|
| A new record type | Adding a country to operational posture | Posture is sent only within the same organization (AC-OCP-001); widening it would send posture across organizations. Consent also differs: posture always flows, while this record exists only after an opt-in. |
| Country taken from `Organization.address` | A separate "deployment country" field | One source of truth for organization identity (AGENTS.md §8) |
| One install-level switch | A per-link toggle | Lower cognitive load: one decision with a visible list of recipients. A per-link flag can be added later if a real need appears. |
| Only `managed-by` and `channel-downstream` links | Every link, or the public advert | The declaration answers "where do our products run". It flows toward the organization the install bought from or federates under, never sideways to peers or to the public. |

## 4. Research & Benchmarking

- **Home Assistant analytics.** Opt-in and off by default, with tiered levels. The country is derived on the server from the request's IP address. DPF adopts the off-by-default opt-in. It rejects IP-derived location: the operator states the country through the organization's own address, and nothing is inferred.
- **Nextcloud usage survey.** An opt-in report of version and apps sent to a central vendor server. DPF rejects the central collector. A declaration goes only to an organization the install has already chosen to federate with.
- **Debian popularity-contest.** Opt-in, anonymous package statistics. DPF adopts the minimal-field principle: the record carries nothing beyond what the stated purpose needs.
- **Standards:** ISO 3166-1 alpha-2 for the country, and GDPR data-minimization (Article 5(1)(c)). A country is not personal data for an organization, but the posture is the same.

## 5. Security and privacy

- The denylist rejects `lat`, `lon`, `latitude`, `longitude`, `coordinates`, `address`, `addressLine1`, `city`, `postalCode`, `region` and `geometry` at both ends: the sender's egress projection and the receiver's validator.
- The validator checks the country code against the ISO 3166-1 alpha-2 list already used by `apps/web/lib/footprint/world-country-paths.ts` and the locale registry.
- Revoking a link stops sending and makes the receiver ignore that link's mirrors.

## 6. Known limits

- **Double counting.** An install that is both CRM-tracked (a customer site with an active fulfilment) and federated is counted twice, because `FederationLink` has no crosswalk to `CustomerSite` today. The world view's source note says counts can overlap. Linking the two belongs to the organization crosswalk work.

## 7. Verification

- **Unit tests:**
  - contract allow-list, denylist and validator;
  - the projection builder with the setting on and off;
  - withdrawal on switch-off;
  - link-role filtering;
  - receive and upsert, including withdrawal;
  - `buildMarketFootprint` input from mirrors.
- **The negative-egress test** in `apps/web/lib/federation/federation-outbound.test.ts` gains the new record.
- **Build gate and UX.** The build gate runs. UX is checked on `/platform/federation-links`: the switch, the country preview and the recipient list, in light and dark themes and at phone width.

## 8. Documentation impact

- `docs/user-guide/platform/` federation connections page: what is shared, with whom, and how to stop.
- `docs/user-guide/customers/market-footprint.md`: deployments now include installs that chose to share their country, and counts can overlap.
