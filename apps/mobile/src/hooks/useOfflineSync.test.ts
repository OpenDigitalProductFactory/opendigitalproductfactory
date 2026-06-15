import { shouldFlush } from "./useOfflineSync";

describe("shouldFlush", () => {
  it("flushes only on an offline -> online transition with pending work", () => {
    expect(shouldFlush(false, true, true)).toBe(true);
  });

  it("does not flush when there is nothing pending", () => {
    expect(shouldFlush(false, true, false)).toBe(false);
  });

  it("does not flush while staying online", () => {
    expect(shouldFlush(true, true, true)).toBe(false);
  });

  it("does not flush when going offline", () => {
    expect(shouldFlush(true, false, true)).toBe(false);
  });
});
