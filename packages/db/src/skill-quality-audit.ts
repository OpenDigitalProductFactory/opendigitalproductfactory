import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { pathToFileURL } from "url";
import { parseFrontmatter } from "./seed-skills";

export type SkillAuditFinding = {
  code: string;
  severity: "error" | "warning";
  message: string;
};

export type SkillAuditResult = {
  path: string;
  skillId: string;
  description: string;
  score: number;
  findings: SkillAuditFinding[];
};

export type SkillAuditSummary = {
  totalSkills: number;
  passingSkills: number;
  failingSkills: number;
  averageScore: number;
  results: SkillAuditResult[];
};

type AuditInput = {
  path: string;
  content: string;
};

const FAILING_SCORE = 80;

function countTriggerPhrases(triggerPattern: string | null | undefined): number {
  if (!triggerPattern) return 0;
  return triggerPattern
    .split(/[|,;]/)
    .map((phrase) => phrase.trim())
    .filter(Boolean).length;
}

function hasRoutingBoundary(text: string): boolean {
  return /do\s+not\s+use[\s\S]{0,220}use[\s\S]{0,120}instead/i.test(text);
}

function hasReadFirstTable(text: string): boolean {
  return /source\s*\|\s*path\s*\|\s*what\s+to\s+extract/i.test(text);
}

function hasOutputTemplate(text: string): boolean {
  return /(^|\n)#{2,}\s*output\s+template\b/i.test(text) || /\boutput\s+template\b/i.test(text);
}

function hasWorkedExample(text: string): boolean {
  return /(^|\n)#{2,}\s*example\b/i.test(text) || /\binput:\s*[\s\S]{0,300}\boutput:/i.test(text);
}

function hasImperativeStep(text: string): boolean {
  return /\n\s*\d+\.\s+(Read|Check|Use|Generate|Create|Return|Ask|Verify|Run|Write|Report)\b/.test(text);
}

function addFinding(
  findings: SkillAuditFinding[],
  code: string,
  severity: "error" | "warning",
  message: string,
): void {
  findings.push({ code, severity, message });
}

export function auditSkillMarkdown(input: AuditInput): SkillAuditResult {
  const { frontmatter, body } = parseFrontmatter(input.content);
  const description = frontmatter.description ?? "";
  const triggerPhraseCount = countTriggerPhrases(frontmatter.triggerPattern);
  const fullText = `${description}\n${body}`;
  const lineCount = body.split("\n").length;
  const findings: SkillAuditFinding[] = [];

  if (description.length < 100) {
    addFinding(
      findings,
      "description-too-short",
      "error",
      "Description should be at least 100 characters so routing has enough signal.",
    );
  }

  if (triggerPhraseCount < 3) {
    addFinding(
      findings,
      "trigger-pattern-too-narrow",
      "warning",
      "Trigger pattern should include at least three realistic phrases a user would type.",
    );
  }

  if (!hasRoutingBoundary(fullText)) {
    addFinding(
      findings,
      "missing-routing-boundary",
      "warning",
      "Add a 'do not use for X, use Y instead' boundary so similar skills route correctly.",
    );
  }

  if (!hasReadFirstTable(body)) {
    addFinding(
      findings,
      "missing-read-first-table",
      "error",
      "Add a read-first table with Source, Path, and What to extract columns.",
    );
  }

  if (!hasOutputTemplate(body)) {
    addFinding(
      findings,
      "missing-output-template",
      "error",
      "Add an output template so repeated invocations do not invent a new structure.",
    );
  }

  if (!hasWorkedExample(body)) {
    addFinding(
      findings,
      "missing-worked-example",
      "warning",
      "Add at least one worked example showing a good input and output.",
    );
  }

  if (!hasImperativeStep(body)) {
    addFinding(
      findings,
      "missing-imperative-steps",
      "warning",
      "Use imperative steps such as Read, Check, Generate, Return, or Verify.",
    );
  }

  if (lineCount > 500) {
    addFinding(
      findings,
      "skill-too-long",
      "warning",
      "Keep critical skill instructions under 500 lines; move background into references.",
    );
  }

  const penalty = findings.reduce(
    (total, finding) => total + (finding.severity === "error" ? 15 : 8),
    0,
  );

  return {
    path: input.path,
    skillId: frontmatter.name,
    description,
    score: Math.max(0, 100 - penalty),
    findings,
  };
}

export function summarizeSkillAudit(results: SkillAuditResult[]): SkillAuditSummary {
  const sorted = [...results].sort((a, b) => a.score - b.score || a.path.localeCompare(b.path));
  const failingSkills = sorted.filter((result) => result.score < FAILING_SCORE).length;
  const averageScore = sorted.length === 0
    ? 0
    : Math.round(sorted.reduce((total, result) => total + result.score, 0) / sorted.length);

  return {
    totalSkills: sorted.length,
    passingSkills: sorted.length - failingSkills,
    failingSkills,
    averageScore,
    results: sorted,
  };
}

export function discoverSkillFiles(skillsDir: string): string[] {
  const entries = readdirSync(skillsDir).map((name) => join(skillsDir, name));
  const files: string[] = [];

  for (const entry of entries) {
    const stat = statSync(entry);
    if (stat.isDirectory()) {
      files.push(...discoverSkillFiles(entry));
    } else if (entry.endsWith(".skill.md")) {
      files.push(entry);
    }
  }

  return files;
}

export function auditSkillsDirectory(rootDir: string): SkillAuditSummary {
  const skillsDir = join(rootDir, "skills");
  const results = discoverSkillFiles(skillsDir).map((filePath) => auditSkillMarkdown({
    path: relative(rootDir, filePath).replace(/\\/g, "/"),
    content: readFileSync(filePath, "utf-8"),
  }));

  return summarizeSkillAudit(results);
}

export function formatSkillAuditSummary(summary: SkillAuditSummary): string {
  const lines = [
    `Skill quality audit: ${summary.passingSkills}/${summary.totalSkills} passing, average score ${summary.averageScore}.`,
    "",
    "Lowest-scoring skills:",
  ];

  for (const result of summary.results.slice(0, 10)) {
    lines.push(`- ${result.score} ${result.path}`);
    for (const finding of result.findings.slice(0, 4)) {
      lines.push(`  - ${finding.code}: ${finding.message}`);
    }
  }

  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rootDir = process.argv[2] ?? join(__dirname, "..", "..", "..");
  const summary = auditSkillsDirectory(rootDir);
  console.log(formatSkillAuditSummary(summary));
  process.exit(summary.failingSkills > 0 ? 1 : 0);
}
