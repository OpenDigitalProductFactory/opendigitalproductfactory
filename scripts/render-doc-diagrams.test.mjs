import assert from "node:assert/strict";
import test from "node:test";

import { extractFenceBodies } from "./render-doc-diagrams.mjs";

// Regression cover for BI-334CB7DE. Fence bodies are content-hashed to decide
// whether a committed SVG is stale, so anything that changes the extracted text
// without changing the diagram forces a spurious re-render — and on Windows a
// re-render is exactly what fails. Git normalises line endings on commit, so
// `git diff` shows nothing to explain it; only a test pins the invariant.

const DOC = [
  "# Page",
  "",
  "Intro prose.",
  "",
  "```mermaid",
  "graph TD",
  "  A --> B",
  "```",
  "",
  "Middle prose.",
  "",
  "```mermaid",
  "sequenceDiagram",
  "  A->>B: hi",
  "```",
  "",
  "Trailing prose.",
  "",
].join("\n");

test("extracts each mermaid fence body in document order", () => {
  const bodies = extractFenceBodies(DOC);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], "graph TD\n  A --> B");
  assert.equal(bodies[1], "sequenceDiagram\n  A->>B: hi");
});

test("CRLF produces byte-identical bodies to LF", () => {
  // The actual 2026-08-27 failure: a doc rewritten with CRLF re-hashed all four
  // of its fences and demanded a re-render although no diagram had changed.
  const lf = extractFenceBodies(DOC);
  const crlf = extractFenceBodies(DOC.replace(/\n/g, "\r\n"));
  assert.deepEqual(crlf, lf);
});

test("lone-CR line endings also produce identical bodies", () => {
  const lf = extractFenceBodies(DOC);
  const cr = extractFenceBodies(DOC.replace(/\n/g, "\r"));
  assert.deepEqual(cr, lf);
});

test("no CR survives into an extracted body", () => {
  for (const body of extractFenceBodies(DOC.replace(/\n/g, "\r\n"))) {
    assert.ok(!body.includes("\r"), `body still carries CR: ${JSON.stringify(body)}`);
  }
});

test("a document with no mermaid fence yields nothing", () => {
  assert.deepEqual(extractFenceBodies("# Title\n\nJust prose.\n"), []);
  assert.deepEqual(extractFenceBodies("```ts\nconst a = 1;\n```\n"), []);
});

test("tilde fences and a language-case variant are recognised", () => {
  assert.deepEqual(extractFenceBodies("~~~mermaid\ngraph TD\n~~~\n"), ["graph TD"]);
  assert.deepEqual(extractFenceBodies("```Mermaid\ngraph TD\n```\n"), ["graph TD"]);
});

test("an unterminated fence is ignored rather than swallowing the rest of the file", () => {
  assert.deepEqual(extractFenceBodies("```mermaid\ngraph TD\n\nmore prose\n"), []);
});

test("indentation inside a fence is preserved — it is significant to Mermaid", () => {
  const [body] = extractFenceBodies("```mermaid\ngraph TD\n    A --> B\n```\n");
  assert.equal(body, "graph TD\n    A --> B");
});
