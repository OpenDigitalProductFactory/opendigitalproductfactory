import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  hasIntrinsicDocDiagramSize,
  normalizeDocDiagramSvg,
  normalizeDocDiagramSvgFile,
} from "./doc-diagram-svg.mjs";

test("normalizes Mermaid's responsive width to the viewBox aspect ratio", () => {
  const svg = '<svg width="100%" style="max-width: 586px" viewBox="0 0 586 442"><g/></svg>';
  const normalized = normalizeDocDiagramSvg(svg);

  assert.match(normalized, /^<svg height="442" width="586"/);
  assert.equal(hasIntrinsicDocDiagramSize(normalized), true);
});

test("leaves SVGs without a valid viewBox unchanged", () => {
  const svg = '<svg width="100%"><g/></svg>';
  assert.equal(normalizeDocDiagramSvg(svg), svg);
  assert.equal(hasIntrinsicDocDiagramSize(svg), false);
});

test("normalizes an existing SVG through its open file descriptor", () => {
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-doc-diagram-svg-"));
  const svgPath = path.join(tempDir, "diagram.svg");

  try {
    fs.writeFileSync(svgPath, '<svg width="100%" viewBox="0 0 586 442"><g/></svg>');

    assert.equal(normalizeDocDiagramSvgFile(svgPath), true);
    assert.match(fs.readFileSync(svgPath, "utf8"), /^<svg height="442" width="586"/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("reports a missing SVG without creating it", () => {
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-doc-diagram-svg-"));
  const svgPath = path.join(tempDir, "missing.svg");

  try {
    assert.equal(normalizeDocDiagramSvgFile(svgPath), false);
    assert.equal(fs.existsSync(svgPath), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
