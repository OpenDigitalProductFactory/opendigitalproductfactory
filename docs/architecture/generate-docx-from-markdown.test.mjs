// Run: pnpm docs:agent-standards:test (tsx loads the portal's TypeScript modules).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { publicationConfig, publicationKeys } from "./agent-standard-publications.mjs";
import {
  doctoolsCommand,
  embeddableImagePath,
  inlineLocalImages,
  publicationHtml,
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
