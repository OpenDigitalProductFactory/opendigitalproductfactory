import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONTROLLED_SUBSTANCE_COUNT_KINDS,
  CONTROLLED_SUBSTANCE_COUNT_METHODS,
  CONTROLLED_SUBSTANCE_COUNT_TIMINGS,
  CONTROLLED_SUBSTANCE_DISCREPANCY_CLASSES,
  CONTROLLED_SUBSTANCE_DISCREPANCY_STATUSES,
  CONTROLLED_SUBSTANCE_HANDLER_SCOPES,
  CONTROLLED_SUBSTANCE_MOVEMENT_KINDS,
  CONTROLLED_SUBSTANCE_SCHEDULES,
  CONTROLLED_SUBSTANCE_UNITS,
} from "./controlled-substance-enums";

const schema = readFileSync(join(__dirname, "..", "prisma", "schema", "controlled-substances.prisma"), "utf8");

function prismaEnum(name: string): string[] {
  const match = schema.match(new RegExp(`enum ${name} \\{([^}]*)\\}`));
  if (!match) throw new Error(`enum ${name} not found`);
  return match[1]
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter(Boolean);
}

describe("controlled-substance enum parity", () => {
  it.each([
    ["ControlledSubstanceSchedule", CONTROLLED_SUBSTANCE_SCHEDULES],
    ["ControlledSubstanceUnit", CONTROLLED_SUBSTANCE_UNITS],
    ["ControlledSubstanceHandlerScope", CONTROLLED_SUBSTANCE_HANDLER_SCOPES],
    ["ControlledSubstanceMovementKind", CONTROLLED_SUBSTANCE_MOVEMENT_KINDS],
    ["ControlledSubstanceCountKind", CONTROLLED_SUBSTANCE_COUNT_KINDS],
    ["ControlledSubstanceCountTiming", CONTROLLED_SUBSTANCE_COUNT_TIMINGS],
    ["ControlledSubstanceCountMethod", CONTROLLED_SUBSTANCE_COUNT_METHODS],
    ["ControlledSubstanceDiscrepancyClass", CONTROLLED_SUBSTANCE_DISCREPANCY_CLASSES],
    ["ControlledSubstanceDiscrepancyStatus", CONTROLLED_SUBSTANCE_DISCREPANCY_STATUSES],
  ] as const)("%s matches the Prisma enum", (name, values) => {
    expect([...values]).toEqual(prismaEnum(name));
  });
});
