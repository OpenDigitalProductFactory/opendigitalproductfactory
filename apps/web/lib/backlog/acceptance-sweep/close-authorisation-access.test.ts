import { describe, expect, it } from "vitest";

import { mayManageCloseAuthorisation } from "./close-authorisation-access";

// BI-C2467A2E AC-2: only a role holding manage_platform AND manage_backlog sees
// or uses the close-authorisation card.

describe("mayManageCloseAuthorisation", () => {
  it("allows a role holding both capabilities", () => {
    expect(mayManageCloseAuthorisation({ platformRole: "HR-000", isSuperuser: false })).toBe(true);
    expect(mayManageCloseAuthorisation({ platformRole: null, isSuperuser: true })).toBe(true);
  });

  it("refuses a role holding only manage_backlog, or neither", () => {
    expect(mayManageCloseAuthorisation({ platformRole: "HR-500", isSuperuser: false })).toBe(false);
    expect(mayManageCloseAuthorisation({ platformRole: "HR-300", isSuperuser: false })).toBe(false);
    expect(mayManageCloseAuthorisation({ platformRole: null, isSuperuser: false })).toBe(false);
  });
});
