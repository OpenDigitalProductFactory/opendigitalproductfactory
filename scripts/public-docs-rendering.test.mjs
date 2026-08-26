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
  context.DPFDocDiagrams.renderDocDiagrams(document, sourcePath);
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

test("architecture pages swap fences for SVGs under the shared asset root", () => {
  let replacement;
  const pre = {
    tagName: "PRE",
    replaceWith(value) {
      replacement = value;
    },
  };
  const code = { tagName: "CODE", parentElement: pre };

  const { api, created } = executeDiagramScript(
    "architecture/platform-overview.md",
    [code],
  );

  assert.equal(created.length, 1);
  assert.equal(
    replacement.src,
    "/user-guide/assets/diagrams/architecture/platform-overview/0.svg",
  );
  assert.equal(
    api.diagramSlugFromSourcePath("docs/architecture/platform-overview.md"),
    "architecture/platform-overview",
  );
  assert.equal(api.diagramSlugFromSourcePath("superpowers/specs/x.md"), null);
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

test("diagram paths reject traversal and markup-bearing source paths", () => {
  const { api } = executeDiagramScript("architecture/platform-overview.md", []);

  assert.equal(
    api.diagramSlugFromSourcePath("user-guide/../../index.md"),
    null,
  );
  assert.equal(
    api.diagramSlugFromSourcePath("user-guide/<img>/index.md"),
    null,
  );
});

test("Jekyll passes its build-time source path without reading DOM text", () => {
  const layout = fs.readFileSync(
    path.join(repoRoot, "docs", "_layouts", "default.html"),
    "utf8",
  );

  assert.match(layout, /assets\/js\/doc-diagrams\.js/);
  assert.match(
    layout,
    /renderDocDiagrams\(document,\s*\{\{\s*page\.path\s*\|\s*jsonify\s*\}\}\)/,
  );
  assert.doesNotMatch(layout, /data-source-path/);
  assert.doesNotMatch(scriptSource, /currentScript|getAttribute/);
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

test("homepage install cards expose both customer hardware profiles for each GA host", () => {
  const homepage = fs.readFileSync(
    path.join(repoRoot, "docs", "index.html"),
    "utf8",
  );
  const installSection = homepage.match(
    /<section id="install">(?<content>[\s\S]*?)<\/section>/,
  )?.groups?.content;

  assert.ok(installSection, "the public homepage needs an install decision surface");
  const windowsCard = installSection.match(
    /data-install-target="windows"(?<content>[\s\S]*?)<\/article>/,
  )?.groups?.content;
  const macCard = installSection.match(
    /data-install-target="macos"(?<content>[\s\S]*?)<\/article>/,
  )?.groups?.content;

  assert.ok(windowsCard, "Windows must have a first-class install card");
  assert.match(windowsCard, /Provider-assisted operations/);
  assert.match(windowsCard, /32 GB system RAM/);
  assert.match(windowsCard, /Local-first operations/);
  assert.match(windowsCard, /32 GB recommended for a new purchase/);
  assert.match(windowsCard, /href="\/install\/windows\/"/);
  const windowsLinks = [...windowsCard.matchAll(/href="([^"]+)"/g)].map(
    ([, href]) => href,
  );
  assert.deepEqual(windowsLinks, ["/install/windows/"]);

  assert.ok(macCard, "macOS must have a first-class install card");
  assert.match(macCard, /Provider-assisted operations/);
  assert.match(macCard, /32 GB unified memory/);
  assert.match(macCard, /Local-first operations/);
  assert.match(macCard, /128 GB for larger models or combined operations and development/);
  assert.match(macCard, /href="\/install\/macos\/"/);
});

test("both tested OS guides carry the same visible hardware decision and canonical comparison", () => {
  const windows = fs.readFileSync(
    path.join(repoRoot, "docs", "install", "windows.md"),
    "utf8",
  );
  const macos = fs.readFileSync(
    path.join(repoRoot, "docs", "install", "macos.md"),
    "utf8",
  );

  for (const [name, guide] of [["Windows", windows], ["macOS", macos]]) {
    assert.match(guide, /^## Recommended hardware$/m, `${name} guide needs hardware before setup`);
    assert.match(guide, /Provider-assisted operations/);
    assert.match(guide, /Local-first operations/);
    assert.match(guide, /\[Choosing Hardware for DPF\]\(hardware\.md\)/);
  }
});
