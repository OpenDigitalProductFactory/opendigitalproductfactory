import { describe, expect, it } from "vitest";
import * as pageModule from "./page";

describe("digital product page module", () => {
  it("exports a default function (the route handler)", () => {
    expect(typeof pageModule.default).toBe("function");
  });
});
