# Resolve device manufacturers from the IEEE OUI registry

*BI-9632B15B. Follows BI-A3D12F85, which drained the estate quality queue 429 → 22.*

## The problem

Nothing in the platform resolved a MAC address to a manufacturer.

Every vendor that appeared on the live install came from the **UniFi controller's own
lookup**, handed over per-client in its API response (`vendor: "Espressif Inc."`,
`vendorOui: "588C81"`). That was invisible until the estate queue was drained far
enough to see what remained, because the controller resolves *clients* generously —
so identification looked like it worked.

It does not resolve *devices*. The UniFi device endpoint returns no vendor field, so
all six pieces of managed network hardware — 4 access points, the gateway, the switch —
had `manufacturer = NULL` and raised `lifecycle_unverified` forever. That was **12 of
the 22 rows** left after BI-A3D12F85: standing work asking an operator to hand-identify
hardware whose MAC states the manufacturer outright.

The general defect: **depending on a vendor's API to volunteer the manufacturer.** The
OUI is on the wire, in every collector's payload, and we were ignoring it.

## Why not the obvious fix

The first cut set `vendor: "Ubiquiti"` in the UniFi collector, on the reasoning that a
controller only adopts its own hardware. It worked and it was wrong in kind:

- It generalises to nothing. The next collector needs its own hardcode.
- It states a fact we can *derive*, so it rots independently of reality.
- It only fixes vendors whose API we have already special-cased — precisely the class
  of gap that hid this problem for months.

## Substrate check — it already exists

`services/edge-node/` already ships the whole capability:

- `data/oui.tsv` — 39,452 IEEE prefixes
- `src/lib/mac-oui.ts` — `lookupOui` / `normalizeMac` / `shortVendor`, cached, injectable adapter, tested
- `services/edge-node-go/internal/oui/` — a parallel Go implementation with its own copy

Verified against the live estate: all five Ubiquiti OUIs (`AC8BA9`, `D8B370`, `FCECDA`,
`9C05D6`, `D021F9`) resolve to *Ubiquiti Inc*, and `588C81` returns *Espressif Inc.* —
**independently reproducing the controller's own answer** for that client. The dataset
is good; it was simply stranded in a service the core discovery path cannot reach.

## Design

**Seeded table + batched lookup, resolved into `properties.vendor`.**

1. **`MacVendorOui`** — global reference data (`oui` PK, `vendor`), seeded from
   `packages/db/data/oui.tsv` by `mac-oui-loader.ts`, mirroring
   `discovery-fingerprint-catalog-loader.ts`. Replace-then-insert in 5k chunks: a
   published dataset with no local edits to preserve, where a reassigned prefix must
   not linger.

2. **`mac-oui.ts`** — pure resolution. Callers supply the map; no file or DB access, so
   it stays trivially testable.

3. **`discovery-sync`** — one batched query per sweep over the distinct prefixes
   actually observed, then fill `properties.vendor` **only where absent**.

### Why `properties.vendor` specifically

`deriveInventoryEnrichment` already reads it — that is how the controller's own values
reach `manufacturer` today. Writing there means:

- **no change to `deriveInventoryEnrichment`**, which stays pure
- a resolved vendor travels the identical path to a controller-supplied one, so there
  is no second code path to keep in sync
- a collector that genuinely knows the manufacturer still wins; the 24-bit prefix only
  fills a gap

### Why a table rather than reading the TSV at runtime

Discovery sync runs server-side inside a transaction. A 1.2MB file read from a bundled
workspace package is not reliable there. Seeding happens in Node context where the file
certainly exists, and the sweep pays one indexed query.

## Randomised MACs are a first-class outcome

`resolveMacVendor` returns a **reason**, not just a nullable vendor:
`resolved` | `randomised-mac` | `unknown-oui` | `invalid-mac`.

This matters because BI-A3D12F85 established that a locally-administered MAC (bit `0x02`
in octet 1) carries **no OUI by construction** — 0 of 119 resolved, against 65 of 65
burned-in. "Unknown OUI" might be fixed by refreshing the registry; "randomised MAC"
never will be. Collapsing them would send someone hunting for data that cannot help,
and would re-open the question this arc already answered.

## Scope

Closes the 6 `lifecycle_unverified` rows (queue 22 → 16) and generalises vendor
resolution to every collector reporting a MAC.

**Deliberately not closed:** the 6 `catalog_match_ambiguous` rows. With the vendor known
and firmware read, `normalizeSoftwareEvidence` finds no Ubiquiti `SoftwareIdentity`
above threshold, so the platform is accurately reporting a **catalog gap**. Suppressing
that would be the error BI-A3D12F85 existed to avoid. Seeding Ubiquiti firmware
identities is separate follow-up.

## Known debt this creates

`oui.tsv` now exists in **three** places — `packages/db/data/`, `services/edge-node/data/`,
`services/edge-node-go/internal/oui/data/`. The Go copy is unavoidable across the language
boundary; the two TypeScript copies are not. Converging them behind one shipped artifact
is worth a follow-up, and is not attempted here because edge-node deploys independently
of the portal image.

## Verification

- `mac-oui.test.ts` — normalisation, the randomised-vs-unknown distinction, malformed-line tolerance
- `unifi.test.ts` — pins that the collector reports the MAC and does **not** set a vendor, so the hardcode cannot creep back
- Live: after deploy, confirm the six devices gain `manufacturer` and the queue lands at 16 — by executing the detector over live rows, never by SQL that approximates the rule
