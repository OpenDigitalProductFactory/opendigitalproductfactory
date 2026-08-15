import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rootPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const PACKAGE_BACKED_RUNTIME_OWNERS = Object.freeze({
  playwright: "@playwright/test",
  tsx: "tsx",
});

function directDependencies(pkg) {
  return new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);
}

function packageBackedCommands(scripts) {
  const commands = [];
  for (const [scriptName, command] of Object.entries(scripts ?? {})) {
    for (const segment of command.split(/&&|\|\|/u)) {
      const executable = segment.trim().split(/\s+/u)[0];
      const owner = PACKAGE_BACKED_RUNTIME_OWNERS[executable];
      if (owner) commands.push({ scriptName, executable, owner });
    }
  }
  return commands;
}

test("root package scripts directly declare every package-backed runtime they invoke", () => {
  const declared = directDependencies(rootPackage);
  const undeclared = packageBackedCommands(rootPackage.scripts)
    .filter(({ owner }) => !declared.has(owner));

  assert.deepEqual(
    undeclared,
    [],
    `Root scripts use undeclared package executables:\n${undeclared
      .map(({ scriptName, executable, owner }) => `- ${scriptName}: ${executable} (declare ${owner})`)
      .join("\n")}`,
  );
});
