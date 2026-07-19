// packages/dpf-skill-pack/hooks/surface-manifest-paths.test.mjs
//
// Conformance test (BI-883FC2FC, EP-5560770F). The plane-1 governance guards
// ship INSIDE the dpf-platform plugin and travel to external surface manifests:
// .claude-plugin / .codex-plugin / .grok-plugin / .antigravity-plugin. Every harness resolves a
// manifest's component paths (`skills`, `hooks`, `mcpServers`/`mcpConfig`)
// relative to the PLUGIN ROOT — the package directory that CONTAINS the
// `.<surface>-plugin/` folder — not relative to the manifest's own folder.
//
// THE DEFECT THIS LOCKS OUT. `.grok-plugin/plugin.json` shipped `../skills/`,
// `../hooks/hooks.json`, `../grok.mcp.json`. Resolved from the package root
// those escape ONE LEVEL ABOVE the package, so Grok loaded ZERO components:
// `grok inspect` showed `dpf-platform (user, enabled)  -` and every plane-1
// guard was silently absent (live-probed 2026-07-06: a lease-punt `prisma
// migrate` probe RAN instead of being DENIED). A throwaway plugin with `./`
// paths loaded its hooks correctly, confirming root cause. `.codex-plugin` and
// `.claude-plugin` already used `./`; only Grok's was wrong. This test asserts
// all three use `./`-relative paths that resolve to real files, so the class
// of bug (a manifest silently loading nothing) cannot regress.

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, ".."); // hooks/ -> package root

const SURFACES = [".claude-plugin", ".codex-plugin", ".grok-plugin", ".antigravity-plugin"];
// Manifest keys whose value is a path to a plugin component, resolved from the
// plugin root. Not every surface uses every key; we only check the ones present.
const PATH_KEYS = ["skills", "hooks", "mcpServers", "mcpConfig"];

function loadManifest(surface) {
  const p = join(pkgRoot, surface, "plugin.json");
  return { path: p, json: JSON.parse(readFileSync(p, "utf8")) };
}

test("every surface manifest exists and parses", () => {
  for (const surface of SURFACES) {
    const { json } = loadManifest(surface);
    assert.equal(json.name, "dpf-platform", `${surface}: unexpected plugin name`);
  }
});

test("component paths are ./-relative and never escape the plugin root", () => {
  for (const surface of SURFACES) {
    const { json } = loadManifest(surface);
    for (const key of PATH_KEYS) {
      const val = json[key];
      if (typeof val !== "string") continue; // key absent on this surface
      assert.ok(
        val.startsWith("./"),
        `${surface} plugin.json "${key}": "${val}" must be plugin-root-relative ("./…"). ` +
          `Harnesses resolve component paths from the package root (the dir CONTAINING ${surface}/), ` +
          `so a "../" prefix escapes the package and loads ZERO components (BI-883FC2FC: Grok guards silently absent).`,
      );
      assert.ok(
        !val.includes("../"),
        `${surface} plugin.json "${key}": "${val}" must not contain "../".`,
      );
    }
  }
});

test("referenced component paths resolve to real files/dirs from the plugin root", () => {
  for (const surface of SURFACES) {
    const { json } = loadManifest(surface);
    for (const key of PATH_KEYS) {
      const val = json[key];
      if (typeof val !== "string") continue;
      const target = resolve(pkgRoot, val);
      assert.ok(
        existsSync(target),
        `${surface} plugin.json "${key}": "${val}" resolves to ${target}, which does not exist. ` +
          `A manifest that points at a missing path loads nothing (the BI-883FC2FC failure mode).`,
      );
    }
  }
});
