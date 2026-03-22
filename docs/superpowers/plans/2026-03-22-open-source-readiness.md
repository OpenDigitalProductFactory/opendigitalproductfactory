# Open Source Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare DPF for public release by establishing Apache-2.0 licensing, removing a GPL-3.0 dependency, and hardening six secret management vulnerabilities.

**Architecture:** Two workstreams in one plan. Licensing (Tasks 1-5) adds license files, replaces the GPL `country-state-city` package with static JSON data files, and adds license metadata everywhere. Secrets (Tasks 6-11) fixes hardcoded fallback secrets, upgrades password hashing in the seed, and ensures install scripts generate real credentials.

**Tech Stack:** TypeScript, Prisma, Docker, PowerShell, Bash, bcryptjs, jose

**Spec:** `docs/superpowers/specs/2026-03-22-open-source-readiness-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `LICENSE` | Apache-2.0 full license text |
| `NOTICE` | Copyright notice + third-party attributions |
| `packages/db/data/countries.json` | ISO 3166-1 country records (name, iso2, iso3, numericCode, phoneCode) |
| `packages/db/data/regions.json` | ISO 3166-2 subdivision records (name, code, countryCode) |
| `packages/db/data/cities.json` | Curated major cities per region (name, regionCode, countryCode) |

### Modified Files
| File | What Changes |
|------|-------------|
| `packages/db/src/seed-geographic-data.ts` | Rewrite to read JSON data files instead of npm package |
| `packages/db/src/seed.ts:932-933` | Use bcrypt instead of SHA-256 for admin password |
| `packages/db/package.json` | Remove `country-state-city`; add `bcryptjs`; pin `xlsx`; add license |
| `apps/web/package.json` | Pin `xlsx`; add license |
| `package.json` (root) | Add license |
| `packages/types/package.json` | Add license |
| `packages/validators/package.json` | Add license |
| `packages/api-client/package.json` | Add license |
| `packages/storefront-templates/package.json` | Add license |
| `packages/finance-templates/package.json` | Add license |
| `apps/web/lib/social-auth.ts:4-6` | Use `AUTH_SECRET`; throw if missing |
| `apps/web/lib/credential-crypto.ts:19-21` | Add warning when encryption key missing |
| `packages/db/src/neo4j.ts:16` | Add production warning for default password |
| `docker-compose.yml:75,77` | Require AUTH_SECRET and CREDENTIAL_ENCRYPTION_KEY |
| `Dockerfile:30` | Add OCI license labels in runner stage |
| `scripts/fresh-install.ps1:101-109` | Generate real secrets into root `.env` |
| `scripts/setup.ps1:49-76` | Generate both secrets for `.env.local` and root `.env` |
| `scripts/setup.sh:53-68` | Generate both secrets for `.env.local` and root `.env` |
| `.env.docker.example` | Replace hardcoded secrets with placeholders |
| `README.md:461-463` | Update license section to Apache-2.0 |

---

## Task 1: Add LICENSE and NOTICE Files

**Files:**
- Create: `LICENSE`
- Create: `NOTICE`

- [ ] **Step 1: Create the Apache-2.0 LICENSE file**

Create `LICENSE` at repo root with the full Apache License 2.0 text. Use the official text from https://www.apache.org/licenses/LICENSE-2.0.txt with copyright line:

```
Copyright 2026 Mark Bodman
```

- [ ] **Step 2: Create the NOTICE file**

Create `NOTICE` at repo root:

```
Open Digital Product Factory
Copyright 2026 Mark Bodman

This product includes software developed by third parties.
See below for attribution notices required by their licenses.

---

City geographic data derived from GeoNames (https://www.geonames.org/)
Licensed under Creative Commons Attribution 4.0 (CC-BY 4.0)

i18n-iso-countries — Copyright (c) 2016 Timo Mämecke
Licensed under MIT

Prisma — Copyright (c) 2019 Prisma Data, Inc.
Licensed under Apache License 2.0

Neo4j JavaScript Driver — Copyright (c) Neo4j Sweden AB
Licensed under Apache License 2.0

sharp — Copyright (c) 2013 Lovell Fuller and contributors
Licensed under Apache License 2.0
```

- [ ] **Step 3: Commit**

```bash
git add LICENSE NOTICE
git commit -m "chore: add Apache-2.0 LICENSE and NOTICE files"
```

---

## Task 2: Add License Metadata to All package.json Files

**Files:**
- Modify: `package.json` (root)
- Modify: `apps/web/package.json`
- Modify: `packages/db/package.json`
- Modify: `packages/types/package.json`
- Modify: `packages/validators/package.json`
- Modify: `packages/api-client/package.json`
- Modify: `packages/storefront-templates/package.json`
- Modify: `packages/finance-templates/package.json`

- [ ] **Step 1: Add license field to root package.json**

In `package.json`, add after `"private": true,`:

```json
"license": "Apache-2.0",
```

- [ ] **Step 2: Add license field to all workspace package.json files**

In each of these files, add `"license": "Apache-2.0"` after the `"private": true` line:
- `apps/web/package.json`
- `packages/db/package.json`
- `packages/types/package.json`
- `packages/validators/package.json`
- `packages/api-client/package.json`
- `packages/storefront-templates/package.json`
- `packages/finance-templates/package.json`

- [ ] **Step 3: Pin xlsx to exact version**

In `packages/db/package.json` line 32, change:
```json
"xlsx": "^0.18.5"
```
to:
```json
"xlsx": "0.18.5"
```

In `apps/web/package.json`, find `"xlsx": "^0.18.5"` and change to `"xlsx": "0.18.5"`.

- [ ] **Step 4: Commit**

```bash
git add package.json apps/web/package.json packages/*/package.json
git commit -m "chore: add Apache-2.0 license to all package.json files and pin xlsx"
```

---

## Task 3: Add OCI Labels to Dockerfile and Update README

**Files:**
- Modify: `Dockerfile:30`
- Modify: `README.md:461-463`

- [ ] **Step 1: Add OCI labels to Dockerfile runner stage**

In `Dockerfile`, after line 30 (`FROM base AS runner`), add:

```dockerfile
LABEL org.opencontainers.image.title="Open Digital Product Factory"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.source="https://github.com/markdbodman/opendigitalproductfactory"
```

- [ ] **Step 2: Update README license section**

In `README.md`, replace lines 461-463:

```markdown
## License

[MIT](LICENSE)
```

with:

```markdown
## License

Licensed under the [Apache License, Version 2.0](LICENSE).

Contributions are accepted under the [Developer Certificate of Origin (DCO)](https://developercertificate.org/). By submitting a pull request, you certify that your contribution is your original work and you grant an irrevocable license under the project's Apache-2.0 license.
```

- [ ] **Step 3: Verify Dockerfile data file COPY paths**

Confirm that `packages/db/data/` will be available in the Docker image. Check:
- Init stage (line 25): `COPY . .` — includes `packages/db/data/` (OK)
- Runner stage (line 42): `COPY --from=init /app/packages/db ./packages/db` — copies entire `packages/db` including `data/` subdirectory (OK)
- `.dockerignore` does not exclude `packages/db/data/` or `*.json` (OK)

No changes needed — this is a verification step. The existing COPY paths already cover the new data files.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile README.md
git commit -m "chore: add OCI license labels and update README license section"
```

---

## Task 4: Create Geographic Data Files

**Files:**
- Create: `packages/db/data/countries.json`
- Create: `packages/db/data/regions.json`
- Create: `packages/db/data/cities.json`

- [ ] **Step 1: Generate countries.json**

Create `packages/db/data/countries.json`. This file contains ISO 3166-1 country data. Use `i18n-iso-countries` (MIT) as the authoritative source for iso2, iso3, and numericCode values. Add phoneCode from ITU public data.

Format — array of objects:
```json
[
  {
    "name": "United States",
    "iso2": "US",
    "iso3": "USA",
    "numericCode": "840",
    "phoneCode": "1"
  }
]
```

The current seed produces ~245 countries (those with valid iso3 and numericCode). Match this count.

To generate this file, write a one-off script `packages/db/scripts/extract-countries.ts` that:
1. Imports `i18n-iso-countries` and `country-state-city` (still available until we remove it)
2. Iterates all countries, filters those with valid iso3/numericCode
3. Writes the result as formatted JSON to `packages/db/data/countries.json`
4. Delete the script after use (it is a one-time extraction tool)

- [ ] **Step 2: Generate regions.json**

Create `packages/db/data/regions.json`. Format — array of objects:
```json
[
  {
    "name": "California",
    "code": "US-CA",
    "countryCode": "US"
  }
]
```

Use the same extraction approach: write a one-off script that reads from `country-state-city`'s `State.getAllStates()` and writes the data to JSON. The `countryCode` field links regions to countries via the country's iso2 code.

- [ ] **Step 3: Generate cities.json**

Create `packages/db/data/cities.json`. Pre-apply the filtering logic that currently lives in `seedCities()` — only include 1-3 cities per region based on the `MAJOR_COUNTRY_CODES` set.

Format:
```json
[
  {
    "name": "Los Angeles",
    "regionCode": "US-CA",
    "countryCode": "US"
  }
]
```

The `regionCode` + `countryCode` pair links cities to their region. The seed will look up the region by (countryCode, regionCode) to get the DB ID.

Use the same extraction script approach. The extraction script should apply the MAJOR_COUNTRY_CODES filtering (3 cities for major countries, 1 for others).

- [ ] **Step 4: Verify data file sizes and counts**

Run: `node -e "const c=require('./packages/db/data/countries.json'); const r=require('./packages/db/data/regions.json'); const ci=require('./packages/db/data/cities.json'); console.log('Countries:', c.length, 'Regions:', r.length, 'Cities:', ci.length)"`

Expected: Countries ~245, Regions ~5000, Cities ~7000-9000

- [ ] **Step 5: Commit**

```bash
git add packages/db/data/
git commit -m "chore: add static geographic data files (countries, regions, cities)"
```

---

## Task 5: Rewrite seed-geographic-data.ts and Remove GPL Dependency

**Files:**
- Modify: `packages/db/src/seed-geographic-data.ts`
- Modify: `packages/db/package.json:27`

- [ ] **Step 1: Rewrite seed-geographic-data.ts**

Replace the entire file. The new version reads from JSON data files instead of the npm package. Key changes:
- Remove imports of `country-state-city` and `i18n-iso-countries`
- Add `import { readFileSync } from "fs"` and `import { join } from "path"`
- `seedCountries()` reads from `packages/db/data/countries.json`
- `seedRegions()` reads from `packages/db/data/regions.json`, looks up country DB IDs by iso2
- `seedCities()` reads from `packages/db/data/cities.json`, looks up region DB IDs by (countryCode, regionCode)
- The function signature stays: `export async function seedGeographicData(prisma: PrismaClient)`
- Keep all existing logging, progress tracking, and idempotency (upsert/findFirst patterns)
- Keep the `MAJOR_COUNTRY_CODES` set and per-region caps — but since cities.json is pre-filtered, the filtering logic moves to the extraction step (Task 4)

The JSON file path resolution should use `__dirname` relative paths:
```typescript
const DATA_DIR = join(__dirname, "..", "data");
const countriesData = JSON.parse(readFileSync(join(DATA_DIR, "countries.json"), "utf-8"));
```

- [ ] **Step 2: Remove country-state-city from package.json**

In `packages/db/package.json`, remove line 27:
```json
"country-state-city": "^3.2.1",
```

Keep `i18n-iso-countries` — it's MIT-licensed and may be useful for runtime lookups.

- [ ] **Step 3: Run pnpm install to update lockfile**

Run: `pnpm install`

This regenerates `pnpm-lock.yaml` without the `country-state-city` dependency tree.

- [ ] **Step 4: Test the seed against a fresh database**

Run: `pnpm --filter @dpf/db exec tsx src/seed.ts`

Verify the seed completes without errors. Check Country, Region, City table row counts match expectations (~245, ~5000, ~7000-9000).

- [ ] **Step 5: Run license audit**

Run: `pnpm dlx license-checker --summary --start packages/db`

Verify no GPL-3.0 dependencies remain in the `@dpf/db` package.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/seed-geographic-data.ts packages/db/package.json pnpm-lock.yaml
git commit -m "feat: replace GPL country-state-city with static JSON data files"
```

---

## Task 6: Fix Hardcoded Fallback Secret in social-auth.ts

**Files:**
- Modify: `apps/web/lib/social-auth.ts:4-6`

- [ ] **Step 1: Replace the secret initialization**

In `apps/web/lib/social-auth.ts`, replace lines 4-6:

```typescript
const TEMP_TOKEN_SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET || "dev-secret-change-me"
);
```

with:

```typescript
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) {
  throw new Error("AUTH_SECRET environment variable is required for social auth token signing");
}
const TEMP_TOKEN_SECRET = new TextEncoder().encode(authSecret);
```

- [ ] **Step 2: Verify the app starts without errors**

Ensure `AUTH_SECRET` is set in `apps/web/.env.local`, then run: `pnpm --filter web dev`

The app should start without throwing. If `AUTH_SECRET` is missing, the error should appear at module load time.

- [ ] **Step 3: Update stale spec reference**

In `docs/superpowers/plans/2026-03-19-social-identity-signin.md`, search for `NEXTAUTH_SECRET` and replace with `AUTH_SECRET` if found.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/social-auth.ts
git commit -m "fix: remove hardcoded fallback secret in social-auth.ts"
```

---

## Task 7: Use bcrypt in Seed for Admin Password

**Files:**
- Modify: `packages/db/package.json` (add bcryptjs)
- Modify: `packages/db/src/seed.ts:932-933`

- [ ] **Step 1: Add bcryptjs dependency**

Run: `pnpm --filter @dpf/db add bcryptjs && pnpm --filter @dpf/db add -D @types/bcryptjs`

- [ ] **Step 2: Update seed.ts admin password hashing**

In `packages/db/src/seed.ts`, add to the imports at the top of the file:

```typescript
import bcrypt from "bcryptjs";
```

Then replace lines 932-933:

```typescript
const password = process.env.ADMIN_PASSWORD ?? "changeme123";
const hash = crypto.createHash("sha256").update(password).digest("hex");
```

with:

```typescript
const password = process.env.ADMIN_PASSWORD ?? "changeme123";
const hash = await bcrypt.hash(password, 12);
```

The function `seedDefaultAdminUser` is already async, so `await` works here.

- [ ] **Step 3: Test seed with fresh database**

Drop and recreate the admin user (or use a fresh database), run the seed, then verify the stored hash starts with `$2` (bcrypt prefix):

```sql
SELECT email, LEFT("passwordHash", 4) as hash_prefix FROM "User" WHERE email = 'admin@dpf.local';
```

Expected: `hash_prefix` = `$2b$` or `$2a$`

- [ ] **Step 4: Test login with the new hash**

Start the portal and log in with `admin@dpf.local` / `changeme123`. Verify login succeeds. The `password.ts` bcrypt verification path (line 13-15) should handle this directly without needing the SHA-256 legacy path.

- [ ] **Step 5: Commit**

```bash
git add packages/db/package.json packages/db/src/seed.ts pnpm-lock.yaml
git commit -m "fix: use bcrypt instead of SHA-256 for admin seed password"
```

---

## Task 8: Require AUTH_SECRET and CREDENTIAL_ENCRYPTION_KEY in Docker Compose

**Files:**
- Modify: `docker-compose.yml:75,77`

- [ ] **Step 1: Update portal service environment**

In `docker-compose.yml`, replace lines 75 and 77:

```yaml
AUTH_SECRET: ${AUTH_SECRET:-dev_secret_change_me}
```
```yaml
CREDENTIAL_ENCRYPTION_KEY: ${CREDENTIAL_ENCRYPTION_KEY:-}
```

with:

```yaml
AUTH_SECRET: ${AUTH_SECRET:?AUTH_SECRET must be set - run scripts/setup.ps1 or scripts/setup.sh first}
```
```yaml
CREDENTIAL_ENCRYPTION_KEY: ${CREDENTIAL_ENCRYPTION_KEY:?CREDENTIAL_ENCRYPTION_KEY must be set - run scripts/setup.ps1 or scripts/setup.sh first}
```

Do NOT change any other environment variables. Database defaults stay as-is.

- [ ] **Step 2: Test failure mode**

Temporarily rename `.env` to `.env.bak`, then run: `docker compose config 2>&1`

Expected: Error message containing "AUTH_SECRET must be set"

Restore: rename `.env.bak` back to `.env`

- [ ] **Step 3: Test success mode**

With `.env` restored (containing real AUTH_SECRET and CREDENTIAL_ENCRYPTION_KEY values), run: `docker compose config 2>&1`

Expected: Full config printed without errors.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "fix: require AUTH_SECRET and CREDENTIAL_ENCRYPTION_KEY in docker-compose"
```

---

## Task 9: Update Install Scripts to Generate All Secrets

**Files:**
- Modify: `scripts/fresh-install.ps1:101-109`
- Modify: `scripts/setup.ps1:49-66`
- Modify: `scripts/setup.sh:53-60`
- Modify: `.env.docker.example`

**IMPORTANT:** All `.sh` files must use LF line endings. All `.ps1` files must use plain ASCII only (no Unicode, no BOM, no smart quotes, no emoji).

- [ ] **Step 1: Update fresh-install.ps1 root .env creation**

In `scripts/fresh-install.ps1`, replace lines 101-109 (the here-string that creates root `.env`):

```powershell
$envFile = Join-Path $InstallRoot ".env"
if (-not (Test-Path $envFile)) {
    # Generate real secrets for Docker Compose
    $encKey = -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Maximum 256) })
    $authBytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($authBytes)
    $authSecret = [Convert]::ToBase64String($authBytes)

    @"
# Docker Compose defaults -- created by fresh-install.ps1
POSTGRES_USER=dpf
POSTGRES_PASSWORD=dpf_dev
DATABASE_URL=postgresql://dpf:dpf_dev@postgres:5432/dpf
NEO4J_AUTH=neo4j/dpf_dev_password
AUTH_SECRET=$authSecret
CREDENTIAL_ENCRYPTION_KEY=$encKey
ADMIN_PASSWORD=changeme123
"@ | Set-Content -Path $envFile -Encoding UTF8
    Write-Ok "Created .env with generated secrets"
} else {
    Write-Ok ".env already exists -- skipping"
}
```

Note: The here-string uses `$authSecret` and `$encKey` variables which are interpolated by PowerShell. No backtick escapes inside the here-string (per CLAUDE.md PowerShell rules).

- [ ] **Step 2: Update setup.ps1 to generate CREDENTIAL_ENCRYPTION_KEY**

In `scripts/setup.ps1`, replace lines 49-71 (the full `.env.local` creation block including the else clause) with:

```powershell
if (-not (Test-Path "apps\web\.env.local")) {
    Copy-Item ".env.example" "apps\web\.env.local"
    # Generate AUTH_SECRET
    $secret = ""
    if (Get-Command python -ErrorAction SilentlyContinue) {
        $secret = python -c "import secrets; print(secrets.token_hex(32))"
    } elseif (Get-Command python3 -ErrorAction SilentlyContinue) {
        $secret = python3 -c "import secrets; print(secrets.token_hex(32))"
    } else {
        $secret = [System.Web.Security.Membership]::GeneratePassword(64, 8)
    }
    if ($secret) {
        (Get-Content "apps\web\.env.local") -replace '<generate with: openssl rand -base64 32>', $secret |
            Set-Content "apps\web\.env.local"
    }
    # Generate CREDENTIAL_ENCRYPTION_KEY
    $encKey = -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Maximum 256) })
    (Get-Content "apps\web\.env.local") -replace '<generate with: openssl rand -hex 32>', $encKey |
        Set-Content "apps\web\.env.local"
    # Enable Docker internal URL for Ollama
    Add-Content -Path "apps\web\.env.local" -Value "OLLAMA_INTERNAL_URL=http://ollama:11434"
    Write-Ok "Created apps\web\.env.local with generated secrets"
} else {
    Write-Ok "apps\web\.env.local already exists -- skipping"
}
```

Then after the `packages\db\.env` creation block (line 76), add root `.env` generation:

```powershell
# Ensure root .env has real secrets for Docker Compose
$rootEnv = ".env"
if (-not (Test-Path $rootEnv)) {
    Copy-Item ".env.docker.example" $rootEnv
    # Generate secrets for Docker Compose env
    $authBytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($authBytes)
    $authSecret = [Convert]::ToBase64String($authBytes)
    $encKey = -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Maximum 256) })
    (Get-Content $rootEnv) -replace '<generate with: openssl rand -base64 32>', $authSecret |
        Set-Content $rootEnv
    (Get-Content $rootEnv) -replace '<generate with: openssl rand -hex 32>', $encKey |
        Set-Content $rootEnv
    Write-Ok "Created root .env with generated secrets"
}
```

- [ ] **Step 3: Update setup.sh to generate CREDENTIAL_ENCRYPTION_KEY**

In `scripts/setup.sh`, replace lines 53-63 (the full `.env.local` creation block including the else/fi) with:

```bash
if [ ! -f apps/web/.env.local ]; then
  cp .env.example apps/web/.env.local
  # Generate AUTH_SECRET
  AUTH_SECRET=$(openssl rand -hex 32 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(32))" 2>/dev/null || echo "change-me-$(date +%s)")
  sed -i "s|<generate with: openssl rand -base64 32>|$AUTH_SECRET|" apps/web/.env.local
  # Generate CREDENTIAL_ENCRYPTION_KEY
  ENC_KEY=$(openssl rand -hex 32 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(32))" 2>/dev/null || echo "change-me-$(date +%s)")
  sed -i "s|<generate with: openssl rand -hex 32>|$ENC_KEY|" apps/web/.env.local
  # Enable Docker internal URL for Ollama
  echo "OLLAMA_INTERNAL_URL=http://ollama:11434" >> apps/web/.env.local
  ok "Created apps/web/.env.local with generated secrets"
else
  ok "apps/web/.env.local already exists — skipping"
fi
```

After the `packages/db/.env` block (line 68), add:

```bash
# Ensure root .env has real secrets for Docker Compose
if [ ! -f .env ]; then
  cp .env.docker.example .env
  AUTH_SECRET=$(openssl rand -base64 32 2>/dev/null || python3 -c "import secrets,base64; print(base64.b64encode(secrets.token_bytes(32)).decode())" 2>/dev/null)
  ENC_KEY=$(openssl rand -hex 32 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(32))" 2>/dev/null)
  sed -i "s|<generate with: openssl rand -base64 32>|$AUTH_SECRET|" .env
  sed -i "s|<generate with: openssl rand -hex 32>|$ENC_KEY|" .env
  ok "Created root .env with generated secrets"
fi
```

- [ ] **Step 4: Update .env.docker.example**

Replace the entire `.env.docker.example` with:

```
# Docker Compose environment — copy to .env in the project root
#
# These variables are used by docker-compose.yml to configure containers.
# Run scripts/setup.ps1 (Windows) or scripts/setup.sh (Mac/Linux) to
# generate this file with real secrets automatically.

# PostgreSQL
POSTGRES_USER=dpf
POSTGRES_PASSWORD=dpf_dev

# Database URL (used by portal-init and portal containers)
DATABASE_URL=postgresql://dpf:dpf_dev@postgres:5432/dpf

# Neo4j
NEO4J_AUTH=neo4j/dpf_dev_password

# Auth.js secret (REQUIRED — must be a random value)
AUTH_SECRET=<generate with: openssl rand -base64 32>

# Credential encryption key (REQUIRED — must be a random value)
CREDENTIAL_ENCRYPTION_KEY=<generate with: openssl rand -hex 32>

# Default admin password (used by portal-init seed — change for non-local deployments)
ADMIN_PASSWORD=<set a strong password>
```

- [ ] **Step 5: Verify setup.sh has LF line endings**

Run: `file scripts/setup.sh`

Expected: "ASCII text" or "UTF-8 Unicode text" (no mention of "CRLF"). If CRLF, fix with `dos2unix` or git attributes.

- [ ] **Step 6: Commit**

```bash
git add scripts/fresh-install.ps1 scripts/setup.ps1 scripts/setup.sh .env.docker.example
git commit -m "fix: generate real secrets in all install scripts"
```

---

## Task 10: Add Warnings to credential-crypto.ts and neo4j.ts

**Files:**
- Modify: `apps/web/lib/credential-crypto.ts:19-21`
- Modify: `packages/db/src/neo4j.ts:16`

- [ ] **Step 1: Add encryption warning to credential-crypto.ts**

In `apps/web/lib/credential-crypto.ts`, add a module-level variable before the `encryptSecret` function and update the function. Replace lines 17-21:

```typescript
/** Encrypt a secret. Returns `enc:<iv>:<tag>:<ciphertext>` (all base64).
 *  If no encryption key is configured, returns plaintext (dev-mode fallback). */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) return plaintext;
```

with:

```typescript
let _warnedMissingKey = false;

/** Encrypt a secret. Returns `enc:<iv>:<tag>:<ciphertext>` (all base64).
 *  If no encryption key is configured, returns plaintext (dev-mode fallback). */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) {
    if (!_warnedMissingKey) {
      console.warn(
        "WARNING: CREDENTIAL_ENCRYPTION_KEY not set — credentials will be stored in plaintext. " +
          "Set this variable for production deployments."
      );
      _warnedMissingKey = true;
    }
    return plaintext;
  }
```

- [ ] **Step 2: Add production warning to neo4j.ts**

In `packages/db/src/neo4j.ts`, replace line 16:

```typescript
  const pass = process.env["NEO4J_PASSWORD"] ?? "dpf_dev_password";
```

with:

```typescript
  const pass = process.env["NEO4J_PASSWORD"] ?? "dpf_dev_password";
  if (pass === "dpf_dev_password" && process.env.NODE_ENV === "production") {
    console.warn(
      "WARNING: Using default Neo4j password in production. Set NEO4J_PASSWORD environment variable."
    );
  }
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/credential-crypto.ts packages/db/src/neo4j.ts
git commit -m "fix: add warnings for missing encryption key and default Neo4j password"
```

---

## Task 11: End-to-End Verification

**Files:** None (testing only)

- [ ] **Step 1: License audit**

Run: `pnpm dlx license-checker --summary --start packages/db`

Verify: No GPL-3.0 entries remain. All dependencies should be MIT, ISC, Apache-2.0, BSD, or compatible.

- [ ] **Step 2: Seed test on fresh database**

Reset the database and run the full seed:

```bash
pnpm --filter @dpf/db exec prisma migrate reset --force
```

Verify: Seed completes without errors. Check row counts:
```sql
SELECT 'countries' as t, COUNT(*) FROM "Country"
UNION ALL SELECT 'regions', COUNT(*) FROM "Region"
UNION ALL SELECT 'cities', COUNT(*) FROM "City";
```

Expected: ~245 countries, ~5000 regions, ~7000-9000 cities.

- [ ] **Step 3: Auth test — bcrypt admin login**

Start the portal (`pnpm --filter web dev`). Log in with `admin@dpf.local` / `changeme123`. Verify login succeeds.

Check the stored hash:
```sql
SELECT LEFT("passwordHash", 4) as prefix FROM "User" WHERE email = 'admin@dpf.local';
```

Expected: `$2b$` (bcrypt prefix).

- [ ] **Step 4: Auth test — SHA-256 backward compatibility**

Manually update a test user's hash to SHA-256 format:
```sql
UPDATE "User" SET "passwordHash" = encode(sha256('testpass123'), 'hex') WHERE email = 'admin@dpf.local';
```

Log in with `admin@dpf.local` / `testpass123`. Verify login succeeds and hash is auto-upgraded to bcrypt (re-check with the SELECT query above).

Reset the password back to `changeme123` via the UI or re-run seed.

- [ ] **Step 5: Verify install-dpf.ps1 (production installer) covers both secrets**

Read `scripts/install-dpf.ps1` (or `install-dpf.ps1` at repo root). Search for `AUTH_SECRET` and `CREDENTIAL_ENCRYPTION_KEY`. Verify both are generated using `Generate-RandomPassword` or equivalent random generation. No changes expected — this is a verification-only step.

- [ ] **Step 6: Setup script test (Windows)**

On a clean checkout (or after deleting `.env` and `apps/web/.env.local`), run `.\scripts\fresh-install.ps1` (or `.\scripts\setup.ps1`). Verify:
- Root `.env` contains `AUTH_SECRET=` with a generated value (not `dev_secret_change_me`)
- Root `.env` contains `CREDENTIAL_ENCRYPTION_KEY=` with a 64-char hex value (not empty)
- `apps/web/.env.local` contains both secrets with generated values (not placeholders)

- [ ] **Step 7: Setup script test (Linux/Mac)**

On a Linux/Mac machine (or WSL), on a clean checkout, run `./scripts/setup.sh`. Verify:
- Root `.env` contains generated `AUTH_SECRET` and `CREDENTIAL_ENCRYPTION_KEY`
- `apps/web/.env.local` contains both secrets with generated values

- [ ] **Step 8: Encryption round-trip test**

Start the portal. Navigate to Settings > AI Providers (or equivalent admin UI). Add or update a provider API key. Then check the `PlatformConfig` table:

```sql
SELECT key, LEFT(value, 4) as prefix FROM "PlatformConfig" WHERE key LIKE '%secret%' OR key LIKE '%key%';
```

Verify stored values start with `enc:` (not plaintext). This confirms `CREDENTIAL_ENCRYPTION_KEY` is active.

- [ ] **Step 9: Docker compose validation**

With `.env` containing generated secrets, run: `docker compose config > /dev/null 2>&1 && echo "OK" || echo "FAIL"`

Expected: `OK`

- [ ] **Step 10: Typecheck**

Run: `pnpm typecheck`

Verify: All packages pass TypeScript compilation without errors.

- [ ] **Step 11: Tests**

Run: `pnpm test`

Verify: All test suites pass.

- [ ] **Step 12: Final commit (if any test fixes needed)**

If any fixes were required during verification, commit them:

```bash
git add -A
git commit -m "fix: address issues found during open source readiness verification"
```
