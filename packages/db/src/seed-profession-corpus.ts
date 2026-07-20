// packages/db/src/seed-profession-corpus.ts
// WSID Phase 2 (BI-871126F9): seed profession corpus wiki pages from
// docs/professions/*/wiki/. Generalises seed-wiki-kernel.ts machinery
// for open-license external sources (no kernel manifest; no Qdrant sidecar
// in Phase 2 — Qdrant seeding is a Phase 3+ extension).
//
// Idempotent: re-running advances the revision chain only when body
// content has changed; never duplicates RawSource rows, page rows,
// link edges, or source citations.

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { PrismaClient } from "../generated/client/client";
import { deriveSlug, extractPrinciplePayload, parseFrontmatter } from "./seed-wiki-kernel";
import { appendRevision, attachSource, linkPages, upsertWikiPage } from "./wiki-store";
import { extractWikilinks } from "./wiki-frontmatter";
import type { WikiPageFrontmatter } from "./wiki-frontmatter";
import {
  PROFESSION_ARCHETYPES,
  PROFESSION_COMPETENCY_LEVELS,
  PROFESSION_JURISDICTIONS,
  PROFESSION_JURISDICTION_BASES,
  isProfessionArchetype,
  isProfessionCompetencyLevel,
  isProfessionJurisdiction,
  isProfessionJurisdictionBasis,
} from "./wiki-taxonomy";

const PROFESSIONS_DIR = join(__dirname, "..", "..", "..", "docs", "professions");

// ─── External source registry (open-license BoKs only) ─────────────────────
//
// Licensed BoKs (DMBOK2, ISO SQL) remain checklist-only per spec §7.7
// (conduit rule): DPF never enrolls as a licensee. Add them here only
// after the org-supplied upload path (Phase 5) is in place.

type ExternalSourceEntry = {
  sourceType: string;
  title: string;
  url: string;
  license: string;
  abstract?: string;
  retrievedAt: string;
};

const PROFESSION_EXTERNAL_SOURCES: Record<string, ExternalSourceEntry> = {
  "owasp/sql-injection-prevention": {
    sourceType: "web-article",
    title: "OWASP SQL Injection Prevention Cheat Sheet",
    url: "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html",
    license: "CC-BY-4.0",
    abstract:
      "Comprehensive guide to preventing SQL injection via parameterized queries, " +
      "safe APIs, allow-list validation, and least-privilege database access.",
    retrievedAt: "2026-06-10",
  },
  "owasp/query-parameterization": {
    sourceType: "web-article",
    title: "OWASP Query Parameterization Cheat Sheet",
    url: "https://cheatsheetseries.owasp.org/cheatsheets/Query_Parameterization_Cheat_Sheet.html",
    license: "CC-BY-4.0",
    abstract:
      "OWASP guide to query parameterization using prepared statements in multiple " +
      "languages, preventing SQL Injection (OWASP Top 10 A03:2021).",
    retrievedAt: "2026-06-10",
  },
  "owasp/top10-a03-injection": {
    sourceType: "web-article",
    title: "OWASP Top 10 A03:2021 — Injection",
    url: "https://owasp.org/Top10/A03_2021-Injection/",
    license: "CC-BY-4.0",
    abstract:
      "OWASP Top 10 entry for injection vulnerabilities. Covers SQL injection, " +
      "NoSQL injection, OS command injection, and prevention strategies.",
    retrievedAt: "2026-06-10",
  },
  // Open data-modeling reference for the data-architect family. The licensed BoKs
  // (DAMA DMBOK2, ISO/IEC 9075) stay checklist-only per spec 7.7; PostgreSQL's
  // documentation is permissively licensed, authoritative, and the platform's own
  // database engine, so it grounds the practical/physical side of data modeling and
  // schema migration (the data-modeling half of the checklist that the existing
  // SQL-injection-focused pages left uncovered — BI-62F934C9).
  "postgresql/data-definition": {
    sourceType: "documentation",
    title: "PostgreSQL Documentation — Data Definition (DDL)",
    url: "https://www.postgresql.org/docs/current/ddl.html",
    license: "PostgreSQL",
    abstract:
      "Authoritative reference for defining relational schema in PostgreSQL: tables, " +
      "columns, data types, default values, primary and foreign keys, check/unique/not-null " +
      "constraints, inheritance, partitioning, and modifying existing tables (ALTER TABLE) — " +
      "the physical realization and evolution of a data model.",
    retrievedAt: "2026-06-20",
  },

  // ── Software-engineer family (WSID wave 2, all open-license) ──
  "owasp/asvs": {
    sourceType: "standard",
    title: "OWASP Application Security Verification Standard (ASVS) v5.0.0",
    url: "https://owasp.org/www-project-application-security-verification-standard/",
    license: "CC-BY-SA-4.0",
    abstract:
      "Vendor-neutral standard of testable application-security requirements, " +
      "tiered L1/L2/L3, used as a metric, implementation guidance, and procurement spec.",
    retrievedAt: "2026-06-13",
  },
  "owasp/top-ten": {
    sourceType: "standard",
    title: "OWASP Top 10:2025 Web Application Security Risks",
    url: "https://owasp.org/www-project-top-ten/",
    license: "CC-BY-SA-4.0",
    abstract:
      "Consensus awareness document of the ten most critical web application " +
      "security risks; 2025 edition.",
    retrievedAt: "2026-06-13",
  },
  "semver/spec": {
    sourceType: "spec",
    title: "Semantic Versioning 2.0.0",
    url: "https://semver.org/",
    license: "CC-BY-3.0",
    abstract:
      "MAJOR.MINOR.PATCH versioning scheme conveying compatibility meaning " +
      "through version increments.",
    retrievedAt: "2026-06-13",
  },
  "conventional-commits/spec": {
    sourceType: "spec",
    title: "Conventional Commits 1.0.0",
    url: "https://www.conventionalcommits.org/en/v1.0.0/",
    license: "CC-BY-3.0",
    abstract:
      "Lightweight commit-message convention adding human and machine-readable " +
      "meaning, mappable to Semantic Versioning increments.",
    retrievedAt: "2026-06-13",
  },
  "ietf/rfc-9110": {
    sourceType: "spec",
    title: "RFC 9110: HTTP Semantics (STD 97)",
    url: "https://www.rfc-editor.org/rfc/rfc9110",
    license: "IETF-Trust-BCP78",
    abstract:
      "Internet Standard defining HTTP methods, status codes, and semantics " +
      "shared across HTTP versions.",
    retrievedAt: "2026-06-13",
  },
  "slsa/framework": {
    sourceType: "framework",
    title: "SLSA — Supply-chain Levels for Software Artifacts (Build levels v1.0)",
    url: "https://slsa.dev/spec/v1.0/levels",
    license: "Community-Specification-1.0",
    abstract:
      "Framework of build levels (L0-L3) and provenance controls to prevent " +
      "software supply-chain tampering.",
    retrievedAt: "2026-06-13",
  },
  "google/eng-practices": {
    sourceType: "web-article",
    title: "Google Engineering Practices — The Standard of Code Review",
    url: "https://google.github.io/eng-practices/review/reviewer/standard.html",
    license: "CC-BY-3.0",
    abstract:
      "Code-review standard: approve once a change improves overall code health; " +
      "perfection is not required.",
    retrievedAt: "2026-06-13",
  },

  // ── Finance family (WSID wave 2, open-license fetched sources only) ──
  // FASB ASC full codification is LICENSED (conduit rule): checklist-only,
  // never ingested. SEC SOX pages blocked the fetch user-agent; the SOX
  // management-certification page is intentionally not authored from
  // un-fetched text. US-GAAP revenue doctrine is anchored on the IFRS 15
  // summary, which itself names Topic 606 (ASC 606) as the jointly-issued
  // US converged standard.
  "wikipedia/double-entry-bookkeeping": {
    sourceType: "reference",
    title: "Double-entry bookkeeping",
    url: "https://en.wikipedia.org/wiki/Double-entry_bookkeeping",
    license: "CC-BY-SA-4.0",
    abstract:
      "Definition of double-entry bookkeeping: duality, the accounting equation, " +
      "and the debits-equal-credits invariant.",
    retrievedAt: "2026-06-13",
  },
  "ifrs/ifrs-15-revenue": {
    sourceType: "standard",
    title: "IFRS 15 Revenue from Contracts with Customers (official summary)",
    url: "https://www.ifrs.org/issued-standards/list-of-standards/ifrs-15-revenue-from-contracts-with-customers/",
    license: "IFRS-summary-open",
    abstract:
      "Official IFRS 15 summary: core transfer-of-control principle and the " +
      "five-step revenue model; names the jointly-issued US Topic 606 (ASC 606).",
    retrievedAt: "2026-06-13",
  },
  "gao/green-book-internal-control": {
    sourceType: "standard",
    title: "Standards for Internal Control in the Federal Government (Green Book), GAO-14-704G",
    url: "https://www.gao.gov/assets/gao-14-704g.pdf",
    license: "US-Gov-Public-Domain",
    abstract:
      "GAO internal-control standards: the five components and the " +
      "segregation-of-duties control activity; aligned with the COSO framework.",
    retrievedAt: "2026-06-13",
  },
  "pcaob/auditing-standards": {
    sourceType: "standard",
    title: "PCAOB Auditing Standards (public)",
    url: "https://pcaobus.org/oversight/standards/auditing-standards",
    license: "PCAOB-public",
    abstract:
      "Public PCAOB auditing standards including AS 2201 (audit of internal " +
      "control over financial reporting) and AS 1105 (audit evidence).",
    retrievedAt: "2026-06-13",
  },

  // ── Security family (WSID wave 3) ──
  "nist/csf-2": {
    sourceType: "framework",
    title: "NIST Cybersecurity Framework (CSF) 2.0",
    url: "https://www.nist.gov/cyberframework",
    license: "US-Gov-Public-Domain",
    abstract:
      "NIST CSF 2.0 organizes cybersecurity risk into six Functions: Govern, " +
      "Identify, Protect, Detect, Respond, Recover.",
    retrievedAt: "2026-06-13",
  },
  "wikipedia/nist-csf": {
    sourceType: "reference",
    title: "NIST Cybersecurity Framework (encyclopedia summary)",
    url: "https://en.wikipedia.org/wiki/NIST_Cybersecurity_Framework",
    license: "CC-BY-SA-4.0",
    abstract:
      "Secondary open summary of the NIST CSF Function definitions, used where " +
      "the primary CSF 2.0 PDF was not text-extractable.",
    retrievedAt: "2026-06-13",
  },
  "cis/controls": {
    sourceType: "framework",
    title: "CIS Critical Security Controls v8.1",
    url: "https://www.cisecurity.org/controls",
    license: "CIS-free-registration",
    abstract:
      "18 prioritized security controls and 153 safeguards, grouped into three " +
      "Implementation Groups (IG1/IG2/IG3). Structure used as facts only.",
    retrievedAt: "2026-06-13",
  },
  "nist/nvd-cve": {
    sourceType: "reference",
    title: "NIST National Vulnerability Database (NVD)",
    url: "https://nvd.nist.gov/",
    license: "US-Gov-Public-Domain",
    abstract:
      "US-government vulnerability repository hosting CVE records and CVSS " +
      "severity scoring (v2/v3.x/v4.0).",
    retrievedAt: "2026-06-13",
  },
  "cyclonedx/spec": {
    sourceType: "spec",
    title: "CycloneDX Specification Overview (ECMA-424)",
    url: "https://cyclonedx.org/specification/overview/",
    license: "ECMA-424-open",
    abstract:
      "Modular bill-of-materials standard (SBOM/SaaSBOM/HBOM) for supply-chain " +
      "transparency; standardized as ECMA-424.",
    retrievedAt: "2026-06-13",
  },
  "owasp/threat-modeling": {
    sourceType: "web-article",
    title: "OWASP Threat Modeling Cheat Sheet",
    url: "https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html",
    license: "CC-BY-SA-4.0",
    abstract:
      "Four-question threat-modeling framework and the STRIDE category set; " +
      "phases of model, identify, respond, validate.",
    retrievedAt: "2026-06-13",
  },
  "owasp/secrets-management": {
    sourceType: "web-article",
    title: "OWASP Secrets Management Cheat Sheet",
    url: "https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html",
    license: "CC-BY-SA-4.0",
    abstract:
      "Eliminate hardcoded secrets; centralize, least-privilege, rotate, " +
      "encrypt, audit, and detect secrets.",
    retrievedAt: "2026-06-13",
  },

  // ── Legal & compliance family (WSID wave 3) ──
  "gdpr/art-4": {
    sourceType: "standard",
    title: "GDPR Article 4 — Definitions",
    url: "https://gdpr-info.eu/art-4-gdpr/",
    license: "OJ-EU-open-reproduction",
    abstract:
      'Defines "personal data" and "processing" under the EU General Data ' +
      "Protection Regulation.",
    retrievedAt: "2026-06-13",
  },
  "gdpr/art-6": {
    sourceType: "standard",
    title: "GDPR Article 6 — Lawfulness of processing",
    url: "https://gdpr-info.eu/art-6-gdpr/",
    license: "OJ-EU-open-reproduction",
    abstract:
      "The six lawful bases for processing personal data, including consent " +
      "and legitimate interests.",
    retrievedAt: "2026-06-13",
  },
  "gdpr/art-7": {
    sourceType: "standard",
    title: "GDPR Article 7 — Conditions for consent",
    url: "https://gdpr-info.eu/art-7-gdpr/",
    license: "OJ-EU-open-reproduction",
    abstract:
      "Consent must be demonstrable, in clear and plain language, and as easy " +
      "to withdraw as to give.",
    retrievedAt: "2026-06-13",
  },
  "gdpr/chap-3": {
    sourceType: "standard",
    title: "GDPR Chapter 3 — Rights of the data subject",
    url: "https://gdpr-info.eu/chapter-3/",
    license: "OJ-EU-open-reproduction",
    abstract:
      "Data-subject rights: access, rectification, erasure, restriction, " +
      "portability, objection, and automated-decision safeguards.",
    retrievedAt: "2026-06-13",
  },
  "ico/controller-processor-contracts": {
    sourceType: "regulator-guidance",
    title: "ICO — contracts and liabilities between controllers and processors",
    url: "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/contracts-and-liabilities-between-controllers-and-processors-multi/what-needs-to-be-included-in-the-contract/",
    license: "UK-OGL-compatible-citation",
    abstract: "UK regulator guidance on the terms required in controller-processor contracts under UK GDPR Article 28.",
    retrievedAt: "2026-07-19",
  },
  "ico/international-transfers": {
    sourceType: "regulator-guidance",
    title: "ICO — a brief guide to international transfers",
    url: "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/a-brief-guide-to-international-transfers/",
    license: "UK-OGL-compatible-citation",
    abstract: "UK regulator guidance for identifying restricted transfers and selecting a permitted transfer mechanism.",
    retrievedAt: "2026-07-19",
  },
  "openai/enterprise-privacy": {
    sourceType: "provider-terms",
    title: "OpenAI enterprise privacy",
    url: "https://openai.com/enterprise-privacy/",
    license: "provider-published-cite-by-reference",
    abstract: "Provider-published privacy and retention statements for OpenAI business products and API services; not evidence of a connected account's entitlement or configuration.",
    retrievedAt: "2026-07-19",
  },
  "anthropic/commercial-training": {
    sourceType: "provider-terms",
    title: "Anthropic — commercial product training treatment",
    url: "https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training",
    license: "provider-published-cite-by-reference",
    abstract: "Provider-published training treatment for Anthropic commercial products; distinct from consumer products and not connected-account evidence.",
    retrievedAt: "2026-07-19",
  },
  "anthropic/consumer-training": {
    sourceType: "provider-terms",
    title: "Anthropic — consumer product training treatment",
    url: "https://privacy.claude.com/en/articles/10023580-is-my-data-used-for-model-training",
    license: "provider-published-cite-by-reference",
    abstract: "Provider-published training treatment for Anthropic consumer products, illustrating why consumer and commercial channels must not be conflated.",
    retrievedAt: "2026-07-19",
  },
  "eu/ai-act": {
    sourceType: "standard",
    title: "EU AI Act — High-level summary",
    url: "https://artificialintelligenceact.eu/high-level-summary/",
    license: "open-explainer",
    abstract:
      "Summary of the EU AI Act's four risk tiers (unacceptable/high/limited/" +
      "minimal) and high-risk provider obligations. Secondary explainer.",
    retrievedAt: "2026-06-13",
  },
  "eu/cada": {
    sourceType: "standard",
    title: "EU Cloud and AI Development Act (CADA) — Commission proposal",
    url: "https://digital-strategy.ec.europa.eu/en/policies/cloud-and-ai-development-act",
    license: "open-explainer",
    abstract:
      "Commission proposal (3 June 2026) for the EU cloud/AI sovereignty framework: four Union " +
      "assurance levels gating the top tiers on EU ownership and the absence of third-country interference. " +
      "Secondary explainer; the Official Journal text is not yet final.",
    retrievedAt: "2026-06-19",
  },
  "spdx/license-list": {
    sourceType: "spec",
    title: "SPDX License List",
    url: "https://spdx.org/licenses/",
    license: "CC-BY-3.0",
    abstract:
      "Standardized short identifiers (e.g. MIT, Apache-2.0, GPL-3.0-only) for " +
      "open-source licenses and exceptions.",
    retrievedAt: "2026-06-13",
  },
  "spdx/spec": {
    sourceType: "spec",
    title: "SPDX Specification v3.0.1",
    url: "https://spdx.github.io/spdx-spec/v3.0.1/",
    license: "CC-BY-3.0",
    abstract:
      "Machine-readable SBOM and license/copyright metadata model, including " +
      "license expressions and attribution text.",
    retrievedAt: "2026-06-13",
  },
  "ccpa/oag": {
    sourceType: "standard",
    title: "California Consumer Privacy Act (CCPA), as amended by CPRA",
    url: "https://oag.ca.gov/privacy/ccpa",
    license: "US-Gov-Public-Domain",
    abstract:
      "California consumer privacy rights: know, delete, correct, opt-out of " +
      "sale/sharing, limit sensitive data, non-discrimination.",
    retrievedAt: "2026-06-13",
  },
  "coppa/govinfo": {
    sourceType: "standard",
    title: "COPPA statute — 15 U.S.C. ch. 91",
    url: "https://www.govinfo.gov/content/pkg/USCODE-2010-title15/html/USCODE-2010-title15-chap91.htm",
    license: "US-Gov-Public-Domain",
    abstract:
      "US Children's Online Privacy Protection Act: verifiable parental " +
      "consent for collecting data from children under 13; FTC-enforced.",
    retrievedAt: "2026-06-13",
  },

  // ── QA / software-quality family (WSID wave 4) ──
  // ISTQB glossary blocked the fetcher (403); test terminology is anchored on
  // fetched CC-BY-SA encyclopedia articles. ISO/IEC 25010 full text is licensed;
  // the quality-model page uses an open summary and is checklist-only.
  "owasp/wstg": {
    sourceType: "web-article",
    title: "OWASP Web Security Testing Guide",
    url: "https://owasp.org/www-project-web-security-testing-guide/",
    license: "CC-BY-SA-4.0",
    abstract:
      "Community framework of web-application security testing best practices, " +
      "addressed by stable WSTG identifiers.",
    retrievedAt: "2026-06-13",
  },
  "fowler/test-pyramid": {
    sourceType: "web-article",
    title: "The Practical Test Pyramid (Ham Vocke)",
    url: "https://martinfowler.com/articles/practical-test-pyramid.html",
    license: "article-free-to-read",
    abstract:
      "The test automation pyramid: many fast unit tests, fewer service tests, " +
      "very few slow end-to-end tests.",
    retrievedAt: "2026-06-13",
  },
  "iso25000/quality-model": {
    sourceType: "reference",
    title: "ISO/IEC 25010 product quality model (open summary)",
    url: "https://iso25000.com/index.php/en/iso-25000-standards/iso-25010",
    license: "open-summary-iso-licensed",
    abstract:
      "Open summary of the ISO/IEC 25010 product-quality characteristics. The " +
      "ISO standard itself is licensed (checklist-only).",
    retrievedAt: "2026-06-13",
  },
  "wikipedia/software-testing": {
    sourceType: "reference",
    title: "Software testing",
    url: "https://en.wikipedia.org/wiki/Software_testing",
    license: "CC-BY-SA-4.0",
    abstract:
      "Test levels (unit, integration, system, acceptance) and the " +
      "verification/validation framing.",
    retrievedAt: "2026-06-13",
  },
  "wikipedia/verification-validation": {
    sourceType: "reference",
    title: "Software verification and validation",
    url: "https://en.wikipedia.org/wiki/Software_verification_and_validation",
    license: "CC-BY-SA-4.0",
    abstract:
      'The V&V distinction: "building the product right" (static verification) ' +
      'vs "the right product" (dynamic validation).',
    retrievedAt: "2026-06-13",
  },
  "wikipedia/software-bug": {
    sourceType: "reference",
    title: "Software bug",
    url: "https://en.wikipedia.org/wiki/Software_bug",
    license: "CC-BY-SA-4.0",
    abstract:
      "Severity vs priority managed separately; reliable reproduction is the " +
      "first step to fixing a defect.",
    retrievedAt: "2026-06-13",
  },
  "wikipedia/bug-tracking": {
    sourceType: "reference",
    title: "Bug tracking system",
    url: "https://en.wikipedia.org/wiki/Bug_tracking_system",
    license: "CC-BY-SA-4.0",
    abstract:
      "Defect records capture severity, erroneous behavior, and reproduction " +
      "steps; severity is not fix complexity.",
    retrievedAt: "2026-06-13",
  },

  // ── Product-management family (WSID wave 4) ──
  // SVPG/Cagan pages blocked the fetcher (403); outcome-over-output is anchored
  // on the open Agile Alliance Product Owner page. SAFe WSJF is copyrighted
  // (paraphrased with attribution, not reproduced).
  "agile/manifesto": {
    sourceType: "reference",
    title: "Manifesto for Agile Software Development",
    url: "https://agilemanifesto.org/",
    license: "open-copy-in-entirety",
    abstract:
      "The four Agile values (individuals/interactions, working software, " +
      "customer collaboration, responding to change).",
    retrievedAt: "2026-06-13",
  },
  "agile/principles": {
    sourceType: "reference",
    title: "Principles behind the Agile Manifesto",
    url: "https://agilemanifesto.org/principles.html",
    license: "open-copy-in-entirety",
    abstract:
      "The twelve principles underpinning the Agile values, including early " +
      "continuous delivery and welcoming change.",
    retrievedAt: "2026-06-13",
  },
  "scrum/guide-2020": {
    sourceType: "framework",
    title: "The 2020 Scrum Guide",
    url: "https://scrumguides.org/scrum-guide.html",
    license: "CC-BY-SA-4.0",
    abstract:
      "Defines the ordered, refined Product Backlog, Product Owner " +
      "accountability, Product Goal, Increment, and Definition of Done.",
    retrievedAt: "2026-06-13",
  },
  "safe/wsjf": {
    sourceType: "framework",
    title: "WSJF — Weighted Shortest Job First (SAFe)",
    url: "https://framework.scaledagile.com/wsjf/",
    license: "Scaled-Agile-copyright",
    abstract:
      "WSJF = relative cost of delay divided by relative job duration; sequence " +
      "shortest high-cost-of-delay jobs first. Paraphrased, attributed.",
    retrievedAt: "2026-06-13",
  },
  "agile-alliance/invest": {
    sourceType: "reference",
    title: "INVEST (Agile Alliance glossary)",
    url: "https://www.agilealliance.org/glossary/invest/",
    license: "open-attribution",
    abstract:
      "Checklist for user-story quality: Independent, Negotiable, Valuable, " +
      "Estimable, Small, Testable.",
    retrievedAt: "2026-06-13",
  },
  "agile-alliance/acceptance": {
    sourceType: "reference",
    title: "Acceptance / Acceptance Testing (Agile Alliance glossary)",
    url: "https://www.agilealliance.org/glossary/acceptance/",
    license: "open-attribution",
    abstract:
      "An acceptance test is a formal, example-based description of product " +
      "behavior yielding a binary pass/fail.",
    retrievedAt: "2026-06-13",
  },
  "agile-alliance/definition-of-done": {
    sourceType: "reference",
    title: "Definition of Done (Agile Alliance glossary)",
    url: "https://www.agilealliance.org/glossary/definition-of-done/",
    license: "open-attribution",
    abstract:
      "Criteria an increment must meet to be considered done; references a " +
      "companion Definition of Ready.",
    retrievedAt: "2026-06-13",
  },
  "agile-alliance/product-owner": {
    sourceType: "reference",
    title: "Product Owner (Agile Alliance glossary)",
    url: "https://www.agilealliance.org/glossary/product-owner/",
    license: "open-attribution",
    abstract:
      "The Product Owner prioritizes the backlog to deliver maximum outcome " +
      "with minimum output.",
    retrievedAt: "2026-06-13",
  },

  // ── Frontend-engineer + UX/accessibility families (WSID wave 5) ──
  // w3c/wcag22 is shared by both families (registered once). W3C docs are open
  // (W3C Document License); MDN is CC-BY-SA; web.dev is CC-BY-4.0. NN/G and
  // WebAIM are licensed (no open license) — cited by reference with attribution,
  // quotes kept short; their structure (heuristic names, contrast ratios that
  // are also normative in the open WCAG) is used as facts, not reproduced prose.
  "w3c/wcag22": {
    sourceType: "standard",
    title: "Web Content Accessibility Guidelines (WCAG) 2.2",
    url: "https://www.w3.org/TR/WCAG22/",
    license: "W3C-Document-License",
    abstract:
      "W3C Recommendation defining accessibility under four POUR principles and " +
      "conformance levels A/AA/AAA, with testable success criteria.",
    retrievedAt: "2026-06-13",
  },
  "w3c/aria-apg": {
    sourceType: "standard",
    title: "ARIA Authoring Practices Guide (APG)",
    url: "https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/",
    license: "W3C-Document-License",
    abstract:
      'WAI guidance on correct ARIA use: "No ARIA is better than Bad ARIA"; a ' +
      "role is a promise to implement its interactions.",
    retrievedAt: "2026-06-13",
  },
  "w3c/using-aria": {
    sourceType: "standard",
    title: "Using ARIA",
    url: "https://www.w3.org/TR/using-aria/",
    license: "W3C-Document-License",
    abstract:
      "Defines the First Rule of ARIA: prefer a native HTML element over " +
      "re-purposing one with an ARIA role.",
    retrievedAt: "2026-06-13",
  },
  "w3c/wai-intro": {
    sourceType: "standard",
    title: "Introduction to Web Accessibility (W3C WAI)",
    url: "https://www.w3.org/WAI/fundamentals/accessibility-intro/",
    license: "W3C-Document-License",
    abstract:
      "Defines web accessibility and who benefits; accessibility is most " +
      "efficient when built in from project inception.",
    retrievedAt: "2026-06-13",
  },
  "mdn/html": {
    sourceType: "reference",
    title: "HTML: HyperText Markup Language (MDN)",
    url: "https://developer.mozilla.org/en-US/docs/Web/HTML",
    license: "CC-BY-SA-2.5",
    abstract:
      "HTML defines the meaning and structure of web content; meaning belongs " +
      "to HTML, appearance to CSS.",
    retrievedAt: "2026-06-13",
  },
  "mdn/accessibility": {
    sourceType: "reference",
    title: "Accessibility (MDN)",
    url: "https://developer.mozilla.org/en-US/docs/Web/Accessibility",
    license: "CC-BY-SA-2.5",
    abstract:
      "Accessibility enables as many people as possible to use sites; covers " +
      "text alternatives and keyboard access.",
    retrievedAt: "2026-06-13",
  },
  "mdn/img": {
    sourceType: "reference",
    title: "<img>: the Image embed element (MDN)",
    url: "https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img",
    license: "CC-BY-SA-2.5",
    abstract:
      "The alt attribute is mandatory: a concise text replacement for image " +
      "content; alt=\"\" only for decorative images.",
    retrievedAt: "2026-06-13",
  },
  "webdev/core-web-vitals": {
    sourceType: "web-article",
    title: "Web Vitals (web.dev)",
    url: "https://web.dev/articles/vitals",
    license: "CC-BY-4.0",
    abstract:
      "Core Web Vitals targets: LCP <= 2.5s, INP <= 200ms, CLS <= 0.1, assessed " +
      "at the 75th percentile across mobile and desktop.",
    retrievedAt: "2026-06-13",
  },
  "nng/ten-heuristics": {
    sourceType: "web-article",
    title: "10 Usability Heuristics for User Interface Design (Nielsen Norman Group)",
    url: "https://www.nngroup.com/articles/ten-usability-heuristics/",
    license: "NNG-copyright-cite-by-reference",
    abstract:
      "Nielsen's ten general usability heuristics. Licensed; cited by reference " +
      "with attribution, not reproduced.",
    retrievedAt: "2026-06-13",
  },
  "nng/heuristic-evaluation": {
    sourceType: "web-article",
    title: "How to Conduct a Heuristic Evaluation (Nielsen Norman Group)",
    url: "https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/",
    license: "NNG-copyright-cite-by-reference",
    abstract:
      "Three-phase heuristic-evaluation method using 3-5 independent evaluators. " +
      "Licensed; cited by reference.",
    retrievedAt: "2026-06-13",
  },
  "webaim/contrast": {
    sourceType: "web-article",
    title: "Contrast and Color Accessibility (WebAIM)",
    url: "https://webaim.org/articles/contrast/",
    license: "WebAIM-copyright-cite-by-reference",
    abstract:
      "Explains WCAG 2 contrast ratios (4.5:1 normal, 3:1 large, 7:1 AAA) and " +
      "the definition of large text. Licensed; cited by reference.",
    retrievedAt: "2026-06-13",
  },

  // ── Documentation & content family (WSID wave 6, open-license) ──
  "diataxis/framework": {
    sourceType: "framework",
    title: "Diataxis — A systematic approach to technical documentation",
    url: "https://diataxis.fr/",
    license: "CC-BY-SA-4.0",
    abstract:
      "Documentation framework defining four modes (tutorials, how-to guides, " +
      "reference, explanation) across content, style, and architecture.",
    retrievedAt: "2026-06-13",
  },
  "diataxis/tutorials": {
    sourceType: "framework",
    title: "Tutorials — Diataxis",
    url: "https://diataxis.fr/tutorials/",
    license: "CC-BY-SA-4.0",
    abstract:
      "Learning-oriented documentation: the teacher takes responsibility for the " +
      "learner's success through guided doing.",
    retrievedAt: "2026-06-13",
  },
  "diataxis/how-to-guides": {
    sourceType: "framework",
    title: "How-to guides — Diataxis",
    url: "https://diataxis.fr/how-to-guides/",
    license: "CC-BY-SA-4.0",
    abstract:
      "Task-oriented directions guiding a competent user toward a real-world goal; " +
      "action, not teaching.",
    retrievedAt: "2026-06-13",
  },
  "diataxis/reference": {
    sourceType: "framework",
    title: "Reference — Diataxis",
    url: "https://diataxis.fr/reference/",
    license: "CC-BY-SA-4.0",
    abstract:
      "Information-oriented, austere technical description whose structure mirrors " +
      "the product; describe and only describe.",
    retrievedAt: "2026-06-13",
  },
  "diataxis/explanation": {
    sourceType: "framework",
    title: "Explanation — Diataxis",
    url: "https://diataxis.fr/explanation/",
    license: "CC-BY-SA-4.0",
    abstract:
      "Understanding-oriented, discursive documentation giving context, reasons, " +
      "and connections, distinct from active practice.",
    retrievedAt: "2026-06-13",
  },
  "mermaid/intro": {
    sourceType: "web-article",
    title: "Mermaid — Overview / Introduction",
    url: "https://mermaid.js.org/intro/",
    license: "MIT",
    abstract:
      "JavaScript diagramming tool rendering Markdown-inspired text into diagrams " +
      "(diagram-as-code); many diagram types.",
    retrievedAt: "2026-06-13",
  },
  "google/dev-style": {
    sourceType: "web-article",
    title: "Google developer documentation style guide",
    url: "https://developers.google.com/style",
    license: "CC-BY-4.0",
    abstract:
      "Technical-writing voice/clarity guide: conversational, global audience, " +
      "second person, active voice, conditions before instructions.",
    retrievedAt: "2026-06-13",
  },

  // ── Enterprise-architecture family (WSID wave 6) ──
  // The Open Group full specs (ArchiMate 3.2, TOGAF Standard, IT4IT 3.0 snapshot)
  // are OAuth-gated / purchase-licensed: structure (layer names, ADM phases,
  // value-stream names) is used as facts from the public overviews; element-level
  // detail requires the licensed copy. ADR (Nygard) is CC0/public-domain.
  "opengroup/archimate-3-2": {
    sourceType: "standard",
    title: "ArchiMate 3.2 Specification (public overview)",
    url: "https://pubs.opengroup.org/architecture/archimate3-doc/",
    license: "OpenGroup-licensed",
    abstract:
      "Open EA modeling language relating Business, Application, and Technology " +
      "layers via service-orientation. Full spec OAuth-gated.",
    retrievedAt: "2026-06-13",
  },
  "opengroup/togaf": {
    sourceType: "framework",
    title: "TOGAF Standard — Overview",
    url: "https://www.opengroup.org/togaf",
    license: "OpenGroup-licensed",
    abstract:
      "EA methodology whose core is the Architecture Development Method (ADM). " +
      "Full standard is purchase-licensed.",
    retrievedAt: "2026-06-13",
  },
  "opengroup/it4it": {
    sourceType: "framework",
    title: "IT4IT Reference Architecture — Overview",
    url: "https://www.opengroup.org/it4it",
    license: "OpenGroup-licensed",
    abstract:
      "Value-stream-based reference architecture for digital/IT management; four " +
      "value streams S2P, R2D, R2F, D2C.",
    retrievedAt: "2026-06-13",
  },
  "conexiam/togaf-adm": {
    sourceType: "web-article",
    title: "TOGAF ADM Phases Explained (Conexiam)",
    url: "https://conexiam.com/togaf-adm-phases-explained/",
    license: "web-article-public",
    abstract:
      "Per-phase purpose of the TOGAF ADM: Preliminary plus phases A through H, " +
      "with central Requirements Management.",
    retrievedAt: "2026-06-13",
  },
  "adr/github": {
    sourceType: "web-article",
    title: "Architectural Decision Records (ADR)",
    url: "https://adr.github.io/",
    license: "open-community",
    abstract:
      "Community home for ADRs: an architectural decision is a justified, " +
      "architecturally-significant design choice; ADRs form a decision log.",
    retrievedAt: "2026-06-13",
  },
  "nygard/adr": {
    sourceType: "web-article",
    title: "Documenting Architecture Decisions (Michael Nygard)",
    url: "https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions",
    license: "CC0-public-domain",
    abstract:
      "The original ADR format: Title, Status, Context, Decision, Consequences; " +
      "record the rationale, not just the outcome.",
    retrievedAt: "2026-06-13",
  },
  "conway/law": {
    sourceType: "reference",
    title: "Conway's Law (author's page)",
    url: "https://www.melconway.com/Home/Conways_Law.html",
    license: "author-site-open",
    abstract:
      "Canonical statement of Conway's Law from \"How Do Committees Invent?\" " +
      "(Datamation, April 1968).",
    retrievedAt: "2026-06-13",
  },
  "techtarget/it4it": {
    sourceType: "web-article",
    title: "What is IT4IT? (TechTarget)",
    url: "https://www.techtarget.com/whatis/definition/IT4IT",
    license: "TechTarget-copyright-cite-by-reference",
    abstract:
      "Secondary explainer of the four IT4IT value streams (S2P, R2D, R2F, D2C). " +
      "Licensed; cited by reference.",
    retrievedAt: "2026-06-13",
  },

  // ── IT operations / SRE family (WSID wave 6/7) ──
  // NIST SP 800-61 Rev.2 was withdrawn 2025-04-03 (superseded by Rev.3); the
  // IR-lifecycle phases are durable doctrine cited via an open secondary
  // explainer because the primary PDF did not text-extract. ITIL 4 is licensed
  // (PeopleCert/Axelos): incident-vs-problem doctrine uses an open explainer,
  // never ITIL spec text. Google SRE book is CC-BY-NC-ND (cited, not modified).
  "nist/sp-800-61": {
    sourceType: "standard",
    title: "NIST SP 800-61 Computer Security Incident Handling Guide",
    url: "https://csrc.nist.gov/pubs/sp/800/61/r2/final",
    license: "US-Gov-Public-Domain",
    abstract:
      "NIST incident-response lifecycle (preparation; detection & analysis; " +
      "containment/eradication/recovery; post-incident). Rev.2 withdrawn; see Rev.3.",
    retrievedAt: "2026-06-13",
  },
  "rapid7/nist-ir-lifecycle": {
    sourceType: "web-article",
    title: "Introduction to the NIST SP 800-61 Incident Response Life Cycle",
    url: "https://www.rapid7.com/blog/post/2017/01/11/introduction-to-incident-response-life-cycle-of-nist-sp-800-61/",
    license: "web-article-public",
    abstract:
      "Open secondary explainer of the four NIST SP 800-61 incident-response " +
      "lifecycle phases.",
    retrievedAt: "2026-06-13",
  },
  "opentelemetry/observability-primer": {
    sourceType: "spec",
    title: "OpenTelemetry Observability Primer",
    url: "https://opentelemetry.io/docs/concepts/observability-primer/",
    license: "CC-BY-4.0",
    abstract:
      "Defines observability and the three signals (traces, metrics, logs), " +
      "spans, and distributed tracing; vendor-neutral CNCF framework.",
    retrievedAt: "2026-06-13",
  },
  "google/sre-book-slo": {
    sourceType: "reference",
    title: "Google SRE Book — Service Level Objectives",
    url: "https://sre.google/sre-book/service-level-objectives/",
    license: "CC-BY-NC-ND-4.0",
    abstract:
      "Defines SLI, SLO, and SLA; advocates a handful of representative " +
      "indicators and percentiles over averages.",
    retrievedAt: "2026-06-13",
  },
  "google/sre-book-risk": {
    sourceType: "reference",
    title: "Google SRE Book — Embracing Risk",
    url: "https://sre.google/sre-book/embracing-risk/",
    license: "CC-BY-NC-ND-4.0",
    abstract:
      "Error budgets as the gap between target and 100%; the reliability-vs-" +
      "innovation trade-off.",
    retrievedAt: "2026-06-13",
  },
  "google/sre-book-postmortem": {
    sourceType: "reference",
    title: "Google SRE Book — Postmortem Culture",
    url: "https://sre.google/sre-book/postmortem-culture/",
    license: "CC-BY-NC-ND-4.0",
    abstract:
      "Blameless postmortems: fix systems and processes, not people; defined " +
      "triggers and mandatory review.",
    retrievedAt: "2026-06-13",
  },
  "betterstack/severity-levels": {
    sourceType: "web-article",
    title: "Incident Severity Levels (SEV1-SEV3)",
    url: "https://betterstack.com/community/guides/incident-management/severity-levels/",
    license: "CC-BY-NC-SA-4.0",
    abstract:
      "Defines incident severity levels SEV1/SEV2/SEV3 and the severity-vs-" +
      "priority distinction.",
    retrievedAt: "2026-06-13",
  },
  "itsm-tools/incident-vs-problem": {
    sourceType: "web-article",
    title: "Incident vs Problem Management (open explainer)",
    url: "https://itsm.tools/incident-vs-problem-management/",
    license: "web-article-public",
    abstract:
      "Open explainer of the ITIL distinction: incident management restores " +
      "service; problem management eliminates recurring causes.",
    retrievedAt: "2026-06-13",
  },

  // ── Archetype-specific craft (WSID archetype axis, first wave) ──
  // Dispatch-native compliance gates the dispatcher owns, one per archetype.
  // automotive-services: ADAS recalibration after glass / alignment work.
  "wikipedia/adas": {
    sourceType: "reference",
    title: "Advanced driver-assistance system",
    url: "https://en.wikipedia.org/wiki/Advanced_driver-assistance_system",
    license: "CC-BY-SA-4.0",
    abstract:
      "ADAS use windshield-mounted cameras/sensors; mechanical alignment or " +
      "collision/glass work can require recalibration (an automatic reset) to " +
      "keep the safety systems accurate.",
    retrievedAt: "2026-06-16",
  },
  // trades-maintenance: EPA Section 608 technician certification for refrigerant work.
  "epa/section-608": {
    sourceType: "standard",
    title: "Section 608 Technician Certification Requirements (US EPA)",
    url: "https://www.epa.gov/section608/section-608-technician-certification-requirements",
    license: "US-Gov-Public-Domain",
    abstract:
      "EPA Clean Air Act §608: technicians who maintain, service, repair, or " +
      "dispose of refrigerant-containing equipment must be certified (Type I/II/" +
      "III/Universal); knowingly venting refrigerants is prohibited.",
    retrievedAt: "2026-06-16",
  },
  // moving-and-logistics: FMCSA hours-of-service limits for commercial drivers.
  "fmcsa/hours-of-service": {
    sourceType: "reference",
    title: "Hours of service (FMCSA, via encyclopedia summary)",
    url: "https://en.wikipedia.org/wiki/Hours_of_service",
    license: "CC-BY-SA-4.0",
    abstract:
      "FMCSA hours-of-service limits for commercial motor vehicle drivers: " +
      "11-hour driving limit, 14-hour on-duty window, 30-minute break, 60/70-hour " +
      "weekly caps; hours logged via logbook or ELD.",
    retrievedAt: "2026-06-16",
  },

  // ── Jurisdiction-basis exemplars (WSID regional-basis model) ──
  // global basis: PCI DSS applies wherever cards are handled (card-brand
  // contract, not a regional law).
  "wikipedia/pci-dss": {
    sourceType: "reference",
    title: "Payment Card Industry Data Security Standard",
    url: "https://en.wikipedia.org/wiki/Payment_Card_Industry_Data_Security_Standard",
    license: "CC-BY-SA-4.0",
    abstract:
      "PCI DSS is a global data security standard regulating how entities store, " +
      "process, and transmit cardholder data; enforced by the card brands by " +
      "contract, not by a regional government — it applies everywhere cards are handled.",
    retrievedAt: "2026-06-16",
  },

  // ── HR / people-ops family (WSID wave 7) — jurisdiction split us vs eu ──
  // SHRM BASK is licensed (cluster names used as facts, checklist-only). EEOC
  // and EU Your-Europe are public-domain/open-reuse. US OPM/HHS interview
  // pages blocked the fetcher; structured-interviewing is anchored on an open
  // vendor explainer.
  "eeoc/prohibited-practices": {
    sourceType: "standard",
    title: "EEOC — Prohibited Employment Policies/Practices",
    url: "https://www.eeoc.gov/prohibited-employment-policiespractices",
    license: "US-Gov-Public-Domain",
    abstract:
      "US protected bases and prohibited practices across the employment " +
      "lifecycle (ads, hiring, pay, discipline, harassment).",
    retrievedAt: "2026-06-13",
  },
  "eeoc/eeo-laws": {
    sourceType: "standard",
    title: "EEOC — Equal Employment Opportunity Laws",
    url: "https://www.eeoc.gov/equal-employment-opportunity-laws",
    license: "US-Gov-Public-Domain",
    abstract:
      "Overview of the EEOC's role and the federal anti-discrimination statutes " +
      "it enforces.",
    retrievedAt: "2026-06-13",
  },
  "eeoc/federal-laws-qa": {
    sourceType: "standard",
    title: "EEOC — Federal Laws Prohibiting Job Discrimination (Q&A)",
    url: "https://www.eeoc.gov/fact-sheet/federal-laws-prohibiting-job-discrimination-questions-and-answers",
    license: "US-Gov-Public-Domain",
    abstract:
      "Title VII, EPA, ADEA, ADA, Rehabilitation Act, GINA — protected bases " +
      "and employer-size coverage thresholds.",
    retrievedAt: "2026-06-13",
  },
  "eu/employment-termination": {
    sourceType: "standard",
    title: "Terminating employment contracts in the EU (Your Europe)",
    url: "https://europa.eu/youreurope/business/human-resources/general-employment-terms-conditions/terminating-employment-contracts/index_en.htm",
    license: "EC-reuse-attribution",
    abstract:
      "EU dismissal protection: non-discrimination, pregnancy/parental " +
      "protection, employer burden of proof, collective-redundancy consultation.",
    retrievedAt: "2026-06-13",
  },
  "gdpr/art-88": {
    sourceType: "standard",
    title: "GDPR Article 88 — Processing in the employment context",
    url: "https://gdpr-info.eu/art-88-gdpr/",
    license: "OJ-EU-open-reproduction",
    abstract:
      "Member states may set employee-data rules with safeguards for dignity, " +
      "monitoring transparency, and intra-group transfers.",
    retrievedAt: "2026-06-13",
  },
  "shrm/bask": {
    sourceType: "framework",
    title: "SHRM Body of Applied Skills and Knowledge (BASK)",
    url: "https://www.shrm.org/credentials/certification/exam-preparation/bask",
    license: "SHRM-copyright-checklist-only",
    abstract:
      "SHRM competency clusters (Leadership, Interpersonal, Business) + HR " +
      "Expertise. Licensed; cluster names used as facts only.",
    retrievedAt: "2026-06-13",
  },
  "atwill/cornell-lii": {
    sourceType: "reference",
    title: "Employment-at-will doctrine (Cornell LII Wex)",
    url: "https://www.law.cornell.edu/wex/employment-at-will_doctrine",
    license: "Cornell-LII-educational",
    abstract:
      "US at-will employment and its exceptions: public policy, implied " +
      "contract, implied covenant of good faith.",
    retrievedAt: "2026-06-13",
  },
  "interview/structured": {
    sourceType: "web-article",
    title: "Structured Interviews — guide",
    url: "https://www.pin.com/blog/structured-interviews-guide/",
    license: "web-article-public",
    abstract:
      "Same questions/order/rubric for all candidates; behavioral vs " +
      "situational; higher validity and legal defensibility than unstructured.",
    retrievedAt: "2026-06-13",
  },

  // ── Customer-success family (WSID wave 8) ──
  // Only wikipedia/nps is open; NN/G, Intercom, Gainsight, Bain are licensed/
  // vendor and cited by reference (short attributed quotes, facts only). CSA
  // manifesto blocked the fetcher (403) and is not authored from.
  "wikipedia/nps": {
    sourceType: "reference",
    title: "Net Promoter Score",
    url: "https://en.wikipedia.org/wiki/Net_promoter_score",
    license: "CC-BY-SA-4.0",
    abstract:
      "NPS: the recommend question, promoter/passive/detractor bands, and the " +
      "%promoters - %detractors formula.",
    retrievedAt: "2026-06-13",
  },
  "nng/journey-mapping": {
    sourceType: "web-article",
    title: "Customer Journey Mapping (Nielsen Norman Group)",
    url: "https://www.nngroup.com/articles/customer-journey-mapping/",
    license: "NNG-copyright-cite-by-reference",
    abstract:
      "Journey maps combine storytelling and visualization of user goals, " +
      "phases, actions, emotions, touchpoints, and opportunities.",
    retrievedAt: "2026-06-13",
  },
  "nng/service-blueprints": {
    sourceType: "web-article",
    title: "Service Blueprints: Definition (Nielsen Norman Group)",
    url: "https://www.nngroup.com/articles/service-blueprints-definition/",
    license: "NNG-copyright-cite-by-reference",
    abstract:
      "Service blueprints map frontstage/backstage/support layers and the " +
      "interaction, visibility, and internal-interaction lines.",
    retrievedAt: "2026-06-13",
  },
  "intercom/aha-moments": {
    sourceType: "web-article",
    title: "Understanding your aha moments (Intercom)",
    url: "https://www.intercom.com/blog/understanding-your-aha-moments-and-putting-them-to-work/",
    license: "vendor-copyright-cite-by-reference",
    abstract:
      "Distinguishes the user's value-discovery aha moment from company-defined " +
      "activation in onboarding.",
    retrievedAt: "2026-06-13",
  },
  "bain/net-promoter-system": {
    sourceType: "web-article",
    title: "Measuring Your Net Promoter Score (Bain)",
    url: "https://www.netpromotersystem.com/about/measuring-your-net-promoter-score/",
    license: "vendor-copyright-cite-by-reference",
    abstract:
      "Bain's Net Promoter System: the ultimate question, score bands, and the " +
      "economics of promoters vs detractors.",
    retrievedAt: "2026-06-13",
  },
  "gainsight/cs-guide": {
    sourceType: "web-article",
    title: "The Essential Guide to Customer Success (Gainsight)",
    url: "https://www.gainsight.com/guides/the-essential-guide-to-customer-success/",
    license: "vendor-copyright-cite-by-reference",
    abstract:
      "Defines customer success as proactive and outcome-focused, contrasted " +
      "with reactive support; the CSM lifecycle role.",
    retrievedAt: "2026-06-13",
  },
  "gainsight/health-scores": {
    sourceType: "web-article",
    title: "Customer Health Scores (Gainsight)",
    url: "https://www.gainsight.com/blog/customer-health-scores/",
    license: "vendor-copyright-cite-by-reference",
    abstract:
      "Health-score components and models (traffic-light / 0-100) with " +
      "alert-and-playbook intervention on score decay.",
    retrievedAt: "2026-06-13",
  },

  // ── Strategy & executive family (WSID wave 8) ──
  // No CC/public-domain source exists for these frameworks; all are openly
  // readable but copyrighted. Cited by reference with short attributed quotes;
  // doctrine is distilled framework facts (OKR structure, BSC perspectives),
  // never reproduced prose.
  "whatmatters/okr": {
    sourceType: "framework",
    title: "OKR Meaning, Definition & Example (What Matters)",
    url: "https://www.whatmatters.com/faqs/okr-meaning-definition-example",
    license: "copyright-cite-by-reference",
    abstract:
      "OKRs pair one Objective with 3-5 measurable Key Results; the " +
      '"I will (Objective) as measured by (Key Results)" template.',
    retrievedAt: "2026-06-13",
  },
  "bsi/balanced-scorecard": {
    sourceType: "framework",
    title: "Balanced Scorecard Basics (Balanced Scorecard Institute)",
    url: "https://balancedscorecard.org/bsc-basics/",
    license: "copyright-cite-by-reference",
    abstract:
      "The Balanced Scorecard's four perspectives (financial, customer, " +
      "internal process, learning & growth) translating strategy into measures.",
    retrievedAt: "2026-06-13",
  },
  "bsi/strategy": {
    sourceType: "framework",
    title: "Cascading — Creating Alignment (Balanced Scorecard Institute)",
    url: "https://balancedscorecard.org/cascading-creating-alignment/",
    license: "copyright-cite-by-reference",
    abstract:
      "Cascading scorecards across tiers to create line-of-sight between daily " +
      "work and high-level strategy.",
    retrievedAt: "2026-06-13",
  },
  "mooncamp/okr-vs-kpi": {
    sourceType: "web-article",
    title: "OKR vs KPI: Differences & Synergies (Mooncamp)",
    url: "https://mooncamp.com/blog/okr-vs-kpi",
    license: "copyright-cite-by-reference",
    abstract:
      "Contrasts OKRs (leading indicators, drive change) with KPIs (lagging " +
      "indicators, monitor health); the two are complementary.",
    retrievedAt: "2026-06-13",
  },

  // ── External-intelligence / scouting family (WSID wave 9) ──
  // MCP and npm docs are open developer documentation; OWASP is CC-BY-SA;
  // Smithery docs page is open (homepage 403'd, not authored from). Product
  // School build-vs-buy is licensed (cited by reference).
  "mcp/intro": {
    sourceType: "spec",
    title: "Model Context Protocol — Introduction",
    url: "https://modelcontextprotocol.io/",
    license: "open-docs",
    abstract:
      'MCP is an open standard connecting AI applications to external systems — ' +
      '"like a USB-C port for AI applications."',
    retrievedAt: "2026-06-13",
  },
  "mcp/architecture": {
    sourceType: "spec",
    title: "Model Context Protocol — Architecture",
    url: "https://modelcontextprotocol.io/docs/concepts/architecture",
    license: "open-docs",
    abstract:
      "MCP client-server architecture; servers expose tools, resources, and " +
      "prompts discovered by clients via list methods.",
    retrievedAt: "2026-06-13",
  },
  "smithery/registry-docs": {
    sourceType: "web-article",
    title: "Smithery Registry — Search Servers (docs)",
    url: "https://smithery.ai/docs/concepts/registry_search_servers",
    license: "open-docs",
    abstract:
      "Smithery is a searchable registry of MCP servers with full-text/semantic " +
      "search and usage + verification signals.",
    retrievedAt: "2026-06-13",
  },
  "npm/registry-docs": {
    sourceType: "web-article",
    title: "About the public npm registry",
    url: "https://docs.npmjs.com/about-the-public-npm-registry",
    license: "open-docs",
    abstract:
      "The public npm registry is a database of JavaScript packages, each with " +
      "software and metadata.",
    retrievedAt: "2026-06-13",
  },
  "npm/semver": {
    sourceType: "web-article",
    title: "About semantic versioning (npm)",
    url: "https://docs.npmjs.com/about-semantic-versioning",
    license: "open-docs",
    abstract:
      "npm semantic versioning: MAJOR.MINOR.PATCH conveys breaking / feature / " +
      "bug-fix change scope.",
    retrievedAt: "2026-06-13",
  },
  "owasp/component-analysis": {
    sourceType: "web-article",
    title: "OWASP Component Analysis",
    url: "https://owasp.org/www-community/Component_Analysis",
    license: "CC-BY-SA-4.0",
    abstract:
      "Process for identifying risk from third-party/open-source components: " +
      "vulnerability age, component currency, ongoing maintenance cost.",
    retrievedAt: "2026-06-13",
  },
  "owasp/dependency-chain-abuse": {
    sourceType: "web-article",
    title: "OWASP CICD-SEC-3: Dependency Chain Abuse",
    url: "https://owasp.org/www-project-top-10-ci-cd-security-risks/CICD-SEC-03-Dependency-Chain-Abuse",
    license: "CC-BY-SA-4.0",
    abstract:
      "Dependency confusion, hijacking, typosquatting, and brandjacking attack " +
      "vectors against the software supply chain.",
    retrievedAt: "2026-06-13",
  },
  "productschool/build-vs-buy": {
    sourceType: "web-article",
    title: "Build vs Buy: Making Smarter Software Decisions (Product School)",
    url: "https://productschool.com/blog/leadership/build-vs-buy",
    license: "copyright-cite-by-reference",
    abstract:
      "Build/buy framework across cost/TCO, time-to-market, capability, " +
      "expertise, and strategic control. Licensed; cited by reference.",
    retrievedAt: "2026-06-13",
  },
};

// ─── Merge-gated families' source registry (WSID wave 10) ──────────────────────
//
// This SECOND source object exists for a concurrency reason, not a semantic one.
// The five families below (devops-platform, scrum-master, portfolio-management,
// marketing, release-service-management) reuse source keys (e.g. cyclonedx/spec,
// spdx/spec, gdpr/art-7, scrum/guide-2020, safe/wsjf, opentelemetry/
// observability-primer) that are introduced in still-open sibling PRs. Declaring
// them again inside the first object would (a) collide textually at its shared
// closing brace with those PRs, and (b) risk a duplicate key once both merge.
//
// Keeping them in a separate object literal that is spread-merged below avoids
// both: the two literals occupy different file regions (no git conflict), and a
// key appearing in both literals is resolved by the spread (last wins) with no
// TypeScript duplicate-key error and no runtime effect — RawSource upsert is
// idempotent and the duplicated entries are byte-identical. When the sibling PRs
// merge, this object's re-declared keys simply become harmless duplicates that
// the spread dedupes. A future cleanup PR can fold this back into one object
// once all WSID source-adding PRs have landed.
const PROFESSION_EXTERNAL_SOURCES_GATED: Record<string, ExternalSourceEntry> = {
  // ── Marketing family ──
  "ama/definition": {
    sourceType: "reference",
    title: "The Definition of Marketing (American Marketing Association)",
    url: "https://www.ama.org/the-definition-of-marketing-what-is-marketing/",
    license: "AMA-copyright-cite-by-reference",
    abstract:
      "AMA's official definition of marketing as creating, communicating, " +
      "delivering, and exchanging offerings of value for customers and society.",
    retrievedAt: "2026-06-13",
  },
  "ama/ethics": {
    sourceType: "reference",
    title: "AMA Statement of Ethics",
    url: "https://www.ama.org/ama-statement-of-ethics/",
    license: "AMA-copyright-cite-by-reference",
    abstract:
      "Three ethical norms (do no harm, foster trust/integrity, embrace ethical " +
      "values) and core values for marketers.",
    retrievedAt: "2026-06-13",
  },
  "cookieyes/can-spam": {
    sourceType: "web-article",
    title: "CAN-SPAM Act: Compliance Guide for Businesses (secondary)",
    url: "https://www.cookieyes.com/blog/can-spam-act/",
    license: "vendor-copyright-cite-by-reference",
    abstract:
      "Secondary distillation of CAN-SPAM's main requirements and the US opt-out " +
      "model. FTC primary source blocked the fetcher.",
    retrievedAt: "2026-06-13",
  },
  "wikipedia/marketing-mix": {
    sourceType: "reference",
    title: "Marketing mix (4 Ps)",
    url: "https://en.wikipedia.org/wiki/Marketing_mix",
    license: "CC-BY-SA-4.0",
    abstract:
      "The 4 Ps marketing-mix framework (product, price, place, promotion), " +
      "coined by E. Jerome McCarthy (1960).",
    retrievedAt: "2026-06-13",
  },
  // ── DevOps / platform family ──
  "dora/four-keys": {
    sourceType: "reference",
    title: "DORA Software Delivery Performance Metrics (Four Keys)",
    url: "https://dora.dev/guides/dora-metrics-four-keys/",
    license: "CC-BY-4.0",
    abstract:
      "The DORA keys: deployment frequency, change lead time, change failure " +
      "rate, and failed-deployment recovery time.",
    retrievedAt: "2026-06-13",
  },
  "dora/overview": {
    sourceType: "reference",
    title: "DORA — Get better at getting better",
    url: "https://dora.dev/",
    license: "CC-BY-4.0",
    abstract:
      "DORA research program on the capabilities that drive software delivery " +
      "and operations performance; speed and stability rise together.",
    retrievedAt: "2026-06-13",
  },
  "opengitops/principles": {
    sourceType: "spec",
    title: "OpenGitOps Principles v1.0.0",
    url: "https://opengitops.dev/",
    license: "CNCF-open",
    abstract:
      "Four GitOps principles: declarative, versioned and immutable, pulled " +
      "automatically, continuously reconciled.",
    retrievedAt: "2026-06-13",
  },
  "iac/ms-learn": {
    sourceType: "reference",
    title: "What is Infrastructure as Code (IaC)? (Microsoft Learn)",
    url: "https://learn.microsoft.com/en-us/devops/deliver/what-is-infrastructure-as-code",
    license: "CC-BY-4.0",
    abstract:
      "IaC defines and deploys infrastructure via versioned declarative models; " +
      "idempotence eliminates configuration drift.",
    retrievedAt: "2026-06-13",
  },
  // ── Release & service-management family ──
  "ntia/sbom-minimum-elements": {
    sourceType: "standard",
    title: "NTIA Minimum Elements for an SBOM (SPDX HOWTO restatement)",
    url: "https://spdx.github.io/spdx-ntia-sbom-howto/",
    license: "CC-BY-4.0",
    abstract:
      "The seven NTIA minimum SBOM fields (supplier, component, version, unique " +
      "ids, dependency, author, timestamp) plus depth and known-unknowns.",
    retrievedAt: "2026-06-13",
  },
  "itsm-wiki/release-deployment": {
    sourceType: "web-article",
    title: "Release and Deployment Management (IT Process Wiki)",
    url: "https://wiki.en.it-processmaps.com/index.php/Release_and_Deployment_Management",
    license: "CC-BY-NC-SA-3.0-DE-cite-by-reference",
    abstract:
      "Open ITIL explainer: release management restores/delivers services; ITIL " +
      "itself is a PeopleCert trademark, not reproduced.",
    retrievedAt: "2026-06-13",
  },
  "itsm-wiki/service-portfolio": {
    sourceType: "web-article",
    title: "Service Portfolio Management (IT Process Wiki)",
    url: "https://wiki.en.it-processmaps.com/index.php/Service_Portfolio_Management",
    license: "CC-BY-NC-SA-3.0-DE-cite-by-reference",
    abstract:
      "The service catalogue is the active customer-facing slice of the service " +
      "portfolio (pipeline / catalogue / retired).",
    retrievedAt: "2026-06-13",
  },
  // ── Scrum-master family ──
  "safe/principles": {
    sourceType: "framework",
    title: "SAFe Lean-Agile Principles",
    url: "https://framework.scaledagile.com/safe-lean-agile-principles/",
    license: "Scaled-Agile-copyright-cite-by-reference",
    abstract:
      "Ten SAFe Lean-Agile principles (economic view, flow, cadence, " +
      "decentralized decisions). Paraphrased with attribution.",
    retrievedAt: "2026-06-13",
  },
  "kanban/guide-for-scrum-2021": {
    sourceType: "framework",
    title: "The Kanban Guide for Scrum Teams (2021)",
    url: "https://www.scrum.org/resources/kanban-guide-scrum-teams",
    license: "CC-BY-SA-4.0",
    abstract:
      "Flow, WIP limiting, the four flow metrics (WIP, cycle time, work-item " +
      "age, throughput), and throughput-based forecasting.",
    retrievedAt: "2026-06-13",
  },
  // ── Portfolio-management family ──
  "epicflow/ppm-guide": {
    sourceType: "web-article",
    title: "A Guide to Project Portfolio Management (Epicflow)",
    url: "https://www.epicflow.com/blog/a-guide-to-project-portfolio-management-doing-the-right-projects-at-the-right-time/",
    license: "vendor-copyright-cite-by-reference",
    abstract:
      "PPM selects, prioritizes, and administers the project portfolio for " +
      "strategic alignment, balancing, and rationalization.",
    retrievedAt: "2026-06-13",
  },
  "safe/lpm": {
    sourceType: "framework",
    title: "Lean Portfolio Management (SAFe)",
    url: "https://framework.scaledagile.com/lean-portfolio-management/",
    license: "Scaled-Agile-copyright-cite-by-reference",
    abstract:
      "LPM aligns strategy and execution via Lean approaches to strategy/" +
      "investment funding, portfolio operations, and governance. Public intro only.",
    retrievedAt: "2026-06-13",
  },
  // ── Re-declared keys (also added in still-open sibling PRs; spread dedupes) ──
  "gdpr/art-7": {
    sourceType: "standard",
    title: "GDPR Article 7 — Conditions for consent",
    url: "https://gdpr-info.eu/art-7-gdpr/",
    license: "OJ-EU-open-reproduction",
    abstract:
      "Consent must be demonstrable, in clear and plain language, and as easy " +
      "to withdraw as to give.",
    retrievedAt: "2026-06-13",
  },
  "cyclonedx/spec": {
    sourceType: "spec",
    title: "CycloneDX Specification Overview (ECMA-424)",
    url: "https://cyclonedx.org/specification/overview/",
    license: "ECMA-424-open",
    abstract:
      "Modular bill-of-materials standard (SBOM/SaaSBOM/HBOM) for supply-chain " +
      "transparency; standardized as ECMA-424.",
    retrievedAt: "2026-06-13",
  },
  "spdx/spec": {
    sourceType: "spec",
    title: "SPDX Specification v3.0.1",
    url: "https://spdx.github.io/spdx-spec/v3.0.1/",
    license: "CC-BY-3.0",
    abstract:
      "Machine-readable SBOM and license/copyright metadata model, including " +
      "license expressions and relationships.",
    retrievedAt: "2026-06-13",
  },
  "opentelemetry/observability-primer": {
    sourceType: "spec",
    title: "OpenTelemetry Observability Primer",
    url: "https://opentelemetry.io/docs/concepts/observability-primer/",
    license: "CC-BY-4.0",
    abstract:
      "Defines observability and the three signals (traces, metrics, logs); " +
      "vendor-neutral CNCF framework.",
    retrievedAt: "2026-06-13",
  },
  "scrum/guide-2020": {
    sourceType: "framework",
    title: "The 2020 Scrum Guide",
    url: "https://scrumguides.org/scrum-guide.html",
    license: "CC-BY-SA-4.0",
    abstract:
      "Defines the five Scrum events, Scrum Master accountability, and the three " +
      "empiricism pillars (transparency, inspection, adaptation).",
    retrievedAt: "2026-06-13",
  },
  "safe/wsjf": {
    sourceType: "framework",
    title: "WSJF — Weighted Shortest Job First (SAFe)",
    url: "https://framework.scaledagile.com/wsjf/",
    license: "Scaled-Agile-copyright-cite-by-reference",
    abstract:
      "WSJF = relative cost of delay divided by relative job duration; sequence " +
      "shortest high-cost-of-delay jobs first. Paraphrased.",
    retrievedAt: "2026-06-13",
  },
  // ── First-party DPF profession sources for platform-specific families ──
  "dpf/agents-rulebook": {
    sourceType: "repository-doc",
    title: "DPF Agent Rulebook",
    url: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/AGENTS.md",
    license: "Apache-2.0",
    abstract:
      "Canonical operating contract for agents working in the Digital Product Factory.",
    retrievedAt: "2026-06-16",
  },
  "dpf/build-studio-guide": {
    sourceType: "repository-doc",
    title: "DPF User Guide: Build Studio",
    url: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/tree/main/docs/user-guide/build-studio",
    license: "Apache-2.0",
    abstract:
      "User-facing Build Studio guide covering the five-phase pipeline, sandbox/build runtime, and deployment handoff.",
    retrievedAt: "2026-06-16",
  },
  "dpf/admin-guide": {
    sourceType: "repository-doc",
    title: "DPF User Guide: Platform Administration",
    url: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/tree/main/docs/user-guide/platform",
    license: "Apache-2.0",
    abstract:
      "User-facing platform administration guide covering AI operations, authority, identity, and tool surfaces.",
    retrievedAt: "2026-06-16",
  },
  "dpf/roles-access-guide": {
    sourceType: "repository-doc",
    title: "DPF User Guide: Roles and Access",
    url: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/docs/user-guide/getting-started/roles-and-access.md",
    license: "Apache-2.0",
    abstract:
      "Guide to platform governance roles, capabilities, and the Admin > Access management surface.",
    retrievedAt: "2026-06-16",
  },
  "dpf/developer-setup-guide": {
    sourceType: "repository-doc",
    title: "DPF User Guide: Developer Setup",
    url: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/docs/user-guide/getting-started/developer-setup.md",
    license: "Apache-2.0",
    abstract:
      "Developer setup guide covering migrations, seed data, worktree isolation, and local development commands.",
    retrievedAt: "2026-06-16",
  },
  "dpf/install-runbook": {
    sourceType: "repository-doc",
    title: "DPF Operations Install Runbook",
    url: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/docs/operations/install.md",
    license: "Apache-2.0",
    abstract:
      "Operations install runbook covering readiness states, bootstrap, and operational setup.",
    retrievedAt: "2026-06-16",
  },
};

/**
 * The effective source registry: the base object spread-merged with the
 * merge-gated families' object. Duplicate keys (a source declared in both
 * because its canonical home is a still-open sibling PR) resolve last-wins;
 * the entries are byte-identical, so there is no behavioral difference.
 */
const ALL_PROFESSION_EXTERNAL_SOURCES: Record<string, ExternalSourceEntry> = {
  ...PROFESSION_EXTERNAL_SOURCES,
  ...PROFESSION_EXTERNAL_SOURCES_GATED,
};

// ─── Source seeding ──────────────────────────────────────────────────────────

async function seedProfessionExternalSources(
  prisma: PrismaClient,
): Promise<{ count: number; sourceKeyToId: Map<string, string> }> {
  const sourceKeyToId = new Map<string, string>();
  let count = 0;

  for (const [sourceKey, meta] of Object.entries(ALL_PROFESSION_EXTERNAL_SOURCES)) {
    const upserted = (await prisma.rawSource.upsert({
      where: { sourceKey },
      create: {
        sourceKey,
        sourceType: meta.sourceType,
        title: meta.title,
        url: meta.url,
        license: meta.license,
        abstract: meta.abstract ?? null,
        retrievedAt: new Date(meta.retrievedAt),
        isKernel: false,
      },
      update: {
        sourceType: meta.sourceType,
        title: meta.title,
        url: meta.url,
        license: meta.license,
        abstract: meta.abstract ?? null,
        retrievedAt: new Date(meta.retrievedAt),
      },
    })) as { id: string };

    sourceKeyToId.set(sourceKey, upserted.id);
    count++;
  }

  return { count, sourceKeyToId };
}

// ─── Filesystem helpers ──────────────────────────────────────────────────────

function walkMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkMarkdownFiles(full));
    } else if (st.isFile() && entry.endsWith(".md") && !entry.startsWith("README")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Derive a wiki slug for a profession corpus page.
 *   docs/professions/data-architect/wiki/parameterized-queries-commandment.md
 *   -> professions/data-architect/parameterized-queries-commandment
 *
 * Strips the `wiki/` path segment and prefixes with `professions/` so
 * profession corpus pages are distinguishable from kernel pages by
 * their slug prefix, which the `detectUnsourcedProfessionPages` lint
 * detector uses as its identification mechanism.
 */
function deriveCorpusSlug(absolutePath: string): string {
  const rel = deriveSlug(absolutePath, PROFESSIONS_DIR);
  // rel = "data-architect/wiki/parameterized-queries-commandment"
  // Strip the wiki/ path segment: "data-architect/parameterized-queries-commandment"
  const stripped = rel.replace(/^([^/]+)\/wiki\//, "$1/");
  return `professions/${stripped}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export type SeedProfessionCorpusResult = {
  sourceCount: number;
  pageCount: number;
  orphanLinks: Array<{ from: string; to: string }>;
  emptyCorpus: boolean;
  /** Page counts by declared jurisdiction (omitted pages count as "global"). */
  jurisdictionCoverage: Record<string, number>;
  /** Page counts by declared competency level (omitted pages count as "practitioner"). */
  competencyCoverage: Record<string, number>;
  /** Page counts by declared archetype (omitted pages count as "universal"). */
  archetypeCoverage: Record<string, number>;
};

/**
 * Validate the WSID variant frontmatter axes for a corpus page and fold the
 * page into the running coverage counters. Fail-fast on unknown values (loud,
 * per the silent-seed-skips audit) so a typo can never silently mis-tag
 * jurisdiction-sensitive doctrine. Omitted axes default to global /
 * practitioner per the variant addendum.
 */
function tallyVariantCoverage(
  slug: string,
  frontmatter: WikiPageFrontmatter,
  jurisdictionCoverage: Record<string, number>,
  competencyCoverage: Record<string, number>,
  archetypeCoverage: Record<string, number>,
): { jurisdictions: string[]; competencyLevel: string; archetypes: string[]; basis: string } {
  const jurisdictions =
    frontmatter.professionJurisdiction && frontmatter.professionJurisdiction.length > 0
      ? frontmatter.professionJurisdiction
      : ["global"];
  for (const jur of jurisdictions) {
    if (!isProfessionJurisdiction(jur)) {
      throw new Error(
        "[seedProfessionCorpus] page " +
          slug +
          ' declares unknown professionJurisdiction "' +
          jur +
          '". Allowed: ' +
          PROFESSION_JURISDICTIONS.join(", ") +
          ". Add it to PROFESSION_JURISDICTIONS in wiki-taxonomy.ts via a follow-up PR before using it.",
      );
    }
    jurisdictionCoverage[jur] = (jurisdictionCoverage[jur] ?? 0) + 1;
  }

  const level = frontmatter.professionCompetencyLevel ?? "practitioner";
  if (!isProfessionCompetencyLevel(level)) {
    throw new Error(
      "[seedProfessionCorpus] page " +
        slug +
        ' declares unknown professionCompetencyLevel "' +
        level +
        '". Allowed: ' +
        PROFESSION_COMPETENCY_LEVELS.join(", ") +
        ".",
    );
  }
  competencyCoverage[level] = (competencyCoverage[level] ?? 0) + 1;

  const archetypes =
    frontmatter.professionArchetype && frontmatter.professionArchetype.length > 0
      ? frontmatter.professionArchetype
      : ["universal"];
  for (const arch of archetypes) {
    if (!isProfessionArchetype(arch)) {
      throw new Error(
        "[seedProfessionCorpus] page " +
          slug +
          ' declares unknown professionArchetype "' +
          arch +
          '". Allowed: ' +
          PROFESSION_ARCHETYPES.join(", ") +
          ". Add it to PROFESSION_ARCHETYPES in wiki-taxonomy.ts (kept in sync with ArchetypeCategory) before using it.",
      );
    }
    archetypeCoverage[arch] = (archetypeCoverage[arch] ?? 0) + 1;
  }

  // Jurisdiction basis — which dimension of the install's regional profile
  // triggers this page. Default: "global" for region-neutral pages, "operating"
  // for jurisdiction-specific pages that don't declare a basis.
  const jurisdictionSpecific = !(jurisdictions.length === 1 && jurisdictions[0] === "global");
  const basis =
    frontmatter.professionJurisdictionBasis ?? (jurisdictionSpecific ? "operating" : "global");
  if (!isProfessionJurisdictionBasis(basis)) {
    throw new Error(
      "[seedProfessionCorpus] page " +
        slug +
        ' declares unknown professionJurisdictionBasis "' +
        basis +
        '". Allowed: ' +
        PROFESSION_JURISDICTION_BASES.join(", ") +
        ".",
    );
  }

  // Return the normalized axes so the caller can persist them into
  // WikiPage.metadata for runtime coverage queries (HRIS management surface,
  // and the future gate↔material variant binding). The seed is the single
  // place that has already validated these against the closed registries.
  return { jurisdictions, competencyLevel: level, archetypes, basis };
}

/**
 * Seed profession corpus wiki pages from the docs/professions directory.
 *
 * Idempotent - re-running advances the revision chain only when body
 * content has changed; never duplicates RawSource rows, WikiPage rows,
 * link edges, or source citations.
 *
 * If docs/professions/ is absent or contains no wiki pages under any
 * profession-family subdirectory, returns { emptyCorpus: true } without error.
 */
export async function seedProfessionCorpus(
  prisma: PrismaClient,
): Promise<SeedProfessionCorpusResult> {
  if (!existsSync(PROFESSIONS_DIR)) {
    console.warn(
      `[seedProfessionCorpus] docs/professions/ not found at ${PROFESSIONS_DIR}. ` +
        `No corpus seeded.`,
    );
    return {
      sourceCount: 0,
      pageCount: 0,
      orphanLinks: [],
      emptyCorpus: true,
      jurisdictionCoverage: {},
      competencyCoverage: {},
      archetypeCoverage: {},
    };
  }

  const { count: sourceCount, sourceKeyToId } = await seedProfessionExternalSources(prisma);

  // Collect all wiki/*.md files under docs/professions/*/wiki/
  const wikiFiles: string[] = [];
  for (const entry of readdirSync(PROFESSIONS_DIR)) {
    const familyDir = join(PROFESSIONS_DIR, entry);
    if (!statSync(familyDir).isDirectory()) continue; // skip registry.json etc.
    wikiFiles.push(...walkMarkdownFiles(join(familyDir, "wiki")));
  }

  if (wikiFiles.length === 0) {
    return {
      sourceCount,
      pageCount: 0,
      orphanLinks: [],
      emptyCorpus: true,
      jurisdictionCoverage: {},
      competencyCoverage: {},
      archetypeCoverage: {},
    };
  }

  const slugToId = new Map<string, string>();
  const bodies = new Map<string, string>();
  const jurisdictionCoverage: Record<string, number> = {};
  const competencyCoverage: Record<string, number> = {};
  const archetypeCoverage: Record<string, number> = {};

  // Pass 1: upsert wiki pages and append revisions.
  for (const file of wikiFiles) {
    const raw = readFileSync(file, "utf8");
    const { frontmatter, body } = parseFrontmatter<WikiPageFrontmatter>(raw);
    const slug = deriveCorpusSlug(file);
    const status = frontmatter.status ?? "published";

    const { jurisdictions, competencyLevel, archetypes, basis } = tallyVariantCoverage(
      slug,
      frontmatter,
      jurisdictionCoverage,
      competencyCoverage,
      archetypeCoverage,
    );

    const principlePayload = extractPrinciplePayload(frontmatter);

    // Persist the validated WSID variant axes into WikiPage.metadata so the
    // HRIS coverage helper, the runtime retrieval service, and the gate variant
    // binding can query jurisdiction/competency/archetype/basis at runtime
    // without re-parsing the corpus files.
    const metadata = {
      professionJurisdiction: jurisdictions,
      professionCompetencyLevel: competencyLevel,
      professionArchetype: archetypes,
      professionJurisdictionBasis: basis,
    };

    const upserted = (await upsertWikiPage(prisma, {
      slug,
      title: frontmatter.title,
      body,
      pageKind: frontmatter.pageKind,
      status,
      isKernel: false,
      kernelVersion: null,
      abstract: frontmatter.abstract ?? null,
      metadata,
      ...principlePayload,
    })) as { id: string };

    slugToId.set(slug, upserted.id);
    bodies.set(slug, body);

    const latest = (await prisma.wikiPageRevision.findFirst({
      where: { pageId: upserted.id },
      orderBy: { version: "desc" },
      select: { body: true },
    })) as { body: string } | null;

    if (!latest || latest.body !== body) {
      await appendRevision(prisma, {
        pageId: upserted.id,
        title: frontmatter.title,
        body,
        changeKind: "kernel-merge",
        changeSummary: latest
          ? "Profession corpus content update"
          : "Initial profession corpus seed (WSID Phase 2, BI-871126F9)",
      });
    }

    for (const sourceKey of frontmatter.sources ?? []) {
      const sourceId = sourceKeyToId.get(sourceKey);
      if (!sourceId) {
        console.warn(
          `[seedProfessionCorpus] page ${slug} cites unknown source "${sourceKey}"; ` +
            `add it to PROFESSION_EXTERNAL_SOURCES in seed-profession-corpus.ts`,
        );
        continue;
      }
      await attachSource(prisma, { pageId: upserted.id, sourceId });
    }
  }

  // Pass 2: extract [[wikilinks]] and create edges.
  const orphanLinks: Array<{ from: string; to: string }> = [];
  for (const [fromSlug, body] of bodies.entries()) {
    const fromId = slugToId.get(fromSlug);
    if (!fromId) continue;
    for (const toSlug of extractWikilinks(body)) {
      const toId = slugToId.get(toSlug);
      if (!toId) {
        orphanLinks.push({ from: fromSlug, to: toSlug });
        continue;
      }
      await linkPages(prisma, { fromPageId: fromId, toPageId: toId });
    }
  }

  if (orphanLinks.length > 0) {
    const linkPairs = orphanLinks.map((l) => l.from + " -> " + l.to).join(", ");
    console.warn(
      `[seedProfessionCorpus] ${orphanLinks.length} orphan wiki-link(s) — ` +
        "target page not yet seeded: " + linkPairs,
    );
  }

  return {
    sourceCount,
    pageCount: wikiFiles.length,
    orphanLinks,
    emptyCorpus: false,
    jurisdictionCoverage,
    competencyCoverage,
    archetypeCoverage,
  };
}
