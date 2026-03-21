-- Seed Security & Vulnerability Agent epic
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/seed-security-agent-epic.sql
--
-- Architecture notes:
--   • Autonomous AI agent in the platform workforce that continuously scans for vulnerabilities
--   • Operates at two levels: (1) platform infrastructure security, (2) generated code security
--   • Leverages existing SBOM (EP-SBOM-001) CVE pipeline and GRC compliance engine
--   • OWASP Top 10 as baseline checklist for code review
--   • Dependency vulnerability scanning via OSV.dev + NVD (extends SBOM CVE sync)
--   • Static analysis integration (semgrep rules, custom patterns)
--   • Security findings surface as Incidents in GRC engine with severity + remediation guidance
--   • Agent autonomy governed by trust lifecycle (Learning→Practicing→Innate)
--   • Build Studio integration: scans proposed code changes before promotion to production
DO $$
DECLARE
  found_id    TEXT;
  mfg_id      TEXT;
  epic_id     TEXT;
BEGIN
  SELECT id INTO found_id FROM "Portfolio" WHERE slug = 'foundational';
  SELECT id INTO mfg_id   FROM "Portfolio" WHERE slug = 'manufacturing_and_delivery';

  IF found_id IS NULL OR mfg_id IS NULL THEN
    RAISE EXCEPTION 'Expected portfolio slugs not found.';
  END IF;

  INSERT INTO "Epic" (id, "epicId", title, description, status, "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    'EP-' || gen_random_uuid()::text,
    'Security & Vulnerability Agent',
    'Autonomous AI security agent that continuously monitors the platform and generated code for vulnerabilities, misconfigurations, and compliance gaps. Operates as a workforce member with governed autonomy (trust lifecycle). Scans infrastructure (Docker configs, environment variables, exposed endpoints), dependencies (extends SBOM CVE pipeline), and code (OWASP Top 10, injection patterns, auth bypasses). Findings surface as GRC Incidents with severity ratings and actionable remediation. Integrates with Build Studio to gate code promotion on security review. Reports to the security dashboard on /platform.',
    'open', NOW(), NOW()
  ) RETURNING id INTO epic_id;

  -- Spans foundational (infrastructure security) + manufacturing_and_delivery (code/product security)
  INSERT INTO "EpicPortfolio" ("epicId", "portfolioId")
  VALUES (epic_id, found_id), (epic_id, mfg_id);

  INSERT INTO "BacklogItem" (id, "itemId", title, type, status, priority, "epicId", "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Security Agent registration: register SecurityAgent as Agent entity in workforce registry with role=security_analyst, capabilities=[vulnerability_scan, code_review, dependency_audit, config_audit, incident_creation]. Trust level starts at Learning. Autonomy profile: can create findings/incidents autonomously, but remediation PRs require human approval (Practicing). RACI: Responsible for scanning, Accountable to platform admin.',
     'portfolio', 'open', 1, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Infrastructure security scanner: scheduled scan of Docker compose files, environment variable exposure (.env patterns, secrets in config), port exposure, TLS configuration, CORS policies, CSP headers, and authentication endpoint hardening. SecurityFinding model — findingType enum (infrastructure/dependency/code/config), severity (critical/high/medium/low/info), cweId (CWE reference), title, description, affectedResource, remediationGuidance, status (open/triaged/remediated/accepted_risk/false_positive), detectedAt, resolvedAt. Findings auto-create GRC Incidents when severity >= high.',
     'portfolio', 'open', 2, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Dependency vulnerability continuous monitoring: extend SBOM CVE sync to run on configurable schedule (default: daily). When new critical/high CVEs are discovered, SecurityAgent autonomously creates SecurityFinding + GRC Incident + linked BacklogItem for remediation. Tracks time-to-remediate SLA per severity level. Dashboard widget showing dependency health trend over time.',
     'portfolio', 'open', 3, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Code security review engine: OWASP Top 10 pattern matching against platform codebase and Build Studio generated code. Patterns: SQL injection (raw query detection), XSS (unsanitised output), CSRF (missing token validation), insecure deserialization, broken auth (hardcoded secrets, missing rate limits), SSRF (unvalidated URLs), path traversal. Uses AST analysis where possible, regex fallback. SecurityFinding created per pattern match with CWE reference and fix suggestion.',
     'product', 'open', 4, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Build Studio security gate: before code promotion from sandbox to production, SecurityAgent runs full scan (infrastructure + dependency + code). SecurityGateResult model — buildId FK, scanStartedAt, scanCompletedAt, findingsCount (by severity), gateStatus enum (passed/failed/warning), blockingFindings (array of SecurityFinding IDs). Gate fails if any critical finding exists. Warning if high findings exist. Results shown on Build Studio promotion dialog with drill-down to findings.',
     'product', 'open', 5, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Secret detection and rotation tracking: scan for exposed secrets (API keys, tokens, passwords) in code, config files, environment variables, and git history. SecretFinding model extends SecurityFinding with secretType enum (api_key/token/password/certificate/private_key), exposureLocation, rotationRequired bool, rotatedAt. Alert pipeline: immediate notification to platform admin when secret detected. Integration with provider registry to flag affected AI provider tokens.',
     'product', 'open', 6, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Security posture dashboard: /platform/security route showing real-time security health — open findings by severity (donut chart), findings trend over time (line chart), mean-time-to-remediate by severity, dependency vulnerability coverage %, infrastructure scan last-run status, Build Studio gate pass/fail rate, top 5 CWEs recurring, compliance obligation coverage for security-related GRC obligations. Exportable as PDF for audit evidence.',
     'product', 'open', 7, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Automated remediation proposals: when SecurityAgent reaches Practicing trust level, it can generate remediation code patches for common patterns (dependency version bumps, CSP header fixes, input sanitisation wrappers, secret rotation scripts). Patches submitted as change proposals in Build Studio requiring human approval. Remediation linked back to SecurityFinding and GRC Incident for full audit trail. Tracks remediation success rate to inform trust lifecycle progression.',
     'product', 'open', 8, epic_id, NOW(), NOW());

  RAISE NOTICE 'Security & Vulnerability Agent epic created with 8 stories.';
END $$;
