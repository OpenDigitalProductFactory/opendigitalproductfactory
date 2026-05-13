// Phase 1 Task 1.7 of the principles-as-wiki-kind plan: public-safety
// lint detector. Blocks publish when a principle marked principlePublic
// contains markers that would leak internal/local content to the public
// docs site.
//
// Scope: internal-leakage signals only. Founder biographical references
// ("DPF was founded by Mark Bodman") and product references to coding-agent
// tools (Claude, Codex) are product-facing per spec section 13.4 and must
// NOT be blocked. The pattern list below is intentionally narrow.
//
// Spec: docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md §14
// Plan: docs/superpowers/plans/2026-05-12-principles-as-wiki-kind.md (Phase 1 Task 1.7)

import type { LintFinding } from "./lint-detectors";
import type { LintPrincipleWikiPage } from "./principle-lint-detectors";

type Pattern = {
  name: string;
  regex: RegExp;
  description: string;
};

const UNSAFE_PATTERNS: Pattern[] = [
  // ─── Local user paths ───────────────────────────────────────────────────
  {
    name: "windows-user-path",
    regex: /\bC:\\Users\\[A-Za-z0-9 _.-]+/g,
    description: "Windows user-profile path",
  },
  {
    name: "posix-home-path",
    regex: /\/home\/[A-Za-z0-9_-]+\//g,
    description: "POSIX /home path",
  },
  {
    name: "macos-user-path",
    regex: /\/Users\/[A-Za-z0-9 _.-]+\//g,
    description: "macOS /Users path",
  },

  // ─── Memory file references ─────────────────────────────────────────────
  {
    name: "memory-feedback-file",
    regex: /\bfeedback_[A-Za-z0-9_]+\.md\b/g,
    description: "feedback_*.md memory filename reference",
  },
  {
    name: "memory-project-file",
    regex: /\bproject_[A-Za-z0-9_]+\.md\b/g,
    description: "project_*.md memory filename reference",
  },
  {
    name: "memory-index-file",
    regex: /\bMEMORY\.md\b/g,
    description: "MEMORY.md filename reference",
  },

  // ─── Secret-shaped tokens ───────────────────────────────────────────────
  {
    name: "anthropic-token",
    regex: /\bsk-[A-Za-z0-9_-]{16,}\b/g,
    description: "Anthropic-style sk- token",
  },
  {
    name: "github-token",
    regex: /\bghp_[A-Za-z0-9_-]{20,}\b/g,
    description: "GitHub personal access token",
  },
  {
    name: "dpf-pat",
    regex: /\bdpf_pat_[A-Za-z0-9_-]{16,}\b/g,
    description: "DPF personal access token",
  },

  // ─── Internal-only instruction phrases ──────────────────────────────────
  // Literal string matches; narrative product references to "Claude",
  // "Codex", or "Mark" are deliberately NOT in this list.
  {
    name: "drive-100-percent-phrase",
    regex: /Drive 100% means don'?t ask/gi,
    description: "Internal autonomy-directive phrasing",
  },
  {
    name: "internal-only-marker",
    regex: /<\/?internal-only>/gi,
    description: "<internal-only> XML-style marker",
  },
];

/**
 * Detector emits ONE finding per principle page that has any unsafe
 * marker, listing every distinct marker name in the detail. Per-page
 * aggregation keeps the orchestrator from flooding the lint UI with
 * findings on a single noisy page; the detail still tells the author
 * everything they need to fix.
 *
 * Severity: error. Blocks publish.
 *
 * Internal principles (principlePublic === false) are exempt — the
 * marker list only matters for content that would render on the public
 * docs site.
 */
export function detectPrinciplePublicUnsafeMarker(input: {
  pages: LintPrincipleWikiPage[];
}): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const page of input.pages) {
    if (page.pageKind !== "principle") continue;
    if (!page.principlePublic) continue;

    const matched: Array<{ name: string; description: string; example: string }> =
      [];
    for (const pattern of UNSAFE_PATTERNS) {
      const found = page.body.match(pattern.regex);
      if (found && found.length > 0) {
        matched.push({
          name: pattern.name,
          description: pattern.description,
          // First match only — surface as an example without dumping
          // potentially-sensitive content in full.
          example: found[0],
        });
      }
    }

    if (matched.length === 0) continue;

    findings.push({
      organizationId: page.organizationId,
      pageId: page.id,
      findingKind: "principle-public-unsafe-marker",
      severity: "error",
      detail: {
        slug: page.slug,
        blocksPublish: true,
        markers: matched.map((m) => m.name),
        details: matched,
        message:
          "Public principle contains internal-leakage markers. Either " +
          "rewrite the body to remove the markers OR set " +
          "principlePublic: false. Founder biographical references and " +
          "narrative product references to Claude/Codex/Mark are NOT " +
          "blocked by this lint; only local paths, memory filenames, " +
          "secret-shaped tokens, and internal instruction phrases.",
      },
    });
  }
  return findings;
}
