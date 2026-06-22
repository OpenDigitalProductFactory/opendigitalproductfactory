# Runbook: Compromised / Vulnerable Dependency

_Layer #3 of the package-acquisition hardening program (kernel-decided 2026-06-20).
Owner: platform / assurance. See [dependency-reduction-routine.md](../architecture/dependency-reduction-routine.md)._

**Use when**: a dependency you ship is reported compromised (malware published to
the registry, maintainer-account takeover) or carries a vulnerability you need to
act on — whether surfaced by `pnpm scan:deps`, a GitHub/Dependabot alert, or an
external report ("package X was hacked").

**Tools**: `pnpm sbom`, `pnpm scan:deps`, `pnpm-workspace.yaml` `overrides`, the
SBOM at `sbom/dpf-platform-sbom.cdx.json`.

---

## 0. Triage — is it real, and is it a vuln or a compromise?

Two different threats need two different responses:

- **Disclosed vulnerability** (a bug, assigned a CVE/GHSA, usually a fix exists) →
  steps below; urgency scales with severity + reachability.
- **Package compromise** (malicious code published, account takeover) → treat
  *every* install in the affected version range as hostile; jump straight to
  containment + secret rotation, do not wait.

Confirm against the source: `node scripts/sbom/scan-dependencies.mjs` (OSV), the
advisory's affected range, and the published version dates. **Check our resolved
version is actually in range before acting** — most "package X was hacked" reports
are a version range we're already past.

> Worked example (2026-06-20): "Inngest was hacked" → CVE-2026-42047 (HIGH, env-var
> leak via `serve()`), affected `3.22.0 ≤ v < 3.54.0`. We run `inngest@4.7.0` — past
> the fix. **Not exposed; no action beyond confirming.** The triage step ended it.

## 1. Identify exposure (who uses it, what version)

```
pnpm sbom                                   # regenerate sbom/dpf-platform-sbom.cdx.json
grep -n '"<package>@' sbom/dpf-platform-sbom.cdx.json   # every resolved version present
```

Determine: which version(s) resolve, whether it's a **direct** dependency (see
`sbom/dependency-allowlist.json`) or transitive (and via what), and whether it was
permitted to **run install scripts** (`pnpm-workspace.yaml` `allowBuilds` +
`pnpm audit:provenance`). A package that ran an install script, or runs at
runtime with access to secrets, raises the blast radius — go to step 3 (rotation).

## 2. Contain — pin away from the bad version

- **Transitive** → add an `overrides` entry in `pnpm-workspace.yaml` flooring it to
  the fixed (or last-known-good) version. Precedent: the `dompurify` / `protobufjs`
  / `ws` / `hono` security floors already in that file.
- **Direct** → bump the declaring workspace(s) to the fixed version; if none exists
  and it's a compromise, remove the dependency or swap it.
- Reinstall against the lockfile and confirm the bad version is gone:
  ```
  pnpm install --frozen-lockfile=false   # to re-resolve with the override
  pnpm scan:deps                         # confirm the advisory clears
  ```

## 3. Rotate exposed secrets (compromise, or any install-script/runtime reach)

If the compromised package could have read the environment or filesystem, assume
exfiltration and rotate what it could reach. In a DPF install that includes:
`INNGEST_SIGNING_KEY` / `INNGEST_EVENT_KEY`, `CREDENTIAL_ENCRYPTION_KEY`,
`AUTH_SECRET`, database credentials, and any provider API tokens. Re-encrypt
stored credentials if the credential-encryption key rotates. **Entering/rotating
secrets is an operator action — Claude does not handle secret values; surface the
list, the operator rotates.**

## 4. Rebuild + redeploy

Rebuild images and roll out via the normal publish / self-upgrade path so the
patched tree reaches every running install. For customer installs, the
platform-runtime scan (BI-96DFDC7D) is what flags this without GitHub.

## 5. Verify + record

- `pnpm scan:deps` returns clean (or the finding is consciously accepted in
  `sbom/vuln-baseline.json` with a real `reason` + `expires`).
- File / update the assurance-ledger finding + a BI; if accepting residual risk,
  record it in `sbom/vuln-baseline.json` (the local dismiss-with-justification).

## Escalation

Compromise affecting customer installs, or any secret rotation with customer
data-at-rest impact, escalates to the founder before customer-facing comms — see
the kernel principle on destructive/outward actions requiring explicit go.
