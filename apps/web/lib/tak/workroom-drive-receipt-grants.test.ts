import { describe, expect, it } from "vitest";

import { isToolAllowedByGrants } from "./agent-grants";

describe("record_workroom_stage_receipt grants", () => {
  it("accepts workroom_drive_write and work_capsule_write via implication", () => {
    expect(isToolAllowedByGrants("record_workroom_stage_receipt", ["workroom_drive_write"])).toBe(true);
    expect(isToolAllowedByGrants("record_workroom_stage_receipt", ["work_capsule_write"])).toBe(true);
    expect(isToolAllowedByGrants("record_workroom_stage_receipt", ["work_room_write"])).toBe(false);
    expect(isToolAllowedByGrants("record_workroom_stage_receipt", ["backlog_read"])).toBe(false);
  });
});
