#!/usr/bin/env node

import { readFile } from "node:fs/promises";

// The mermaid / zenuml members of this pin set left with the workspace's
// mermaid-cli dependency (BI-DBDB8C6D): the diagram renderer is now the
// digest-pinned tool image in scripts/lib/mermaid-renderer.mjs, so the
// "last policy-vetted diagram stack" rule is carried by that digest. The
// @floating-ui pins remain (direct apps/web runtime dependency).
const forbiddenRootDependencies = ['"@mermaid-js/mermaid-cli"', '"puppeteer"'];
const expectedOverrides = [
  "'@floating-ui/core': '1.7.5'",
  "'@floating-ui/dom': '1.7.6'",
  "'@floating-ui/react-dom': '2.1.8'",
  "'@floating-ui/react': '0.27.19'",
  "'@floating-ui/utils': '0.2.11'",
];
const rejectedLockEntries = [
  "@mermaid-js/mermaid-cli@",
  "puppeteer@",
  "@floating-ui/core@1.8.0",
  "@floating-ui/dom@1.8.0",
  "@floating-ui/react-dom@2.1.9",
  "@floating-ui/react@0.27.20",
  "@floating-ui/utils@0.2.12",
];

const [packageJson, workspace, lockfile] = await Promise.all([
  readFile("package.json", "utf8"),
  readFile("pnpm-workspace.yaml", "utf8"),
  readFile("pnpm-lock.yaml", "utf8"),
]);

const errors = [];
for (const dep of forbiddenRootDependencies) {
  if (packageJson.includes(dep)) errors.push(`package.json must not re-add ${dep} (render via scripts/lib/mermaid-renderer.mjs)`);
}
for (const override of expectedOverrides) {
  if (!workspace.includes(override)) errors.push(`missing workspace override: ${override}`);
}
for (const entry of rejectedLockEntries) {
  if (lockfile.includes(entry)) errors.push(`retired or release-age-blocked lock entry returned: ${entry}`);
}

if (errors.length > 0) {
  console.error("Diagram dependency pin guard failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Diagram dependency pins and lockfile are policy-safe.");
