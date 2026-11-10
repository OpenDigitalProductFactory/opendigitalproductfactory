import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ thread: vi.fn(), find: vi.fn(), create: vi.fn(), attachment: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { agentThread: { findUnique: mocks.thread }, agentMessage: { findUnique: mocks.find, create: mocks.create }, agentAttachment: { update: mocks.attachment } } }));
import { acceptUserMessage } from "./accept-user-message";

describe("foreground HTTP request identity", () => {
  let rows: Map<string, any>;
  const input = { userId: "owner", threadId: "thread", routeContext: "/workspace/mailroom", content: "Prepare a checklist", requestKey: "local-message-1" };
  beforeEach(() => {
    vi.clearAllMocks(); rows = new Map();
    mocks.thread.mockResolvedValue({ userId: "owner" });
    mocks.find.mockImplementation(async ({ where }) => rows.get(where.id) ?? null);
    mocks.create.mockImplementation(async ({ data }) => {
      if (rows.has(data.id)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
      rows.set(data.id, data); return { id: data.id };
    });
  });
  it("retains one message through concurrent duplicate delivery and lost acknowledgement retry", async () => {
    const ids = await Promise.all([acceptUserMessage(input), acceptUserMessage(input)]);
    expect(ids[0]).toBe(ids[1]);
    expect(await acceptUserMessage(input)).toBe(ids[0]);
    expect(rows.size).toBe(1);
  });
  it("refuses reusing the same identity to change the request", async () => {
    await acceptUserMessage(input);
    await expect(acceptUserMessage({ ...input, content: "Do something else" })).rejects.toMatchObject({ status: 409 });
    expect(rows.size).toBe(1);
  });
  it("does not return a retained message after conversation ownership changes", async () => {
    await acceptUserMessage(input);
    mocks.thread.mockResolvedValue({ userId: "different-owner" });
    await expect(acceptUserMessage(input)).rejects.toMatchObject({ status: 404 });
  });
  it("rejects malformed request keys before any record is read or written", async () => {
    await expect(acceptUserMessage({ ...input, requestKey: "x".repeat(129) })).rejects.toMatchObject({ status: 400 });
    expect(mocks.thread).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
