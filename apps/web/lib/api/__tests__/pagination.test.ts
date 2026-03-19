import { describe, expect, it } from "vitest";
import { parsePagination, buildPaginatedResponse } from "../pagination.js";

// ---------------------------------------------------------------------------
// parsePagination
// ---------------------------------------------------------------------------
describe("parsePagination", () => {
  it("returns defaults when no params given", () => {
    const params = new URLSearchParams();
    const result = parsePagination(params);
    expect(result.cursor).toBeNull();
    expect(result.limit).toBe(50);
  });

  it("parses cursor from query", () => {
    const params = new URLSearchParams({ cursor: "abc-123" });
    const result = parsePagination(params);
    expect(result.cursor).toBe("abc-123");
  });

  it("parses custom limit", () => {
    const params = new URLSearchParams({ limit: "25" });
    const result = parsePagination(params);
    expect(result.limit).toBe(25);
  });

  it("caps limit at 200", () => {
    const params = new URLSearchParams({ limit: "500" });
    const result = parsePagination(params);
    expect(result.limit).toBe(200);
  });

  it("uses default limit for non-numeric input", () => {
    const params = new URLSearchParams({ limit: "abc" });
    const result = parsePagination(params);
    expect(result.limit).toBe(50);
  });

  it("uses default limit for zero", () => {
    const params = new URLSearchParams({ limit: "0" });
    const result = parsePagination(params);
    expect(result.limit).toBe(50);
  });

  it("uses default limit for negative numbers", () => {
    const params = new URLSearchParams({ limit: "-10" });
    const result = parsePagination(params);
    expect(result.limit).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// buildPaginatedResponse
// ---------------------------------------------------------------------------
describe("buildPaginatedResponse", () => {
  it("returns all items with no nextCursor when within limit", () => {
    const items = [
      { id: "1", name: "a" },
      { id: "2", name: "b" },
    ];
    const result = buildPaginatedResponse(items, 10);
    expect(result.data).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it("returns items exactly at limit with no nextCursor", () => {
    const items = [
      { id: "1", name: "a" },
      { id: "2", name: "b" },
      { id: "3", name: "c" },
    ];
    const result = buildPaginatedResponse(items, 3);
    expect(result.data).toHaveLength(3);
    expect(result.nextCursor).toBeNull();
  });

  it("truncates and returns nextCursor when items exceed limit", () => {
    // Query fetches limit+1 to detect more pages
    const items = [
      { id: "1", name: "a" },
      { id: "2", name: "b" },
      { id: "3", name: "c" },
      { id: "4", name: "d" }, // extra item indicating more pages
    ];
    const result = buildPaginatedResponse(items, 3);
    expect(result.data).toHaveLength(3);
    expect(result.nextCursor).toBe("3"); // last item in returned set
  });

  it("handles empty array", () => {
    const result = buildPaginatedResponse([], 10);
    expect(result.data).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });
});
