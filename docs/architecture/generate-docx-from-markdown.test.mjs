// Run: pnpm docs:agent-standards:test (tsx loads the portal's TypeScript modules).
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import { publicationConfig, publicationKeys } from "./agent-standard-publications.mjs";
import {
  doctoolsCommand,
  embeddableImagePath,
  extractMermaidFences,
  generateDocxFromMarkdown,
  inlineLocalImages,
  publicationHtml,
  replaceMermaidFences,
  withPublicationFrontMatter,
} from "./generate-docx-from-markdown.mjs";

// A 1x1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
const dir = mkdtempSync(join(tmpdir(), "dpf-docx-gen-"));
mkdirSync(join(dir, "d", "png"), { recursive: true });
mkdirSync(join(dir, "d", "svg"), { recursive: true });
writeFileSync(join(dir, "d", "png", "a.png"), PNG);
writeFileSync(join(dir, "d", "svg", "a.svg"), "<svg/>");
writeFileSync(join(dir, "d", "svg", "lonely.svg"), "<svg/>");
after(() => rmSync(dir, { recursive: true, force: true }));

describe("inlineLocalImages", () => {
  it("embeds a local PNG as a data: URI", () => {
    const out = inlineLocalImages("![Alt](d/png/a.png)", dir);
    assert.equal(out, `![Alt](data:image/png;base64,${PNG.toString("base64")})`);
  });

  it("swaps an SVG diagram for its PNG companion", () => {
    assert.equal(embeddableImagePath(join(dir, "d", "svg", "a.svg")), join(dir, "d", "png", "a.png"));
    assert.match(inlineLocalImages("![x](d/svg/a.svg)", dir), /^!\[x\]\(data:image\/png;base64,/);
  });

  it("leaves remote, missing and raster-less images as written", () => {
    for (const md of ["![r](https://example.test/a.png)", "![m](d/png/missing.png)", "![s](d/svg/lonely.svg)"]) {
      assert.equal(inlineLocalImages(md, dir), md);
    }
  });

  it("does not touch image syntax inside fenced code", () => {
    const md = ["```md", "![Alt](d/png/a.png)", "```", "![Alt](d/png/a.png)"].join("\n");
    const lines = inlineLocalImages(md, dir).split("\n");
    assert.equal(lines[1], "![Alt](d/png/a.png)");
    assert.match(lines[3], /data:image\/png/);
  });
});

describe("inline Mermaid blocks", () => {
  const md = ["# T", "```mermaid", "flowchart TB", "  a --> b", "```", "text", "```mermaid", "flowchart LR", "  c --> d", "```"].join("\n");

  it("extracts each block's source in document order", () => {
    assert.deepEqual(extractMermaidFences(md), ["flowchart TB\n  a --> b\n", "flowchart LR\n  c --> d\n"]);
  });

  it("replaces a block with its rendered PNG and leaves an unrendered one as written", () => {
    writeFileSync(join(dir, "d", "png", "doc-fence-01.png"), PNG);
    const out = replaceMermaidFences(md, join(dir, "d"), "doc-fence");
    assert.ok(out.includes(`![Diagram 1](${join(dir, "d", "png", "doc-fence-01.png")})`), out);
    assert.doesNotMatch(out, /flowchart TB/);
    assert.match(out, /```mermaid\nflowchart LR/);
  });
});

describe("withPublicationFrontMatter", () => {
  it("puts the subtitle and date under the first H1", () => {
    const out = withPublicationFrontMatter("# Title\n\n## Abstract", { subtitle: "Sub", generatedOn: "2026-01-02" });
    assert.equal(out, "# Title\n\n**Sub**\n\n*Generated 2026-01-02*\n\n## Abstract");
  });
});

describe("publicationHtml", () => {
  it("renders every publication with its diagrams embedded", async () => {
    for (const key of publicationKeys()) {
      const html = await publicationHtml({ ...publicationConfig(key), generatedOn: "2026-01-02" });
      assert.match(html, /^<!DOCTYPE html>/, key);
      assert.match(html, /<table>/, key);
      assert.match(html, /<img src="data:image\/png;base64,/, key);
      assert.doesNotMatch(html, /<img src="(?!data:)/, key);
    }
  });
});

describe("doctoolsCommand", () => {
  it("uses the portal's hardened dpf-convert argv", async () => {
    const { command, args } = await doctoolsCommand(`sha256:${"b".repeat(64)}`);
    assert.equal(command, "docker");
    for (const flag of ["--network", "--read-only", "--cap-drop"]) assert.ok(args.includes(flag), flag);
    assert.deepEqual(args.slice(-4), ["--to", "docx", "--from", "html"]);
  });

  it("refuses an image that is not pinned by digest", async () => {
    await assert.rejects(() => doctoolsCommand("dpf-doctools:latest"), /pinned by digest/);
  });
});

// Exercise the actual publication entry point and shared renderer adapter.
// Only the converter process boundary is controlled; the MMDC fixture really
// runs through Node on every platform, with no PATH shim or Docker invocation.
async function withPublicationFixture(t, run) {
  const root = mkdtempSync(join(tmpdir(), "dpf-docx-publication-"));
  const envKeys = ["MMDC", "DPF_DOCTOOLS_IMAGE", "DPF_DOCX_TEST_RENDER_LOG", "DPF_DOCX_TEST_RENDER_MODE"];
  const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const converterCalls = [];
  const converted = Buffer.from("controlled converter output, not a real Word rendition");
  t.mock.method(childProcess, "spawnSync", (command, args, options) => {
    converterCalls.push({ command, args, options });
    return { status: 0, stdout: converted, stderr: Buffer.alloc(0) };
  });
  syncBuiltinESMExports();
  try {
    const diagrams = join(root, "diagrams");
    mkdirSync(join(diagrams, "svg"), { recursive: true });
    mkdirSync(join(diagrams, "png"), { recursive: true });
    const source = join(diagrams, "diagram.mmd");
    const svg = join(diagrams, "svg", "diagram.svg");
    const png = join(diagrams, "png", "diagram.png");
    const config = join(diagrams, "mermaid-config.json");
    const markdownPath = join(root, "draft.md");
    const outputPath = join(root, "draft.docx");
    const priorDocx = Buffer.from("prior published edition");
    const priorSvg = "<svg>prior SVG</svg>";
    const priorPng = Buffer.from("prior PNG");
    const logPath = join(root, "render.jsonl");
    const cli = join(root, "mmdc.mjs");
    writeFileSync(source, "flowchart LR\n  A --> B\n");
    writeFileSync(svg, priorSvg);
    writeFileSync(png, priorPng);
    writeFileSync(config, '{"theme":"base"}');
    writeFileSync(markdownPath, "# Test\n\n![Diagram](diagrams/svg/diagram.svg)\n");
    writeFileSync(outputPath, priorDocx);
    utimesSync(config, 50, 50);
    utimesSync(source, 100, 100);
    utimesSync(svg, 300, 300);
    utimesSync(png, 50, 50);
    writeFileSync(cli, `
      import fs from "node:fs";
      import path from "node:path";
      const args = process.argv.slice(2);
      const output = args[args.indexOf("-o") + 1];
      const format = path.extname(output).slice(1);
      const mode = process.env.DPF_DOCX_TEST_RENDER_MODE;
      fs.appendFileSync(process.env.DPF_DOCX_TEST_RENDER_LOG, JSON.stringify({output, format, args}) + "\\n");
      if (mode === "fail-" + format) process.exit(42);
      if (mode === "missing-" + format) process.exit(0);
      fs.writeFileSync(output, mode === "empty-" + format ? Buffer.alloc(0)
        : format === "svg" ? '<svg xmlns="http://www.w3.org/2000/svg">fresh SVG</svg>'
        : Buffer.from("${PNG.toString("base64")}", "base64"));
    `);
    process.env.MMDC = cli;
    process.env.DPF_DOCTOOLS_IMAGE = `sha256:${"b".repeat(64)}`;
    process.env.DPF_DOCX_TEST_RENDER_LOG = logPath;
    delete process.env.DPF_DOCX_TEST_RENDER_MODE;
    await run({
      root, source, svg, png, config, outputPath, priorDocx, priorSvg, priorPng, converterCalls, converted,
      generate: () => generateDocxFromMarkdown({ markdownPath, outputPath, title: "Test", diagramsDir: diagrams }),
      renderCalls: () => existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n").map(JSON.parse) : [],
    });
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
}

function assertRenderedPairsCleaned(calls) {
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.equal(existsSync(call.output), false, `temporary output retained: ${call.output}`);
    assert.equal(existsSync(dirname(call.output)), false, `temporary directory retained: ${dirname(call.output)}`);
  }
}

describe("Mermaid publication freshness and failure boundaries", () => {
  it("regenerates both companions despite a fresh SVG, retaining configuration and converter hardening", t => withPublicationFixture(t, async f => {
    await f.generate();
    const calls = f.renderCalls();
    assert.deepEqual(calls.map(call => call.format), ["svg", "png"]);
    assert.match(readFileSync(f.svg, "utf8"), /fresh SVG/);
    assert.deepEqual(readFileSync(f.png), PNG);
    for (const call of calls) {
      assert.equal(call.args[call.args.indexOf("-i") + 1], f.source);
      assert.equal(call.args[call.args.indexOf("-c") + 1], f.config);
      assert.equal(call.args[call.args.indexOf("-b") + 1], "white");
    }
    assert.equal(calls[1].args[calls[1].args.indexOf("-s") + 1], "4");
    assert.equal(f.converterCalls.length, 1);
    const converter = f.converterCalls[0];
    assert.equal(converter.command, "docker");
    assert.equal(converter.args[converter.args.indexOf("--network") + 1], "none");
    assert.ok(converter.args.includes("--read-only"));
    assert.ok(converter.args.includes("--cap-drop"));
    assert.deepEqual(converter.args.slice(-4), ["--to", "docx", "--from", "html"]);
    assert.match(converter.options.input.toString(), /data:image\/png;base64,/);
    assert.deepEqual(readFileSync(f.outputPath), f.converted);
    assertRenderedPairsCleaned(calls);
  }));

  it("regenerates a missing PNG even when the SVG is current", t => withPublicationFixture(t, async f => {
    rmSync(f.png);
    await f.generate();
    assert.deepEqual(f.renderCalls().map(call => call.format), ["svg", "png"]);
    assert.deepEqual(readFileSync(f.png), PNG);
    assert.equal(f.converterCalls.length, 1);
    assertRenderedPairsCleaned(f.renderCalls());
  }));

  it("aborts before conversion when no renderer is available, preserving the prior edition", t => withPublicationFixture(t, async f => {
    process.env.MMDC = join(f.root, "missing-mmdc.mjs");
    await assert.rejects(f.generate, /No Mermaid renderer available/);
    assert.equal(f.converterCalls.length, 0);
    assert.deepEqual(readFileSync(f.outputPath), f.priorDocx);
    assert.deepEqual(readFileSync(f.png), f.priorPng);
  }));

  for (const mode of ["fail-svg", "fail-png", "missing-svg", "missing-png", "empty-svg", "empty-png"]) {
    it(`aborts real publication on ${mode}, preserving the edition and prior companions`, t => withPublicationFixture(t, async f => {
      utimesSync(f.source, 400, 400);
      process.env.DPF_DOCX_TEST_RENDER_MODE = mode;
      await assert.rejects(f.generate, /Failed to render diagram.mmd; publication aborted/);
      assert.equal(f.converterCalls.length, 0);
      assert.deepEqual(readFileSync(f.outputPath), f.priorDocx);
      assert.equal(readFileSync(f.svg, "utf8"), f.priorSvg);
      assert.deepEqual(readFileSync(f.png), f.priorPng);
      assertRenderedPairsCleaned(f.renderCalls());
    }));
  }
});
