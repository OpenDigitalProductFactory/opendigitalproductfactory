import { describe, expect, it } from "vitest";

import { hiveScoutIngest } from "./hive-scout-ingest";
import { allFunctions } from "./index";

describe("queue registry", () => {
  it("does not register the legacy standalone Hive Scout cron path", () => {
    expect(allFunctions).not.toContain(hiveScoutIngest);
  });
});
