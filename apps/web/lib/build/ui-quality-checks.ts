// UI quality checks — turn the Frontend Engineer design-system PROSE into an
// enforced, testable static check.
//
// BI-66656F61 (EP-F7E35344). specialist-prompts.ts asks the frontend specialist
// to use DPF design tokens (var(--dpf-*)), avoid hardcoded colors, and meet a
// small a11y bar — but nothing VERIFIES the generated code against those rules;
// the review phase captures a single screenshot, not a token/a11y audit. This
// module is a pure, dependency-free static scan of generated UI code (a diff or
// a file body) that flags the exact violations the prompt names, so "design
// system compliance" becomes an advisory review lens instead of a hope.
//
// Heuristic by construction (regex over source, not a full CSS/DOM parser): it
// is an ADVISORY lint, tuned to few false positives on the specific patterns
// the prompt calls out. No DB, no inference — trivially unit-testable.

export type UiFindingSeverity = "critical" | "important" | "minor";

export type UiQualityFinding = {
  severity: UiFindingSeverity;
  /** Stable rule id for filtering/testing. */
  rule: "hardcoded-hex" | "tailwind-color-class" | "inline-rgb" | "div-onclick" | "span-role-button" | "missing-focus-visible";
  description: string;
  /** 1-based line number within the scanned source. */
  line: number;
  /** The offending snippet (trimmed). */
  snippet: string;
};

export type UiQualityReport = {
  findings: UiQualityFinding[];
  /** Counts by severity for a compact lens detail. */
  counts: { critical: number; important: number; minor: number };
  /** True when there are zero token/a11y violations. */
  clean: boolean;
};

// Hardcoded hex color literal (3-, 6-, or 8-digit forms). CSS var fallbacks are
// rare in generated code; we scan raw source lines.
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
// Tailwind color utility with a numeric shade: bg-green-400, text-red-500,
// border-slate-200, ring-blue-600, from-indigo-500. Excludes DPF token classes
// (arbitrary-value utilities that reference the var(--dpf-*) design tokens) and
// semantic non-color utilities.
const TW_COLOR_RE = /\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline|decoration|shadow|caret|accent|placeholder)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|grey|zinc|neutral|stone)-\d{2,3}\b/;
// Inline rgb/rgba/hsl literal.
const RGB_RE = /\b(?:rgba?|hsla?)\s*\(/;
// A div/span with an onClick (should be a real <button>).
const DIV_ONCLICK_RE = /<div\b[^>]*\bonClick=/;
const SPAN_ROLE_BUTTON_RE = /<span\b[^>]*\brole=["']button["']/;

/** True when a line is a comment or references a DPF token — suppress hex/color
 *  findings there (a token line is the CORRECT form; a comment is not shipped). */
function isSuppressedContext(line: string): boolean {
  const t = line.trim();
  if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return true;
  // A line already using a DPF token for its color is compliant even if it also
  // mentions a hex in a comment-like trailing note; keep it simple: if the line
  // contains var(--dpf- it is using the token system.
  return false;
}

/**
 * Scan a block of generated UI source for design-token and a11y violations.
 * `isPlatformUi` distinguishes DPF platform UI (must use var(--dpf-*) tokens —
 * hardcoded color is critical) from product-sandbox UI (a generated design
 * system with its own palette is legitimate — hardcoded color is only a minor
 * note). Pure + deterministic.
 */
export function scanUiSource(source: string, opts?: { isPlatformUi?: boolean }): UiQualityReport {
  const isPlatformUi = opts?.isPlatformUi ?? true;
  const colorSeverity: UiFindingSeverity = isPlatformUi ? "critical" : "minor";
  const findings: UiQualityFinding[] = [];
  const lines = source.split("\n");

  lines.forEach((raw, i) => {
    const line = raw;
    const lineNo = i + 1;
    const usesToken = line.includes("var(--dpf-");

    if (!isSuppressedContext(line)) {
      if (!usesToken && HEX_RE.test(line)) {
        findings.push({ severity: colorSeverity, rule: "hardcoded-hex", description: "Hardcoded hex color — use a var(--dpf-*) token.", line: lineNo, snippet: line.trim().slice(0, 120) });
      }
      if (TW_COLOR_RE.test(line)) {
        findings.push({ severity: colorSeverity, rule: "tailwind-color-class", description: "Tailwind color-shade class — use an arbitrary-value utility backed by a concrete DPF design token.", line: lineNo, snippet: line.trim().slice(0, 120) });
      }
      if (!usesToken && RGB_RE.test(line)) {
        findings.push({ severity: colorSeverity, rule: "inline-rgb", description: "Inline rgb/hsl color literal — use a var(--dpf-*) token.", line: lineNo, snippet: line.trim().slice(0, 120) });
      }
    }

    if (DIV_ONCLICK_RE.test(line)) {
      findings.push({ severity: "important", rule: "div-onclick", description: "Click handler on a <div> — use a real <button> for keyboard + a11y.", line: lineNo, snippet: line.trim().slice(0, 120) });
    }
    if (SPAN_ROLE_BUTTON_RE.test(line)) {
      findings.push({ severity: "important", rule: "span-role-button", description: '<span role="button"> — use a real <button> element.', line: lineNo, snippet: line.trim().slice(0, 120) });
    }
  });

  // Focus-visible: if the source declares interactive elements but never
  // references focus-visible, flag once (a11y keyboard affordance the prompt
  // requires). File-level, not per-line.
  if (/<button\b|onClick=/.test(source) && !/focus-visible/.test(source)) {
    findings.push({ severity: "minor", rule: "missing-focus-visible", description: "Interactive elements but no focus-visible styles — add focus-visible:outline for keyboard users.", line: 1, snippet: "(file-level)" });
  }

  const counts = { critical: 0, important: 0, minor: 0 };
  for (const f of findings) counts[f.severity]++;
  return { findings, counts, clean: findings.length === 0 };
}

/** Render a UI-quality report as a compact markdown block for the review trail. */
export function formatUiQualityReport(report: UiQualityReport): string {
  if (report.clean) return "### UI quality check\n\nNo design-token or a11y violations found.";
  const lines = [`### UI quality check — ${report.counts.critical} critical · ${report.counts.important} important · ${report.counts.minor} minor`, ""];
  for (const f of report.findings) lines.push(`- [${f.severity}] ${f.description} (line ${f.line}) — \`${f.snippet}\``);
  return lines.join("\n");
}
