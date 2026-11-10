import { describe, expect, it, vi } from "vitest";
import { createTaskArtifact } from "./task-records";
vi.mock("@dpf/db", () => ({ prisma: {} }));

function store() {
  const rows = new Map<string, any>();
  return {
    taskRun: { findUnique: vi.fn().mockResolvedValue({ id: "internal-run", contextId: null }) },
    taskArtifact: { upsert: vi.fn(async ({ where, create }: any) => {
      if (!rows.has(where.artifactId)) rows.set(where.artifactId, create);
      return rows.get(where.artifactId);
    }) },
  };
}
const input = { taskRunId: "TR-public", artifactId: "ta-stable", artifactType: "review", name: "Frozen review", content: { count: 2 } };
describe("immutable task artifacts", () => {
  it("joins concurrent identical publication in the supplied transaction", async () => {
    const db = store();
    const [a, b] = await Promise.all([createTaskArtifact(input, db as never), createTaskArtifact(input, db as never)]);
    expect(a).toEqual(b);
    expect(db.taskRun.findUnique).toHaveBeenCalled();
    expect(db.taskArtifact.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { artifactId: "ta-stable" }, where: { artifactId: "ta-stable" } }));
  });
  it("refuses changed content under a published identity", async () => {
    const db = store();
    await createTaskArtifact(input, db as never);
    await expect(createTaskArtifact({ ...input, content: { count: 3 } }, db as never)).rejects.toThrow(/conflict/i);
  });
  it("refuses an identity from another task or producer", async () => {
    const db = store();
    await createTaskArtifact(input, db as never);
    db.taskRun.findUnique.mockResolvedValue({ id: "other-run", contextId: null });
    await expect(createTaskArtifact(input, db as never)).rejects.toThrow(/conflict/i);
  });
});
