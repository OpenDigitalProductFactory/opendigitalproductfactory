// BI-10BF6206 — a documented process override must actually reach the portal.
//
// Both installation-identity contracts declare a highest-precedence process
// override. Neither variable was listed in the portal service's `environment:`
// allow-list, and that allow-list is the ONLY way an env var reaches the portal
// on a consumer install: the service has no `env_file:`. So the documented top
// tier could be set in `.env` all day and `process.env` would never see it.
//
// A precedence chain whose first rung is unreachable is not a precedence chain.
// This test is the invariant that stops the next contract shipping one — the
// "fix the seed, then add a guard" shape, where the guard is the durable half.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ENVIRONMENT_CLASS_ENV_VAR } from "./environment-class-contract";
import { ESTATE_NAME_ENV_VAR } from "./estate-identity-contract";

const COMPOSE = readFileSync(
  fileURLToPath(new URL("../../../../docker-compose.yml", import.meta.url)),
  "utf8",
);

/** The portal service block, which owns the allow-list the portal process sees. */
function portalServiceBlock(): string {
  const start = COMPOSE.indexOf("\n  portal:\n");
  expect(start, "portal service not found in docker-compose.yml").toBeGreaterThan(-1);
  const rest = COMPOSE.slice(start + 1);
  const next = rest.search(/\n {2}[a-zA-Z0-9_-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("documented process overrides reach the portal", () => {
  const block = portalServiceBlock();

  it.each([
    ["environment class", ENVIRONMENT_CLASS_ENV_VAR],
    ["estate name", ESTATE_NAME_ENV_VAR],
  ])("%s override %s is in the portal environment allow-list", (_label, variable) => {
    expect(
      block.includes(`${variable}:`),
      `${variable} is documented as a process override but is absent from the portal ` +
        "service's environment: allow-list, so it can never reach process.env on a " +
        "consumer install. Add it with an empty default.",
    ).toBe(true);
  });

  it("keeps them optional, so the tier stays silent unless an operator sets it", () => {
    for (const variable of [ENVIRONMENT_CLASS_ENV_VAR, ESTATE_NAME_ENV_VAR]) {
      expect(block).toContain(`${variable}: \${${variable}:-}`);
    }
  });

  // The premise. If the portal ever gains an env_file, this test's reasoning
  // changes and it should be revisited rather than silently kept passing.
  it("still holds the premise: the portal has no env_file", () => {
    expect(block).not.toContain("env_file");
  });
});
