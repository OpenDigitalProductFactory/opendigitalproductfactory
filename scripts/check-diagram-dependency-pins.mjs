#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const expectedRootDependency = '"@mermaid-js/mermaid-cli": "11.16.0"';
const expectedOverrides = [
  "mermaid: '11.16.1'",
  "'@mermaid-js/mermaid-zenuml': '0.2.2'",
  "'@zenuml/core': '3.47.8'",
  "'@floating-ui/core': '1.7.5'",
  "'@floating-ui/dom': '1.7.6'",
  "'@floating-ui/react-dom': '2.1.8'",
  "'@floating-ui/react': '0.27.19'",
  "'@floating-ui/utils': '0.2.11'",
];
const rejectedLockEntries = [
  "@mermaid-js/mermaid-zenuml@0.2.3",
  "@zenuml/core@3.50.1",
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
if (!packageJson.includes(expectedRootDependency)) {
  errors.push(`package.json must retain ${expectedRootDependency}`);
}
for (const override of expectedOverrides) {
  if (!workspace.includes(override)) errors.push(`missing workspace override: ${override}`);
}
for (const entry of rejectedLockEntries) {
  if (lockfile.includes(entry)) errors.push(`release-age-blocked lock entry returned: ${entry}`);
}

if (errors.length > 0) {
  console.error("Diagram dependency pin guard failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Diagram dependency pins and lockfile are policy-safe.");
