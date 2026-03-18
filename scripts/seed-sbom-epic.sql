-- Seed SBOM Management epic
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/seed-sbom-epic.sql
--
-- Architecture notes from legacy design (2026-03-03):
--   • CycloneDX 1.6 JSON as canonical SBOM format (not SPDX)
--   • PURL (Package URL) as primary component key — PURL-native matching to OSV.dev
--   • CVE intelligence: OSV.dev (primary) → NVD/CPE (fallback) → CISA KEV overlay
--   • CISA KEV hits elevate effective severity to critical regardless of CVSS score
--   • Release gates: GATE-044 (critical CVE must have linked backlog item),
--     GATE-045 (critical active CVE blocks release unless suppressed with decision record)
--   • Weekly rescan SLA on all registered components
DO $$
DECLARE
  mfg_id  TEXT;
  epic_id TEXT;
BEGIN
  SELECT id INTO mfg_id FROM "Portfolio" WHERE slug = 'manufacturing_and_delivery';

  IF mfg_id IS NULL THEN
    RAISE EXCEPTION 'Expected portfolio slug "manufacturing_and_delivery" not found.';
  END IF;

  INSERT INTO "Epic" (id, "epicId", title, description, status, "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    'EP-' || gen_random_uuid()::text,
    'SBOM Management',
    'Software Bill of Materials tracking using CycloneDX 1.6 JSON as the canonical format. Components are keyed by PURL (Package URL spec). CVE intelligence is sourced from OSV.dev (primary, PURL-native), NVD via CPE (fallback for commercial components), and CISA KEV as a weekly overlay that elevates any actively-exploited vulnerability to critical severity regardless of CVSS score. Implements two release gates: GATE-044 (every critical CVE must have a linked backlog remediation item) and GATE-045 (critical active CVE blocks release unless suppressed with an HR-200 decision record). SBOM components are rescanned weekly. Lives in the R2D (Requirement to Deploy) value stream — Design & Develop and Accept & Publish Release phases.',
    'open', NOW(), NOW()
  ) RETURNING id INTO epic_id;

  INSERT INTO "EpicPortfolio" ("epicId", "portfolioId")
  VALUES (epic_id, mfg_id);

  INSERT INTO "BacklogItem" (id, "itemId", title, type, status, priority, "epicId", "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'SbomComponent model (Prisma): keyed on purl (unique, PURL spec e.g. pkg:npm/react@18.2.0), name, version, componentType enum (library|framework|container|firmware|device|os|application|service), originType (open_source|commercial|internal), supplier?, licenseExpression (SPDX string e.g. MIT OR Apache-2.0), sha256?, cpe? (for NVD matching); updatedAt for rescan SLA tracking',
     'portfolio', 'open', 1, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'ProductComponent join model (Prisma): DigitalProduct → SbomComponent many-to-many — digitalProductId FK, sbomComponentId FK, isDirectDependency bool, addedAt DateTime; composite unique on (digitalProductId, sbomComponentId); cascades delete when product or component is removed',
     'portfolio', 'open', 2, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'ComponentVulnerability model (Prisma): sbomComponentId FK, cveId (CVE-xxxx-xxxxx or GHSA-...), cvssScore Decimal?, cvssSeverity (critical|high|medium|low|none), inCisaKev bool (CISA KEV overlay — if true, effectiveSeverity = critical regardless of CVSS), vexStatus (not_affected|affected|fixed|under_investigation|suppressed), vexJustification?, patchedVersion?, suppressedAt?, suppressedBy (userId)?; unique on (sbomComponentId, cveId)',
     'portfolio', 'open', 3, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'SbomDocument model (Prisma): point-in-time CycloneDX snapshot — digitalProductId FK, serialNumber (urn:uuid:...), bomVersion Int, specVersion "1.6", documentJson (full CycloneDX 1.6 BOM as Json), generatedAt DateTime; read-only after creation; latest document drives the /inventory SBOM view',
     'portfolio', 'open', 4, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'CycloneDX 1.6 document generator: generateSbom(digitalProductId) server action — assembles valid CycloneDX 1.6 JSON (serialNumber urn:uuid:..., metadata.component from DigitalProduct, components[] with purl/type/name/version/licenses/hashes, vulnerabilities[] from ComponentVulnerability), persists as SbomDocument, returns downloadable JSON',
     'portfolio', 'open', 5, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'CVE intelligence sync server action: fetchVulnerabilities(sbomComponentId) — queries OSV.dev /v1/query by purl (primary); falls back to NVD /rest/json/cves/2.0 by cpe when purl yields no results; applies CISA KEV weekly feed overlay (sets inCisaKev=true, effectiveSeverity=critical); creates/updates ComponentVulnerability records; records lastCheckedAt on SbomComponent',
     'portfolio', 'open', 6, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Release gate check: checkReleaseGate(digitalProductId) returns GATE-044 status (critical CVE without a linked BacklogItem → fail) and GATE-045 status (critical ComponentVulnerability with vexStatus=affected and no suppression record → blocked); role-gated read (HR-000/HR-200/HR-300); result badge shown on product detail and /ops',
     'portfolio', 'open', 7, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     '/inventory SBOM view: per-product tab showing component list (purl, componentType badge, licenseExpression, isDirectDependency chip), vulnerability summary strip (counts by effectiveSeverity, CISA KEV flag count), VEX status filter chips, Generate SBOM button → downloads CycloneDX 1.6 JSON; GATE-044/045 status indicator; Sync CVEs button triggers fetchVulnerabilities for all components',
     'product', 'open', 8, epic_id, NOW(), NOW());

  RAISE NOTICE 'SBOM Management epic created with 8 stories.';
END $$;
