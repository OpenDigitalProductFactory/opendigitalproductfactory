// scripts/check-doc-links.test.mjs
// Run: node --test scripts/check-doc-links.test.mjs
//
// Covers the pure resolver (URL derivation for both surfaces + link
// classification) and the checker (each defect class is caught, and clean
// canonical links pass). The seeded-failure cases are the regression guard the
// Phase 1 gate requires: CI must fail when a dead/non-canonical link is added.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveDocLink,
  sourcePathToPublicHref,
  sourcePathToPortalHref,
  slugifyHeading,
} from "../apps/web/lib/docs/doc-link-resolver.mjs";
import { checkFile } from "./check-doc-links.mjs";

// A minimal synthetic index so tests don't depend on the live corpus.
const INDEX = {
  pageCount: 4,
  pages: {
    "docs/user-guide/getting-started/agent-dev-environments.md": {
      publicHref: "/user-guide/getting-started/agent-dev-environments/",
      portalHref: "/docs/getting-started/agent-dev-environments",
      publishedPublic: true,
      publishedPortal: true,
      anchors: ["prerequisites", "step-1-wire-mcp"],
    },
    "docs/user-guide/getting-started/developer-setup.md": {
      publicHref: "/user-guide/getting-started/developer-setup/",
      portalHref: "/docs/getting-started/developer-setup",
      publishedPublic: true,
      publishedPortal: true,
      anchors: ["prerequisites"],
    },
    "docs/user-guide/build-studio/index.md": {
      publicHref: "/user-guide/build-studio/",
      portalHref: "/docs/build-studio/index",
      publishedPublic: true,
      publishedPortal: true,
      anchors: [],
    },
    "docs/dev/collision-free-dev-workflow.md": {
      publicHref: "/dev/collision-free-dev-workflow/",
      portalHref: null,
      publishedPublic: true,
      publishedPortal: false,
      anchors: [],
    },
  },
};

const SRC = "docs/user-guide/getting-started/agent-dev-environments.md";

function findingsFor(markdown, sourcePath = SRC) {
  const findings = [];
  checkFile(sourcePath, markdown, INDEX, findings);
  return findings;
}

// ── Pure resolver ───────────────────────────────────────────────────────────

test("public href: pretty permalink, index collapses, trailing slash", () => {
  assert.equal(
    sourcePathToPublicHref("docs/user-guide/getting-started/developer-setup.md"),
    "/user-guide/getting-started/developer-setup/",
  );
  assert.equal(sourcePathToPublicHref("docs/user-guide/getting-started/index.md"), "/user-guide/getting-started/");
  assert.equal(sourcePathToPublicHref("docs/user-guide/index.md"), "/user-guide/");
  assert.equal(sourcePathToPublicHref("docs/dev/collision-free-dev-workflow.md"), "/dev/collision-free-dev-workflow/");
});

test("portal href: only user-guide served, keeps /index, root collapses", () => {
  assert.equal(
    sourcePathToPortalHref("docs/user-guide/getting-started/agent-dev-environments.md"),
    "/docs/getting-started/agent-dev-environments",
  );
  assert.equal(sourcePathToPortalHref("docs/user-guide/getting-started/index.md"), "/docs/getting-started/index");
  assert.equal(sourcePathToPortalHref("docs/user-guide/index.md"), "/docs");
  assert.equal(sourcePathToPortalHref("docs/dev/collision-free-dev-workflow.md"), null);
});

test("resolveDocLink: canonical sibling .md link", () => {
  const r = resolveDocLink(SRC, "developer-setup.md");
  assert.equal(r.kind, "internal");
  assert.equal(r.canonical, true);
  assert.equal(r.target.sourcePath, "docs/user-guide/getting-started/developer-setup.md");
});

test("resolveDocLink: extension-less link is non-canonical but resolves the intended target", () => {
  const r = resolveDocLink(SRC, "developer-setup");
  assert.equal(r.kind, "internal");
  assert.equal(r.canonical, false);
  assert.equal(r.target.sourcePath, "docs/user-guide/getting-started/developer-setup.md");
});

test("resolveDocLink: trailing-slash directory link targets the directory index", () => {
  const r = resolveDocLink("docs/user-guide/index.md", "getting-started/");
  assert.equal(r.kind, "internal");
  assert.equal(r.canonical, false);
  assert.equal(r.target.sourcePath, "docs/user-guide/getting-started/index.md");
});

test("resolveDocLink: cross-tree link keeps anchor and derives both surfaces", () => {
  const r = resolveDocLink(SRC, "../../dev/collision-free-dev-workflow.md#setup");
  assert.equal(r.kind, "internal");
  assert.equal(r.target.sourcePath, "docs/dev/collision-free-dev-workflow.md");
  assert.equal(r.target.anchor, "setup");
  assert.equal(r.target.portalOwned, false); // portal falls back to public origin
  assert.ok(r.target.portalHref.startsWith("https://opendigitalproductfactory.com/dev/"));
});

test("resolveDocLink: external, absolute, anchor, and escape classifications", () => {
  assert.equal(resolveDocLink(SRC, "https://example.com").kind, "external");
  assert.equal(resolveDocLink(SRC, "/user-guide/platform/authority-and-audit").kind, "absolute");
  assert.equal(resolveDocLink(SRC, "#prerequisites").kind, "anchor");
  assert.equal(resolveDocLink(SRC, "../../../CONTRIBUTING.md").kind, "invalid");
});

test("slugifyHeading matches GFM-style ids", () => {
  assert.equal(slugifyHeading("Step 1 — Wire MCP"), "step-1-wire-mcp");
  assert.equal(slugifyHeading("Why a dedicated agent?"), "why-a-dedicated-agent");
});

// ── Checker: clean corpus passes ──────────────────────────────────────────────

test("clean canonical links produce no findings", () => {
  const md = [
    "---", "title: X", "---", "",
    "See [Developer Setup](developer-setup.md#prerequisites).",
    "And [Build Studio](../build-studio/index.md).",
    "And [the workflow](../../dev/collision-free-dev-workflow.md).",
    "External [docs](https://code.claude.com/docs) too.",
  ].join("\n");
  assert.deepEqual(findingsFor(md), []);
});

// ── Checker: each defect class is caught (seeded-failure regression guard) ─────

test("seeded dead page link fails", () => {
  const f = findingsFor("[gone](does-not-exist.md)");
  assert.equal(f.length, 1);
  assert.equal(f[0].category, "dead-page");
});

test("seeded extension-less link fails as non-canonical", () => {
  const f = findingsFor("[setup](developer-setup)");
  assert.equal(f[0].category, "noncanonical-extensionless");
});

test("seeded site-absolute link fails", () => {
  const f = findingsFor("[audit](/user-guide/platform/authority-and-audit)");
  assert.equal(f[0].category, "absolute-surface-url");
});

test("seeded dead anchor fails", () => {
  const f = findingsFor("[jump](developer-setup.md#no-such-heading)");
  assert.equal(f[0].category, "dead-anchor");
});

test("seeded link into an unpublished tree fails", () => {
  // add a page that exists in source but is not published publicly
  const idx = { ...INDEX, pages: { ...INDEX.pages, "docs/superpowers/specs/x.md": { publicHref: "/superpowers/specs/x/", portalHref: null, publishedPublic: false, publishedPortal: false, anchors: [] } } };
  const findings = [];
  checkFile(SRC, "[spec](../../superpowers/specs/x.md)", idx, findings);
  // target resolves but is unpublished -> dead-page (not in published index) is acceptable;
  // here it exists in the index but publishedPublic=false -> unpublished-target
  assert.equal(findings[0].category, "unpublished-target");
});

test("links inside fenced code are ignored", () => {
  const md = ["```", "[not a link](does-not-exist)", "```", "", "[real](developer-setup.md)"].join("\n");
  assert.deepEqual(findingsFor(md), []);
});

test("reported line numbers match the real file (frontmatter preserved)", () => {
  const md = ["---", "title: X", "order: 3", "---", "", "line six [bad](nope.md)"].join("\n");
  const f = findingsFor(md);
  assert.equal(f[0].line, 6);
});
