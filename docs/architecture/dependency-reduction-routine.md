# Local Dependency Health — SBOM, Reduction & Vulnerability Routine

_Status: active · Owner: platform / assurance · Added 2026-06-20_

The platform's dependency-health routine, generated from `pnpm-lock.yaml`. It
**makes up for what GitHub Dependabot does automatically** — because a DPF
install running on **local / self-hosted git has no Dependabot at all**. It runs
two axes, both GitHub-free and pure-Node (no `pnpm install` required):

1. **Reduction / efficiency** — whole-tree SBOM + version fan-out analysis.
2. **Security / vulnerability / lifecycle** — OSV vulnerability scan over the SBOM.

## The two axes (and where Dependabot fits)

| Axis | Mechanism (this repo) | GitHub-native equivalent |
| --- | --- | --- |
| **Reduction / efficiency** | `generate-platform-sbom.mjs` + `check-sbom-drift.mjs` | *none* — Dependabot bumps one package at a time and can't see cross-workspace version consistency |
| **Security / vulnerability / lifecycle** | `scan-dependencies.mjs` (OSV.dev) | **Dependabot** security alerts |
| Per-container SBOM at release | `publish-image.yml` (`sbom: true`) | — |

OSV.dev aggregates the **GitHub Advisory Database (GHSA)**, so the scanner
surfaces the *same advisories* Dependabot would — it just doesn't depend on
GitHub. On this GitHub-hosted repo the scanner runs alongside Dependabot
(belt-and-suspenders + a PR gate Dependabot doesn't provide, and a daily dogfood
of the engine). On a **customer's local/self-hosted install it is the only
vulnerability feed** — see "The customer-install gap" below.

## SBOM generation

`node scripts/sbom/generate-platform-sbom.mjs` (alias `pnpm sbom`) reads
`pnpm-lock.yaml` and writes to `sbom/`:

- `dpf-platform-sbom.cdx.json` — CycloneDX 1.7 (every resolved npm component +
  published container images). Same format/spec as the per-build generator in
  `apps/web/lib/assurance/cyclonedx-generator.ts`.
- `dpf-platform-sbom-analysis.json` / `.md` — the reduction analysis.

Generated outputs regenerate on every dependency change and are **not committed**
(see `.gitignore`); CI uploads them as artifacts. Only the two small anchors —
`sbom/baseline.json` (drift) and `sbom/vuln-baseline.json` (accepted advisories)
— are tracked.

On install or reseed, the same generator is also the sole source for the
Digital Product Factory Portal's current `BomDocument`. The seed derives a
deterministic document identity from the normalized lockfile, replaces that
document's occurrences transactionally, supersedes older platform documents,
and links components through the shared `CatalogIdentity` key. Operators read
that persisted graph at **Digital Product > Operate > Dependencies**; no
route-local platform component list owns a competing currency record.

## Axis 1 — reduction / efficiency

The analysis tiers duplicate package versions so signal separates from noise:

- **Tier 1 — first-party divergence.** *Our own* declarations resolve to >1
  version (`typescript` `^6.0.3` in most workspaces but `^5.9.3`/`^5.7.3` in a
  few). Fully controllable. **Hard-gated.**
- **Tier 2 — safe `pnpm dedupe` candidates.** Same major, minor/patch drift.
- **Tier 3 — transitive multi-major.** Pulled by deep transitives/peers
  (`commander`, `chalk`, `ansi-*`). Mostly accept.
- **Direct-but-transitive.** We declare it, our specifiers already agree (`zod`
  `^4`, `undici` `^8`, `@types/node` `^26`); extra versions are transitive.

`scripts/sbom/check-sbom-drift.mjs` (`pnpm check:sbom-drift`) **hard-fails a PR**
that introduces a *new* Tier-1 split (`SBOM Divergence Guard` job in `ci.yml`),
and reports deltas for the rest. Accepted splits live in `sbom/baseline.json`;
ratchet down as they're fixed (`--update-baseline` to accept intentionally).

## Axis 2 — vulnerability & lifecycle (the local Dependabot-equivalent)

`scripts/sbom/scan-dependencies.mjs` (`pnpm scan:deps`) checks every resolved
component against OSV.dev and writes `sbom/dependency-scan.{json,md}`.

- **Source / sovereignty.** Only `{ecosystem, name, version}` per package (public
  OSS identifiers) leaves the box — the same exposure Dependabot has reading your
  manifest. For air-gapped installs the DB source is swappable via `OSV_BASE_URL`
  (OSV publishes the full DB at `gs://osv-vulnerabilities` for local mirroring).
- **Gate.** `--fail-on <low|moderate|high|critical>` (CI uses `high`). The report
  always lists every severity (like Dependabot alerts); the gate blocks only at
  or above the threshold. `--require-online` makes an unreachable DB a hard error
  (used on scheduled runs so a silent skip can't hide that the scan didn't run).
- **Accepted advisories.** `sbom/vuln-baseline.json` — the local mirror of
  Dependabot/CodeQL dismiss-with-reason. Each entry needs a real `reason`; an
  `expires` date makes the finding **re-surface** after that date, forcing
  periodic re-review.
- **Current state.** The accepted set lives in `sbom/vuln-baseline.json` (read it
  rather than trusting a count here). The security `overrides` in
  `pnpm-workspace.yaml` floor the rest.

### The remediation ladder (when a floor won't work)

The default fix for a transitive CVE is an override floor. Two cases break that,
and both have cost a session before:

1. **No patched version exists.** If the advisory's vulnerable range covers
   *every published release* (Dependabot reports `first_patched_version: null`),
   there is nothing to floor to. Climb the ladder instead: **floor → bump the
   parent that pulls it → remove the parent → accept in `vuln-baseline.json`**.
   Check whether a newer major of the *parent* dropped the dependency outright —
   e.g. `extract-zip` (GHSA-jmr9-qjv8-65gv) has no fix and is unmaintained, but
   `@puppeteer/browsers` 3.0.0 replaced it with `modern-tar`, so bumping
   `puppeteer` to ^25 removed the vulnerable package from the tree entirely.
   Only accept in the baseline once the ladder is genuinely exhausted.
2. **The package is only an auto-installed peer.** pnpm `overrides` do **not**
   govern auto-installed peer dependencies. Editing the override and regenerating
   silently changes nothing (`regen-lockfile.mjs` reports the package unchanged).
   Declare the package explicitly in the owning `package.json` so the floor binds
   — which then also trips the New Dependency Gate (Axis 3), so vet and
   acknowledge it in the same PR.

**A closed alert does not stay fixed.** Advisories get revised: the patched range
can move *after* a floor lands, and because the original alert is already closed
no new one fires. `nanoid` GHSA-2v37-7h3g-55p8 was floored to 3.3.17, then
re-scoped upstream to require 3.3.18 — the stale floor was caught by `pnpm
scan:deps`, not by the Dependabot feed. Treat the OSV scan, not the alert list,
as the authority on what is still vulnerable.

### Owning a fix: `pnpm patch` when upstream is dead

When a dependency is **archived with no patched release**, the ladder's last rung
before "accept and live with it" is to **own the fix**. `pnpm patch <pkg>@<ver>`
writes a reviewable diff to `patches/` and records it under
`patchedDependencies:` in `pnpm-workspace.yaml`.

Use it when *all* of these hold — otherwise prefer bumping or replacing:

- upstream is archived/unresponsive **and** no fixed version exists anywhere;
- the fix is small and self-contained (a bounds/termination guard, not a redesign);
- you don't own the call site, so you can't just swap the package;
- a **regression test** can prove the defect and prove the patch (test first — it
  must fail against the stock package).

Worked example: `image-size` (archived 2026-06-03 on GitHub *and* on its Codeberg
revival; `metro` closed its own Dependabot issue as *not planned*). The ICNS
parser's entry-walk loop never advances on a zero-length entry.
`patches/image-size@1.2.1.patch` added the guard, with an ICNS regression test in
the workspace guard profile. **Retired 2026-09-06 (BI-640B5249):** the routine
`pnpm dedupe` collapsed the duplicate `metro@0.84.4` tree onto `0.84.5`, which no
longer depends on `image-size` at all, so the package left the tree and the
patch, its pin, its regression guard and both baseline rows went with it. That
is the ladder's "remove the parent" rung arriving on its own — the exact-version
pin is what made pnpm refuse the dedupe until someone looked.

**Two things to know before reaching for this:**

1. **It does not clear the alert.** A patch doesn't change the version string, so
   OSV/Dependabot still match `image-size@1.2.1`. The finding stays in
   `sbom/vuln-baseline.json` — but the `reason` now says *patched*, not *tolerated*.
   The risk is gone even though the row remains.
2. **The patch is pinned to an exact version.** When the parent bumps the package,
   the patch stops applying and pnpm fails loudly. That is the desired behaviour —
   it forces a re-review rather than silently dropping your fix.

**Never adopt an unvetted "community fork" to escape this.** The remediation shape
is an override, which silently redirects *every* resolution of that name in the
tree while bypassing the New Dependency Gate — maximum blast radius, minimum
review. A fork that is days old, has no download history, has no provenance
attestation, and is promoted by its own author via templated issues on major
repos is a supply-chain approach vector, not a fix.

## Axis 3 — acquisition control (the New Dependency Gate)

The cheapest moment to stop a bad package is when it *enters* the project.
`scripts/sbom/check-new-dependencies.mjs` (`pnpm check:new-deps`, CI job **New
Dependency Gate**) fails a PR that adds a **direct** dependency not acknowledged
in `sbom/dependency-allowlist.json`. Acquiring a package is therefore a
deliberate, recorded decision — not a silent lockfile change.

- **Why direct-only**: you *acquire* a direct dependency on purpose; transitives
  ride in through it and are covered by Axis 1 (drift) + Axis 2 (OSV). The
  vetting decision belongs at the direct-dep boundary.
- **Acknowledging** (`--update-allowlist`) records each package with its
  workspaces + a `note`. Vet before acknowledging: npm provenance attestation,
  package age + downloads, maintainer count, license, `pnpm scan:deps` (OSV), and
  whether an existing dependency already covers it. **The allowlist entry is the
  vetting record.**
- Pure Node, network-free → safe as a required PR check.

### Why this shape (WWMD)

The acquisition-hardening program was decided through the founder kernel
(`principle_decide`, 2026-06-20), not by gut. Four complementary layers were
scored; the composite ranking set the build order:

1. **New Dependency Gate** — composite 9.39, high confidence (top pulls: *least
   privilege / deny by default*, *build gate mandatory*, *never adopt an unvetted
   external tool*). **Shipped** (`check-new-dependencies.mjs`).
2. **Provenance + postinstall-script audit** — 7.66. **Shipped**
   (`scripts/sbom/audit-provenance.mjs`, `pnpm audit:provenance`, report-only step
   in `dependency-scan.yml`). Reports who runs install scripts and who ships SLSA
   provenance. First run: 43/116 audited packages publish provenance, and **all 6
   `allowBuilds`-allowlisted packages report `hasInstallScript=false`** at current
   versions → the install-script allowlist is over-permissive and a candidate to
   trim (verify node-gyp/binding builds first — `prisma` fetches engines).
3. **Incident-response runbook** — 5.56. **Shipped**
   ([docs/runbooks/dependency-compromise.md](../runbooks/dependency-compromise.md)):
   triage → SBOM exposure → override/pin → rotate secrets → rebuild → verify.
4. **Manual vetting checklist** — 4.30, ranked **last**: it scored *negative* on
   "do the work; don't task the operator," so its content is folded INTO the
   gate's allowlist record rather than shipped as human homework.

## Doctrine: rent vs own, and validate the rent

Governing principle (founder, 2026-06-20): **use what's out there — but harden the
validation around it.** Reimplementing solved problems is waste and risk; the
default is to rent (keep external + the controls above). Own a dependency only
when it clears a narrow bar. Optimization order: **eliminate → dedupe →
replace-with-native → own → keep** (internalize only at step 4, for a vetted
minority).

`scripts/sbom/runtime-surface.mjs` (`pnpm surface`) and
`scripts/sbom/internalization-candidates.mjs` (`pnpm candidates`) read the
codescape for this. The candidacy ranker scores each direct dep on size,
transitive self-containment, age/stability and runtime reach, and auto-excludes
security-sensitive / framework / native / type-only packages. First run: **4 of
106** direct deps cleared the "own" bar (`nanoid`, `dotenv`, `picomatch`,
`@fullcalendar/react`) — and even those are marginal — confirming renting is
correct for ~all of the tree. Owning trades supply-chain risk for **lost SBOM/OSV
visibility + full patching ownership**, so the per-candidate "own it?" decision
goes through WWMD (`principle_decide`: `operational_independence` +
`vendor_lock_in` vs `long_term_maintainability` + `blast_radius`). A standing
review-list win: `gray-matter` (carrier of our one `js-yaml` finding) is a
replace candidate that would shed that vuln entirely.

## Hardening the rent: upgrade validation

Renting safely means validating versions as they *change*, not just at acquisition:
- **Release-age cooldown** (`.github/dependabot.yml` `cooldown`): auto-bumps wait
  5 days (patch 3 / minor 7 / major 14) so a hijacked release is caught and
  unpublished before we adopt it.
- **Release-age floor** (`pnpm-workspace.yaml` `minimumReleaseAge: 1440`): the
  universal backstop under that cooldown. The cooldown is stricter but binds only
  Dependabot-authored bumps; the floor additionally binds `pnpm add`, lockfile
  regeneration, and agent-driven installs, on every host. Grant an exception with
  `minimumReleaseAgeExclude` (keep it empty by default, and comment any entry).

  **It gates resolution, not installation.** Verified against pnpm 10.33: a
  `--frozen-lockfile` install reports *"Lockfile is up to date, resolution step is
  skipped"* and never consults the floor; if the lockfile and manifest disagree
  pnpm raises `ERR_PNPM_OUTDATED_LOCKFILE`, still never a release-age error. So CI,
  Docker builds, and worktree bootstrap are unaffected, and an already-reviewed
  lockfile is never re-litigated — but nothing downstream re-checks lockfile
  *contents* either.
- **Lockfile release-age gate** (`scripts/sbom/check-lockfile-release-age.mjs`,
  run by `dependency-scan.yml`): closes exactly that hole. A lockfile authored
  where the floor did not apply could otherwise carry a minutes-old package into
  main and every later frozen install would faithfully reproduce it. The gate
  diffs the committed lockfile against the base ref, checks each **newly added**
  entry's real publish time against the floor, and fails the PR on a violation. It
  reads the floor from `pnpm-workspace.yaml`, so policy has one definition; if that
  policy is missing the gate exits non-zero rather than passing vacuously.

  Before this, the floor existed only as unversioned host-local pnpm config — it
  bound one machine, protected nothing else, and produced sandbox-only breakage
  that a contributor could not reproduce (BI-B175621A).
- **Upgrade-validation gate** (BI-6D1CADFD): at PR time, validate each *changed*
  version — release-age, a newly-introduced install script (classic compromise
  signature), provenance continuity, and OSV-clean target.
- The daily OSV re-scan keeps watching everything already resolved.

## Dual-package-hazard guard (singleton safety)

Most duplicate package versions are harmless — pure utilities where multiple
copies are just bytes that never disagree at runtime. The exception is
**singleton / `instanceof` / global-state** libraries (`react`, `react-dom`,
`zod`, `redux`, `immer`, `graphql`, emotion, `@tanstack/react-query`, …): two
copies in one runtime cause `instanceof` failures and state desync — the
duplication that actually "causes disparities over time." `scripts/sbom/check-singleton-safety.mjs`
(`pnpm check:singletons`, CI job **Singleton Safety Guard**) fails when such a
library goes **multi-major in the production-runtime closure** (where it bites —
not build/dev tooling, not apps/mobile's separate react-native renderer),
ignoring the ~200 harmless utility dups. Reviewed exceptions (currently `immer`
10/11 and `react-is` 16/19 — both assessed contained) live in
`sbom/singleton-baseline.json`. This is *why* a blanket "eliminate all
duplication" refactor is the wrong tool: only this small class causes real
disparities, and it's guarded; the rest is the irreducible nature of a
transitive dependency tree.

## Schedules

- **Reduction guard** — every PR / push / merge_group (`ci.yml` → `SBOM Divergence Guard`).
- **New Dependency Gate** — every PR / push / merge_group (`ci.yml` → `New Dependency Gate`).
- **Singleton safety guard** — every PR / push / merge_group (`ci.yml` → `Singleton Safety Guard`).
- **Platform SBOM** — weekly Mon 07:17 UTC + lockfile change + dispatch (`sbom-platform.yml`).
- **Vulnerability scan** — daily 06:41 UTC + dep-change PRs + dispatch (`dependency-scan.yml`).

## Judgment layer

The mechanical layer surfaces and gates; it does not *decide* which reductions to
pursue or which advisories to accept. That judgment is the mandate of the **SBOM
Management Agent** (`AGT-131`, `prompts/specialist/sbom-management-agent.prompt.md`),
which should run as a monthly native `ScheduledAgentTask` (the
`dpf-cognitive-load-migration-scan` precedent), not client cron.

## The customer-install gap (the part still to build)

On **this** GitHub repo the routine runs in GitHub Actions. A customer install on
local/self-hosted git **has no GitHub Actions** — so to genuinely replace
Dependabot there, the same engines must run inside the **platform runtime**: a
scheduled job (inngest / `ScheduledAgentTask`) that regenerates the SBOM, runs the
OSV scan, and files findings into the assurance ledger / backlog. The pure-Node
scripts here are written to be that reusable engine (importable, no install). The
assurance-ledger design already anticipates this — scanners are *adapters* that
read the BOM (`adapterKey`, e.g. `osv-scanner`) and emit `AssuranceFinding`s.

## In-platform Assurance Gate: auto-file + reconcile (BI-91D1524F)

The scripts above are the GitHub-side routine. Inside the platform runtime the
**Build Studio Assurance Gate** runs the same OSV/pnpm-audit idea per build
(`apps/web/lib/assurance/*`). Its findings used to convert to backlog items only
via a **manual per-finding button**, so they accumulated as an invisible parallel
queue, and it did not honor `sbom/vuln-baseline.json` — so an accepted advisory
(js-yaml) was re-filed, and a build whose tree lagged main's overrides filed 24
already-fixed "Remediate" items.

The gate now **auto-files genuine findings** through the shared `ingestBacklogItem`
front door (EP-INTAKE-UNIFY) after a **reconcile** step, and the findings panel is
read-only evidence (linked BI / disposition, no manual button):

- **Reconcile before filing** (`finding-reconcile.ts` + `advisory-context.ts`):
  suppress findings that are accepted+unexpired in `sbom/vuln-baseline.json`,
  already linked, or whose vulnerable version main no longer resolves
  (`pnpm-lock.yaml`). **Fails closed** — if the canonical context can't be loaded
  it does not auto-create work.
- **Severity policy** (founder kernel `principle_decide`, 2026-06-22, severity-
  tiered): high/critical → build BI, moderate → deferred BI, low/info → evidence.

Plan: `docs/superpowers/plans/2026-06-22-assurance-gate-auto-file-fold-plan.md`.
The script-side baseline (`vuln-baseline.json`) is the shared accept ledger both
the OSV script and the in-platform gate honor.

## Backlog

Under `EP-ASSURANCE-LEDGER`.

Reduction / efficiency:
- **BI-AEDDBCA1** — monthly SBOM-reduction judgment as a `ScheduledAgentTask` (AGT-131).
- **BI-6C620C7A** — collapse the TypeScript first-party split (align to `^6`).
- **BI-568B5848** — `pnpm dedupe` pass (Tier 2).

Security / acquisition (program decided via `principle_decide` 2026-06-20):
- **New Dependency Gate** (layer #1) — *shipped* (`check-new-dependencies.mjs` + `ci.yml` job + `sbom/dependency-allowlist.json`).
- **BI-78219FDE** (layer #2) — provenance + postinstall audit *tool shipped*
  (`audit-provenance.mjs`); BI tracks the follow-ons: trim the over-permissive
  `allowBuilds` allowlist and feed the signals into the gate.
- **BI-A8D081C9** (layer #3) — incident-response runbook *shipped*
  ([docs/runbooks/dependency-compromise.md](../runbooks/dependency-compromise.md)).
- **Release-age cooldown** — *shipped* (`.github/dependabot.yml` `cooldown`).
- **BI-B175621A** — release-age floor made versioned + enforced — *shipped*
  (`pnpm-workspace.yaml` `minimumReleaseAge`, plus the lockfile gate in
  `scripts/sbom/check-lockfile-release-age.mjs`). Supersedes phase 2 of
  [the 2026-07-11 recovery plan](../superpowers/plans/2026-07-11-lockfile-release-age-recovery.md).
- **BI-6D1CADFD** — upgrade-validation gate (release-age / new-install-script /
  provenance-continuity / OSV on changed versions at PR time).
- **BI-96DFDC7D** — run the SBOM + OSV engines inside the platform runtime as an
  assurance adapter so local/self-hosted installs get automatic scanning without
  GitHub (the customer-install gap above).
