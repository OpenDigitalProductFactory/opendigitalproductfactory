import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { BUILD_DISPATCH_USER_SELECT } from "./build-on-plan-approval";

/** Field names declared on a Prisma model, read from the committed schema file. */
function modelFields(schemaFile: string, model: string): Set<string> {
  const text = readFileSync(resolve(__dirname, "../../../../packages/db/prisma/schema", schemaFile), "utf8");
  const block = text.match(new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, "m"))?.[1];
  if (!block) throw new Error(`model ${model} not found in ${schemaFile}`);
  return new Set(
    block.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("//") && !line.startsWith("@@"))
      .map((line) => line.split(/\s+/)[0]!),
  );
}

describe("build dispatch auth context", () => {
  // BI-937E106A: the lookup selected `platformRole` directly on User, which has
  // no such field. Prisma threw on every call, `.catch(() => null)` swallowed it,
  // and the orchestrator ran every build as a roleless non-superuser. The tool
  // filter then dropped every sandbox tool, so the model was given none and its
  // prose was recorded as a finished task (FB-D5CE056F, 2026-09-23). A mocked
  // Prisma cannot catch a select key that does not exist, so check the schema.
  it("selects only fields the User model declares", () => {
    const userFields = modelFields("core-identity.prisma", "User");
    for (const key of Object.keys(BUILD_DISPATCH_USER_SELECT)) {
      expect(userFields, `User has no field "${key}"`).toContain(key);
    }
  });

  it("reads the role through the user's group, where it lives", () => {
    expect(BUILD_DISPATCH_USER_SELECT.groups.select).toHaveProperty("platformRole");
    expect(BUILD_DISPATCH_USER_SELECT).toHaveProperty("isSuperuser", true);
  });
});
