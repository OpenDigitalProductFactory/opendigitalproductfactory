# `sbom/`

Platform SBOM + dependency-reduction outputs. See
[docs/architecture/dependency-reduction-routine.md](../docs/architecture/dependency-reduction-routine.md).

**Committed (tracked):**

- `baseline.json` — drift anchor for `scripts/sbom/check-sbom-drift.mjs`. Lists
  the accepted set of first-party version splits; the CI **SBOM Divergence
  Guard** fails when a new one appears.
- `README.md` — this file.

**Generated (git-ignored, produced by `pnpm sbom`):**

- `dpf-platform-sbom.cdx.json` — CycloneDX 1.7 SBOM of the whole monorepo.
- `dpf-platform-sbom-analysis.json` / `.md` — the reduction/efficiency analysis.

These regenerate from `pnpm-lock.yaml` on every dependency change and are
published as CI artifacts (`.github/workflows/sbom-platform.yml`), so they are
not committed. Regenerate locally any time with `pnpm sbom`.
