# EP-OSR-001: Open Source Readiness — Licensing & Secrets Hardening

**Status:** Draft
**Created:** 2026-03-22
**Author:** Claude (COO) / Mark Bodman (CEO)

## Summary

Prepare the Digital Product Factory for public release as an Apache-2.0 open source project. This spec covers two related workstreams: (1) establishing proper licensing, removing a GPL-3.0 dependency, and making license information visible across repo, registry, Docker image, and in-product; and (2) hardening secrets management to eliminate vulnerabilities that would compromise customers who self-host the platform.

## Motivation

The project currently has no LICENSE file, no copyright headers, and no license fields in package.json. The README claims MIT but the codebase depends on `country-state-city` (GPL-3.0), making that claim legally inaccurate. On the security side, hardcoded fallback secrets (`dev-secret-change-me`, `changeme123`) and SHA-256 password hashing in the seed create real attack surfaces for anyone deploying the platform.

The platform targets regulated industries (healthcare, finance, insurance). These customers require clear licensing for procurement and strong credential management for compliance. Both gaps must be closed before public release.

## Decisions

### License Model

**Apache-2.0** with DCO (Developer Certificate of Origin) for contributions.

Rationale:
- Explicit patent grant — critical for regulated industry procurement
- Zero copyleft friction — no blanket bans in enterprise legal departments
- Compatible with the planned Hive Mind contribution model (voluntary one-click donation of user-developed modules back to the project)
- Follows the Grafana Labs / Kubernetes / Prisma precedent for company-backed open source
- AGPL rejected: regulated buyers often have blanket AGPL bans
- BSL rejected: not OSI-approved, contradicts open source positioning

### Contribution Model (DCO)

Contributors keep copyright but grant an irrevocable license to include their work under the project license. This uses the Developer Certificate of Origin standard — a `Signed-off-by` line in commit metadata.

The Hive Mind feature (planned) will embed DCO attestation automatically when a user approves a contribution. Contributions merge into the platform fabric and become indistinguishable from core code — the "water drop in the ocean" model. No CLA is required.

### Secrets Hardening Strategy

**Hybrid approach:** Database passwords retain dev-mode defaults (local-only, low risk). `AUTH_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` are never defaulted — they must be generated. These two secrets protect customer data directly (session forgery and credential encryption).

---

## Section 1: Licensing

### 1.1 Replace `country-state-city` (GPL-3.0)

The `country-state-city` package is the only GPL-3.0 dependency. It is used in exactly one file (`packages/db/src/seed-geographic-data.ts`) to populate Country, Region, and City tables at seed time. No other code imports it — all downstream consumers query the database tables via Prisma.

**Replacement approach:** Static JSON data files in `packages/db/data/`.

Data sources:
- **Countries:** `i18n-iso-countries` (MIT, already in project) provides ISO 3166-1 data (name, iso2, iso3, numericCode). Phone codes sourced from ITU public data.
- **Regions:** ISO 3166-2 subdivision data from MIT-licensed datasets (e.g. `olahol/iso-3166-2.json`). Pre-curated to match current coverage (~5,000 regions).
- **Cities:** GeoNames extract (CC-BY 4.0). Pre-filtered to major cities (1-3 per region, matching current seed logic). Attribution in NOTICE file.

**Files created:**
- `packages/db/data/countries.json` — ISO 3166-1 country records
- `packages/db/data/regions.json` — ISO 3166-2 subdivision records
- `packages/db/data/cities.json` — Curated major cities

**Files modified:**
- `packages/db/src/seed-geographic-data.ts` — Rewrite to read JSON files via `fs.readFileSync` + `JSON.parse`. Remove `country-state-city` and `i18n-iso-countries` imports (i18n-iso-countries stays as a dependency for potential runtime use, just not needed in seed). Function signature unchanged: `export async function seedGeographicData(prisma: PrismaClient)`.
- `packages/db/package.json` — Remove `country-state-city` dependency.

**Database tables unchanged:** Country, Region, City schemas are not modified. The seed writes the same data structure — only the source changes.

**Downstream impact:** None. All consumers (AddressSection.tsx, reference-data.ts, CountryPanel.tsx, RegionPanel.tsx, CityPanel.tsx, address-validation.ts) query the database, not the npm package.

### 1.2 Pin xlsx Version

The `xlsx` (SheetJS) package is Apache-2.0 at version 0.18.5 but later versions changed to a non-OSS license.

**Files modified:**
- `packages/db/package.json` — Change `"xlsx": "^0.18.5"` to `"xlsx": "0.18.5"` (exact pin)
- `apps/web/package.json` — Change `"xlsx": "^0.18.5"` to `"xlsx": "0.18.5"` (exact pin)

### 1.3 License Files and Metadata

**Files created:**
- `LICENSE` (repo root) — Apache License 2.0 full text. Copyright line: `Copyright 2026 Mark Bodman`. GitHub auto-detects this file for the repo badge.
- `NOTICE` (repo root) — Required by Apache-2.0 for redistributions. Contains:
  - Project copyright notice
  - Third-party attributions for Apache-2.0 licensed dependencies (Prisma, neo4j-driver, sharp, etc.)
  - CC-BY 4.0 attribution for GeoNames city data
  - `i18n-iso-countries` MIT attribution

**Files modified:**
- Root `package.json` — Add `"license": "Apache-2.0"`
- `apps/web/package.json` — Add `"license": "Apache-2.0"`
- `packages/db/package.json` — Add `"license": "Apache-2.0"`
- All other workspace `package.json` files (`packages/types`, `packages/validators`, `packages/api-client`, `packages/storefront-templates`, `packages/finance-templates`) — Add `"license": "Apache-2.0"`
- `README.md` — Update license section from `[MIT](LICENSE)` to Apache-2.0 with badge, link to LICENSE, and DCO contribution note.

### 1.4 License Visibility

License information must appear in six locations:

1. **Repository root** — `LICENSE` file (GitHub auto-detection)
2. **`NOTICE` file** — Apache-2.0 attribution requirement
3. **Every `package.json`** — `"license": "Apache-2.0"` field (npm/pnpm registry display)
4. **`README.md`** — License badge + section with DCO note
5. **In-product** — "About" or "Legal" section in the portal displaying project license, copyright, and third-party license summary. (Implementation deferred to a separate UI spec; this spec establishes the requirement.)
6. **Docker image labels** — OCI standard labels in Dockerfile

### 1.5 Dockerfile Changes

**OCI labels** — Add in the `runner` stage (the final stage that gets tagged and pushed), not the `base` stage. Labels in intermediate stages are unnecessary and may not carry through to the final image depending on Docker version. Add after the `FROM base AS runner` line:

```dockerfile
LABEL org.opencontainers.image.title="Open Digital Product Factory"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.source="https://github.com/markdbodman/opendigitalproductfactory"
```

**Data files** — Ensure `packages/db/data/` is available in the init stage. The `COPY . .` in the init stage already includes it, but verify the runner stage receives it via `COPY --from=init /app/packages/db ./packages/db`.

The `.dockerignore` does not exclude `packages/db/data/` — no change needed.

---

## Section 2: Secrets Hardening

### 2.1 Fix Hardcoded Fallback Secret in social-auth.ts (CRITICAL)

**Current state** (`apps/web/lib/social-auth.ts` lines 4-5):
```typescript
const TEMP_TOKEN_SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET || "dev-secret-change-me"
);
```

The project uses `AUTH_SECRET`, not `NEXTAUTH_SECRET`. This fallback is almost certainly active in every deployment, meaning all social auth temp tokens are signed with a publicly known secret.

**Fix:**
```typescript
const secret = process.env.AUTH_SECRET;
if (!secret) {
  throw new Error("AUTH_SECRET environment variable is required");
}
const TEMP_TOKEN_SECRET = new TextEncoder().encode(secret);
```

**Impact:** Social auth temp tokens will fail with a clear error if `AUTH_SECRET` is unset, rather than silently using a forgeable secret. Normal auth flows are unaffected (they use `AUTH_SECRET` via NextAuth's own configuration).

**Downstream check:** `NEXTAUTH_SECRET` is not referenced elsewhere in source code. The reference in `docs/superpowers/plans/2026-03-19-social-identity-signin.md` should be updated for accuracy.

### 2.2 Use bcrypt in Seed for Admin Password (HIGH)

**Current state** (`packages/db/src/seed.ts` lines 932-933):
```typescript
const password = process.env.ADMIN_PASSWORD ?? "changeme123";
const hash = crypto.createHash("sha256").update(password).digest("hex");
```

SHA-256 is unsalted and fast — trivially crackable via rainbow tables if the database is compromised before first login.

**Fix:**
```typescript
import bcrypt from "bcryptjs";

const password = process.env.ADMIN_PASSWORD ?? "changeme123";
const hash = await bcrypt.hash(password, 12);
```

`bcryptjs` must be added to `packages/db/package.json` dependencies (it is already a dependency of `apps/web` but not `packages/db`). Add `@types/bcryptjs` to devDependencies if not resolved from the workspace root. The function `seedDefaultAdminUser` is already async, so the `await` is compatible.

The SHA-256 legacy detection in `apps/web/lib/password.ts` (lines 17-24) stays unchanged — it protects users who seeded before this change and haven't logged in yet. After their first login, the hash auto-upgrades to bcrypt.

**Impact:** Seed runs ~200ms slower (bcrypt rounds). No functional change to login flow.

### 2.3 Remove Dangerous Defaults from docker-compose.yml (HIGH)

**Current state** (`docker-compose.yml`):
```yaml
AUTH_SECRET: ${AUTH_SECRET:-dev_secret_change_me}
CREDENTIAL_ENCRYPTION_KEY: ${CREDENTIAL_ENCRYPTION_KEY:-}
```

**Fix:** Use shell parameter expansion with error on unset:
```yaml
AUTH_SECRET: ${AUTH_SECRET:?AUTH_SECRET must be set - run setup script first}
CREDENTIAL_ENCRYPTION_KEY: ${CREDENTIAL_ENCRYPTION_KEY:?CREDENTIAL_ENCRYPTION_KEY must be set - run setup script first}
```

This applies to the `portal` service definition (lines 75, 77), which is the only service that uses these variables. The `portal-init` service (lines 51-62) runs migrations and seed only — it does not need `AUTH_SECRET` or `CREDENTIAL_ENCRYPTION_KEY` and should not have them added. Database password defaults (`${POSTGRES_PASSWORD:-dpf_dev}`, `${NEO4J_AUTH:-neo4j/dpf_dev_password}`) remain unchanged — they are local-only and low risk.

**Risk distinction:** `AUTH_SECRET` has an actual forgeable value (`dev_secret_change_me`) that enables session hijacking. `CREDENTIAL_ENCRYPTION_KEY` defaults to empty, which means credentials are stored in plaintext — a data-at-rest exposure risk, not a forgery risk. Both must be required, but for different reasons.

**Impact:** `docker compose up` without running setup first produces a clear error instead of starting with forgeable secrets. The setup scripts generate these values, so the normal workflow is unchanged.

### 2.4 Update Install Scripts to Generate Both Secrets Everywhere (HIGH)

Three install scripts must generate `AUTH_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` and write them to both the root `.env` (for Docker Compose) and `apps/web/.env.local` (for dev mode).

**`scripts/fresh-install.ps1`:**
- Currently writes hardcoded `AUTH_SECRET=dev_secret_change_me` to root `.env` (line 107)
- Change to generate a random value using the same `RandomNumberGenerator` pattern already used for `apps/web/.env.local` (lines 132-134)
- Add `CREDENTIAL_ENCRYPTION_KEY` generation to root `.env` (currently only generated for `.env.local`)

**`scripts/setup.ps1`:**
- Currently generates `AUTH_SECRET` for `.env.local` (line 61) by replacing the `<generate with: openssl rand -base64 32>` placeholder
- Does NOT generate `CREDENTIAL_ENCRYPTION_KEY` for `.env.local` — the placeholder from `.env.example` is copied verbatim. This is a gap.
- Does NOT generate either secret for root `.env`. This is a second gap.
- Fix: Add `CREDENTIAL_ENCRYPTION_KEY` generation for `.env.local` (replace the hex placeholder) AND add both secrets to root `.env` if missing or still defaults

**`scripts/setup.sh`:**
- Currently generates `AUTH_SECRET` for `.env.local` (line 56-57) via `openssl rand -hex 32` + `sed` replacement
- Does NOT generate `CREDENTIAL_ENCRYPTION_KEY` for `.env.local` — same gap as setup.ps1
- Does NOT generate either secret for root `.env` — same gap as setup.ps1
- Fix: Add `CREDENTIAL_ENCRYPTION_KEY` generation for `.env.local` (using `openssl rand -hex 32`) AND add both secrets to root `.env`

**`.env.docker.example`:**
- Replace hardcoded `AUTH_SECRET=dev_secret_change_me` with `AUTH_SECRET=<generate with: openssl rand -base64 32>`
- Add `CREDENTIAL_ENCRYPTION_KEY=<generate with: openssl rand -hex 32>`
- Remove `ADMIN_PASSWORD=changeme123` or replace with placeholder

**Production installer (`install-dpf.ps1`):** Already generates random secrets via `Generate-RandomPassword`. Verify it covers both `AUTH_SECRET` and `CREDENTIAL_ENCRYPTION_KEY`. No changes expected.

### 2.5 Warn When Credential Encryption Is Disabled (MEDIUM)

**Current state** (`apps/web/lib/credential-crypto.ts` line 21):
```typescript
if (!key) return plaintext;
```

Silently stores API keys in plaintext when `CREDENTIAL_ENCRYPTION_KEY` is missing.

**Fix:** Add a warning on first call:
```typescript
let warnedMissingKey = false;

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) {
    if (!warnedMissingKey) {
      console.warn(
        "WARNING: CREDENTIAL_ENCRYPTION_KEY not set — credentials will be stored in plaintext. " +
        "Set this variable for production deployments."
      );
      warnedMissingKey = true;
    }
    return plaintext;
  }
  // ... existing encryption logic
}
```

**Impact:** Dev mode still works without a key. The warning appears once in server logs. With Fix 2.3 enforcing the key in Docker, this is defense-in-depth for the dev-mode (VS Code) workflow.

### 2.6 Warn on Default Neo4j Password in Production (MEDIUM)

**Current state** (`packages/db/src/neo4j.ts` line 16):
```typescript
const pass = process.env["NEO4J_PASSWORD"] ?? "dpf_dev_password";
```

**Fix:** Keep the fallback (dev convenience) but warn:
```typescript
const pass = process.env["NEO4J_PASSWORD"] ?? "dpf_dev_password";
if (pass === "dpf_dev_password" && process.env.NODE_ENV === "production") {
  console.warn(
    "WARNING: Using default Neo4j password in production. Set NEO4J_PASSWORD environment variable."
  );
}
```

**Impact:** None in dev. Production deployments get a visible warning.

---

## Complete File Change List

### New Files
| File | Purpose |
|------|---------|
| `LICENSE` | Apache-2.0 full license text |
| `NOTICE` | Copyright + third-party attributions |
| `packages/db/data/countries.json` | ISO 3166-1 country data |
| `packages/db/data/regions.json` | ISO 3166-2 subdivision data |
| `packages/db/data/cities.json` | Curated major cities (GeoNames, CC-BY 4.0) |

### Modified Files
| File | Changes |
|------|---------|
| `packages/db/src/seed-geographic-data.ts` | Rewrite: read JSON files instead of npm package |
| `packages/db/src/seed.ts` | Import bcryptjs; use bcrypt for admin password hash |
| `packages/db/package.json` | Remove `country-state-city`; add `bcryptjs`; pin `xlsx` to `0.18.5`; add `"license"` field |
| `apps/web/package.json` | Pin `xlsx` to `0.18.5`; add `"license"` field |
| Root `package.json` | Add `"license"` field |
| All other workspace `package.json` files | Add `"license"` field |
| `apps/web/lib/social-auth.ts` | Use `AUTH_SECRET`; throw if missing; remove hardcoded fallback |
| `apps/web/lib/credential-crypto.ts` | Add warning when encryption key missing |
| `packages/db/src/neo4j.ts` | Add production warning for default password |
| `docker-compose.yml` | Require `AUTH_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` (no defaults) |
| `Dockerfile` | Add OCI license labels; verify data file COPY paths |
| `scripts/fresh-install.ps1` | Generate real secrets into root `.env` |
| `scripts/setup.ps1` | Generate both secrets into root `.env` |
| `scripts/setup.sh` | Add `CREDENTIAL_ENCRYPTION_KEY` generation; generate to root `.env` |
| `.env.docker.example` | Replace hardcoded secrets with placeholders |
| `README.md` | Update license section; update credentials documentation |
| `docs/superpowers/plans/2026-03-19-social-identity-signin.md` | Update `NEXTAUTH_SECRET` reference to `AUTH_SECRET` |
| `pnpm-lock.yaml` | Regenerates automatically from dependency changes |

### Verified Unchanged
| File | Reason |
|------|--------|
| `apps/web/lib/password.ts` | SHA-256 legacy detection stays for backward compatibility |
| `apps/web/lib/auth.ts` | Already uses `AUTH_SECRET` via NextAuth; social auth DB sync unchanged |
| `.env.example` | Already has correct placeholders |
| `.dockerignore` | Already excludes only the right things |
| `docker-entrypoint.sh` | Calls same seed command; no changes needed |
| `install-dpf.ps1` | Already generates random secrets for production |
| All UI components (AddressSection, CountryPanel, etc.) | Query database, not npm package |

---

## Testing Strategy

1. **Seed test:** Run `pnpm --filter @dpf/db exec tsx src/seed.ts` against a fresh database. Verify Country, Region, City tables are populated with expected row counts.
2. **Auth test (new bcrypt hash):** Start portal, log in with `admin@dpf.local` / `changeme123`. Verify bcrypt hash is written (hash starts with `$2`). Log out and log in again to verify bcrypt verification works.
3. **Auth test (SHA-256 backward compatibility):** Manually insert a user with a SHA-256 hash into the database. Verify login succeeds and the hash is auto-upgraded to bcrypt. This protects users who seeded before this change.
4. **Docker test (missing secrets):** Run `docker compose up` without `.env` file — verify it fails with clear error about missing `AUTH_SECRET`.
5. **Docker test (with secrets):** Run setup script, then `docker compose up` — verify full stack starts with generated secrets.
6. **Setup script test (Windows):** Run `fresh-install.ps1` on a clean checkout. Verify root `.env` contains generated (non-default) values for both `AUTH_SECRET` and `CREDENTIAL_ENCRYPTION_KEY`.
7. **Setup script test (Linux/Mac):** Run `setup.sh` on a clean checkout. Verify both `.env` and `apps/web/.env.local` contain generated values for both secrets.
8. **Encryption test:** Store a provider API key via the admin UI. Verify the `PlatformConfig` table contains `enc:...` prefixed value, not plaintext.
9. **License audit:** Run `pnpm licenses list` or equivalent. Verify no GPL-3.0 dependencies remain.

## Out of Scope

- In-product license/legal page UI (separate spec)
- Hive Mind contribution feature (separate spec, references DCO model established here)
- Defense-in-depth hardening: Next.js middleware.ts, CSP headers, CORS configuration (separate "production hardening" spec)
- `$queryRawUnsafe` replacement (low risk, static SQL only)
- Content Security Policy headers
