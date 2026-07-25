import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { scanUiSource, formatUiQualityReport } from "./ui-quality-checks";

describe("scanUiSource — design tokens", () => {
  it("does not expose a wildcard arbitrary-value utility to Tailwind's content scanner", () => {
    const source = readFileSync(new URL("./ui-quality-checks.ts", import.meta.url), "utf8");
    const wildcardUtility = ["bg-[", "var(--dpf-*", ")]"].join("");

    expect(source).not.toContain(wildcardUtility);
  });

  it("flags a hardcoded hex on platform UI as critical", () => {
    const r = scanUiSource(`<div style={{ color: "#4ade80" }}>hi</div>`);
    expect(r.findings.some((f) => f.rule === "hardcoded-hex" && f.severity === "critical")).toBe(true);
    expect(r.clean).toBe(false);
  });

  it("downgrades hardcoded color to minor for product-sandbox UI", () => {
    const r = scanUiSource(`<div style={{ color: "#4ade80" }} />`, { isPlatformUi: false });
    expect(r.findings.find((f) => f.rule === "hardcoded-hex")?.severity).toBe("minor");
  });

  it("does NOT flag a var(--dpf-*) token line", () => {
    const r = scanUiSource(`<div className="text-[var(--dpf-accent)]">ok</div>`);
    expect(r.findings.some((f) => f.rule === "hardcoded-hex" || f.rule === "inline-rgb")).toBe(false);
  });

  it("flags a tailwind color-shade class", () => {
    const r = scanUiSource(`<button className="bg-green-400 text-red-500">x</button>`);
    expect(r.findings.some((f) => f.rule === "tailwind-color-class")).toBe(true);
  });

  it("does NOT flag a semantic (non-color) tailwind class", () => {
    const r = scanUiSource(`<div className="bg-[var(--dpf-surface-1)] w-full lg:w-[360px] p-4">x</div>`);
    expect(r.findings.some((f) => f.rule === "tailwind-color-class")).toBe(false);
  });

  it("flags an inline rgb literal", () => {
    const r = scanUiSource(`const c = "rgba(0,0,0,0.5)";`);
    expect(r.findings.some((f) => f.rule === "inline-rgb")).toBe(true);
  });

  it("suppresses hex findings in comment lines", () => {
    const r = scanUiSource(`// palette idea: #4ade80 for success\n<div className="text-[var(--dpf-success)]" />`);
    expect(r.findings.some((f) => f.rule === "hardcoded-hex")).toBe(false);
  });
});

describe("scanUiSource — a11y", () => {
  it("flags a div with onClick", () => {
    const r = scanUiSource(`<div onClick={go}>press</div>`);
    expect(r.findings.some((f) => f.rule === "div-onclick" && f.severity === "important")).toBe(true);
  });

  it("flags span role=button", () => {
    const r = scanUiSource(`<span role="button" onClick={go}>press</span>`);
    expect(r.findings.some((f) => f.rule === "span-role-button")).toBe(true);
  });

  it("flags interactive source with no focus-visible (file-level, once)", () => {
    const r = scanUiSource(`<button className="bg-[var(--dpf-accent)]">Go</button>`);
    const fv = r.findings.filter((f) => f.rule === "missing-focus-visible");
    expect(fv.length).toBe(1);
  });

  it("does NOT flag missing focus-visible when present", () => {
    const r = scanUiSource(`<button className="focus-visible:outline-2">Go</button>`);
    expect(r.findings.some((f) => f.rule === "missing-focus-visible")).toBe(false);
  });
});

describe("scanUiSource — clean + counts", () => {
  it("reports clean for compliant source", () => {
    const src = `<button className="bg-[var(--dpf-accent)] focus-visible:outline-2" aria-label="Go">Go</button>`;
    const r = scanUiSource(src);
    expect(r.clean).toBe(true);
    expect(r.findings.length).toBe(0);
  });

  it("tallies counts by severity", () => {
    const r = scanUiSource(`<div onClick={x} style={{color:"#fff"}}>a</div>`);
    expect(r.counts.critical + r.counts.important + r.counts.minor).toBe(r.findings.length);
  });
});

describe("formatUiQualityReport", () => {
  it("renders a clean message", () => {
    expect(formatUiQualityReport(scanUiSource(`<div className="text-[var(--dpf-text)]">ok</div>`))).toContain("No design-token or a11y violations");
  });
  it("renders findings with severity and line", () => {
    const md = formatUiQualityReport(scanUiSource(`<div onClick={x}>y</div>`));
    expect(md).toContain("[important]");
    expect(md).toContain("line 1");
  });
});
