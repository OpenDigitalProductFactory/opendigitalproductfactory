import { describe, expect, it } from "vitest";

import { isPublicPath } from "./lib/public-paths";

describe("proxy public paths", () => {
  it("allows forgot-password and reset-password routes without authentication", () => {
    expect(isPublicPath("/forgot-password")).toBe(true);
    expect(isPublicPath("/reset-password")).toBe(true);
  });
});
