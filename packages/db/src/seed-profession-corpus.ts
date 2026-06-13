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
  PROFESSION_COMPETENCY_LEVELS,
  PROFESSION_JURISDICTIONS,
  isProfessionCompetencyLevel,
  isProfessionJurisdiction,
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
};

// ─── Source seeding ──────────────────────────────────────────────────────────

async function seedProfessionExternalSources(
  prisma: PrismaClient,
): Promise<{ count: number; sourceKeyToId: Map<string, string> }> {
  const sourceKeyToId = new Map<string, string>();
  let count = 0;

  for (const [sourceKey, meta] of Object.entries(PROFESSION_EXTERNAL_SOURCES)) {
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
): void {
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
    };
  }

  const slugToId = new Map<string, string>();
  const bodies = new Map<string, string>();
  const jurisdictionCoverage: Record<string, number> = {};
  const competencyCoverage: Record<string, number> = {};

  // Pass 1: upsert wiki pages and append revisions.
  for (const file of wikiFiles) {
    const raw = readFileSync(file, "utf8");
    const { frontmatter, body } = parseFrontmatter<WikiPageFrontmatter>(raw);
    const slug = deriveCorpusSlug(file);
    const status = frontmatter.status ?? "published";

    tallyVariantCoverage(slug, frontmatter, jurisdictionCoverage, competencyCoverage);

    const principlePayload = extractPrinciplePayload(frontmatter);

    const upserted = (await upsertWikiPage(prisma, {
      slug,
      title: frontmatter.title,
      body,
      pageKind: frontmatter.pageKind,
      status,
      isKernel: false,
      kernelVersion: null,
      abstract: frontmatter.abstract ?? null,
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
  };
}
