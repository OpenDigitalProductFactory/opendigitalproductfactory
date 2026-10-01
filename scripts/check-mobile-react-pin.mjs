#!/usr/bin/env node
/**
 * CI guard — apps/mobile declares exactly the React its override pins.
 *
 * React enforces a runtime invariant: the `react` package must EXACTLY equal
 * the renderer react-native embeds (BI-E5E72FE3). apps/mobile/pnpm-workspace.yaml
 * pins that version through `overrides.react`. When package.json declares a
 * different react or react-test-renderer, the override hides it for react but
 * not for react-test-renderer: #5705/#5736 left react-test-renderer 19.2.8
 * resolved against react 19.2.3 (a broken exact peer, and a second copy in the
 * lockfile). This guard keeps every declared React-family version equal to the
 * override.
 *
 * Exit 0 when aligned, 1 when a declared version differs from the pin.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isEntryModule } from "./lib/entry-module.mjs";

const PINNED_NAMES = ["react", "react-dom", "react-test-renderer"];

/** The `overrides.react` value from a pnpm-workspace.yaml text, or null. */
export function readReactOverride(workspaceYaml) {
  let inOverrides = false;
  for (const raw of workspaceYaml.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    if (/^\S/.test(line)) inOverrides = /^overrides:\s*$/.test(line);
    else if (inOverrides) {
      const m = /^\s+['"]?react['"]?:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line);
      if (m) return m[1];
    }
  }
  return null;
}

/** Declared React-family versions that differ from the pinned version. */
export function findReactPinDrift(pkg, pinned) {
  const drift = [];
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    for (const name of PINNED_NAMES) {
      const declared = pkg[field]?.[name];
      if (declared !== undefined && declared !== pinned) drift.push({ field, name, declared });
    }
  }
  return drift;
}

function main() {
  const root = process.cwd();
  const pinned = readReactOverride(readFileSync(join(root, "apps/mobile/pnpm-workspace.yaml"), "utf8"));
  if (!pinned) {
    console.error("ERROR: apps/mobile/pnpm-workspace.yaml has no overrides.react pin.");
    process.exit(1);
  }
  const pkg = JSON.parse(readFileSync(join(root, "apps/mobile/package.json"), "utf8"));
  const drift = findReactPinDrift(pkg, pinned);
  if (drift.length > 0) {
    console.error(`ERROR: apps/mobile declares React versions that differ from the ${pinned} pin:`);
    for (const d of drift) console.error(`  ${d.field}.${d.name} = ${d.declared}`);
    console.error("Set them to the pin, or move the pin with an Expo SDK upgrade (BI-E5E72FE3).");
    process.exit(1);
  }
  console.log(`✓ apps/mobile React family declared at the ${pinned} pin.`);
}

if (isEntryModule(import.meta.url)) main();
