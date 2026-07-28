import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const scriptSource = fs.readFileSync(
  path.join(repoRoot, "docs", "assets", "js", "doc-diagrams.js"),
  "utf8",
);

function executeDiagramScript(sourcePath, blocks) {
  const created = [];
  const document = {
    currentScript: {
      getAttribute(name) {
        return name === "data-source-path" ? sourcePath : null;
      },
    },
    querySelectorAll(selector) {
      assert.equal(
        selector,
        "div.language-mermaid, pre > code.language-mermaid",
      );
      return blocks;
    },
    createElement(tagName) {
      assert.equal(tagName, "img");
      const element = {};
      created.push(element);
      return element;
    },
  };
  const context = { document };
  context.globalThis = context;
  vm.runInNewContext(scriptSource, context);
  return { api: context.DPFDocDiagrams, created };
}

test("public user-guide root swaps Kramdown code output for the index SVG", () => {
  let replacement;
  const pre = {
    tagName: "PRE",
    replaceWith(value) {
      replacement = value;
    },
  };
  const code = { tagName: "CODE", parentElement: pre };

  const { created } = executeDiagramScript("user-guide/index.md", [code]);

  assert.equal(created.length, 1);
  assert.equal(
    replacement.src,
    "/user-guide/assets/diagrams/index/0.svg",
  );
  assert.equal(replacement.className, "doc-diagram");
  assert.equal(replacement.loading, "lazy");
});

test("nested index pages retain index in the committed diagram slug", () => {
  const { api } = executeDiagramScript("architecture/platform-overview.md", []);

  assert.equal(
    api.diagramSlugFromSourcePath("docs/user-guide/customers/index.md"),
    "customers/index",
  );
  assert.equal(
    api.diagramPublicHref("customers/index", 0),
    "/user-guide/assets/diagrams/customers/index/0.svg",
  );
});

test("Jekyll layout passes the source path to the shared diagram renderer", () => {
  const layout = fs.readFileSync(
    path.join(repoRoot, "docs", "_layouts", "default.html"),
    "utf8",
  );

  assert.match(layout, /assets\/js\/doc-diagrams\.js/);
  assert.match(
    layout,
    /data-source-path="\{\{\s*page\.path\s*\|\s*escape\s*\}\}"/,
  );
  assert.doesNotMatch(layout, /querySelectorAll\("div\.language-mermaid"\)/);
});

test("homepage headings use the compact shared type scale", () => {
  const homepage = fs.readFileSync(
    path.join(repoRoot, "docs", "index.html"),
    "utf8",
  );

  assert.match(
    homepage,
    /--type-display:\s*clamp\(2\.25rem,\s*3\.2vw,\s*3rem\)/,
  );
  assert.match(
    homepage,
    /--type-section:\s*clamp\(1\.6rem,\s*2vw,\s*2rem\)/,
  );
  assert.match(homepage, /h1\s*\{[^}]*font-size:\s*var\(--type-display\)/s);
  assert.match(homepage, /h2\s*\{[^}]*font-size:\s*var\(--type-section\)/s);
});
