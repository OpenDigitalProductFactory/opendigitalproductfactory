import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
const state = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: state.auth }));
vi.mock("@/lib/work-management/workspace-case-detail.server", () => ({ loadAuthorizedWorkroomProcess: state.load }));
const user = { id: "current-user" };
function read(query = "workroomRowId=selected-row", key = "task%3ATR-1") {
  return GET(new Request(`http://localhost/api/workspace/cases/${key}/projection?${query}`), { params: Promise.resolve({ caseKey: key }) });
}
beforeEach(() => { vi.clearAllMocks(); state.auth.mockResolvedValue({ user }); state.load.mockResolvedValue({ status: "ok", snapshot: { version: 1 } }); });
describe("manual Workroom projection HTTP boundary", () => {
  it("returns 401 JSON rather than a login document redirect", async () => {
    state.auth.mockResolvedValue(null); const response = await read(); expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull(); expect(state.load).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it.each(["", "workroomRowId=", "workroomRowId=a&workroomRowId=b", "workroomRowId=a&workroom=", "workroomRowId=a&workroom=x&workroom=y"])("rejects ambiguous/empty target query %s", async query => {
    expect((await read(query)).status).toBe(400); expect(state.load).not.toHaveBeenCalled();
  });
  it("rejects malformed percent identity", async () => { expect((await read("workroomRowId=a", "%")).status).toBe(400); expect(state.load).not.toHaveBeenCalled(); });
  it("binds a successful response to the authenticated user and explicit selection", async () => {
    const response = await read("workroomRowId=row&workroom=WC-SELECTED");
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ version: 1 });
    expect(state.load).toHaveBeenCalledWith({ caseKey: "task%3ATR-1", workroomRowId: "row", selectedWorkroomId: "WC-SELECTED", user });
    expect(response.headers.get("vary")).toBe("Cookie");
  });
  it.each([["not-found", 404], ["changed", 409]] as const)("maps %s without disclosing protected content", async (status, expected) => {
    state.load.mockResolvedValue({ status }); const response = await read(); expect(response.status).toBe(expected);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("sanitizes infrastructure failures", async () => {
    state.load.mockRejectedValue(new Error("secret provider response")); const response = await read();
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: "read-unavailable" });
  });
});
