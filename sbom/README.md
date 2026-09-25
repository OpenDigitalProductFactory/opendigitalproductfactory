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

## Release images

Every image in `.github/workflows/publish-image.yml` is published with a BuildKit
SBOM attestation and max-mode provenance (`sbom: true`, `provenance: mode=max`),
per architecture. The generated SBOM above describes the monorepo's npm graph
only. The OS packages inside each image appear in that image's attestation.

- `dpf-doctools` (BI-15D69168): Debian trixie-slim (pinned by digest) with the
  distribution's headless LibreOffice (writer, calc, impress, draw), `python3-uno`,
  `poppler-utils` and the DejaVu, Liberation, Carlito and Caladea fonts. It adds no
  npm dependency. Its attestation is the SBOM of record. Evaluation:
  [docs/security/tool-evaluations/2026-09-24-libreoffice-headless.md](../docs/security/tool-evaluations/2026-09-24-libreoffice-headless.md).
  Its release gate is `tools/doctools/smoke.sh` plus `tools/doctools/size-budget.sh`.
