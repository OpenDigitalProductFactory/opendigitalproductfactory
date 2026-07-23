// BI-C89E471F regression guard.
//
// vitest.config.ts prepends `--no-experimental-webstorage` to NODE_OPTIONS so
// Node >=25's experimental host web-storage globals cannot shadow the storage
// jsdom installs in each fork worker — the shadowing corrupts the jsdom
// environment enough that React component renders throw
// "Cannot read properties of null (reading 'useContext')", which turned the
// whole component-test surface red on any Node >=25 host while CI on Node 24
// stayed green.
//
// Fork workers inherit the parent NODE_OPTIONS, so if the config applied the
// flag it is visible here. This assertion is deterministic on EVERY Node version
// (the config sets the flag unconditionally), so it fails the moment someone
// deletes the config line — turning a silent, Node-version-specific regression
// back into a red unit test on all of CI, not only on a >=25 host.

import { describe, it, expect } from "vitest";

describe("vitest worker inherits the webstorage-disable flag (BI-C89E471F)", () => {
  it("carries --no-experimental-webstorage in NODE_OPTIONS", () => {
    expect(process.env.NODE_OPTIONS ?? "").toMatch(
      /(^|\s)--no-experimental-webstorage(\s|$)/,
    );
  });

  it("does not double-apply the flag when it is already set", () => {
    const occurrences = (process.env.NODE_OPTIONS ?? "").match(
      /--no-experimental-webstorage/g,
    );
    expect(occurrences?.length ?? 0).toBe(1);
  });
});
