/**
 * Structural test for the build-specialist persona prompt. Asserts the
 * Operator Contract clauses are present and the rotted future-state language
 * has been removed. Source: docs/superpowers/specs/2026-04-30-build-specialist-operator-contract.md §2
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..", "..", "..", "..");
const PROMPT_PATH = join(REPO_ROOT, "prompts", "route-persona", "build-specialist.prompt.md");
const prompt = readFileSync(PROMPT_PATH, "utf-8");

describe("build-specialist.prompt.md (Operator Contract)", () => {
  it("has frontmatter version 4 (operator contract update)", () => {
    expect(prompt).toMatch(/^version:\s*4$/m);
  });

  it("preserves the role-defining sections", () => {
    expect(prompt).toMatch(/^# Role$/m);
    expect(prompt).toMatch(/^# Accountable For$/m);
    expect(prompt).toMatch(/^# Interfaces With$/m);
    expect(prompt).toMatch(/^# Out Of Scope$/m);
  });

  it("removes the stale tool-grant rot language that caused tool refusal", () => {
    expect(prompt).not.toMatch(/currently `\[\]`/);
    expect(prompt).not.toMatch(/pending follow-on assignment/);
    expect(prompt).not.toMatch(/once the per-agent grant/);
    expect(prompt).not.toMatch(/will hold a curated set/);
    expect(prompt).not.toMatch(/tools the role expects to hold once granted/i);
  });

  it("contains the # Operator Contract section", () => {
    expect(prompt).toMatch(/^# Operator Contract$/m);
  });

  it("trusts the runtime tool list explicitly", () => {
    expect(prompt).toMatch(/platform delivers your callable tool list/i);
  });

  it("references all nine contract clauses by intent", () => {
    // 2.2 — phase advance illegal without saved evidence
    expect(prompt).toMatch(/saveBuildEvidence/);
    expect(prompt).toMatch(/phase advance is illegal/i);
    // 2.3 — short confirmations advance
    expect(prompt).toMatch(/\bok\b.*\byes\b.*\bproceed\b/i);
    // 2.4 — save before final response
    expect(prompt).toMatch(/save before final response/i);
    // 2.5 — narrow approval gate (PR open / merge / promote / production)
    expect(prompt).toMatch(/opening a PR/i);
    expect(prompt).toMatch(/merging a PR/i);
    // 2.6 — tool failure honesty
    expect(prompt).toMatch(/never claim a tool is unavailable/i);
    expect(prompt).toMatch(/report_quality_issue/);
    // 2.7 — no-repeat-diagnosis
    expect(prompt).toMatch(/no-repeat-diagnosis/i);
    // 2.8 — clear next step
    expect(prompt).toMatch(/clear next step/i);
    // 2.9 — one clarification round
    expect(prompt).toMatch(/one clarification round/i);
  });
});
