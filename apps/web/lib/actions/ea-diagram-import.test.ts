// Diagram import action (BI-4C17BF51).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
vi.mock("@/lib/ea/diagram-import/import-diagram", () => ({
  MAX_DIAGRAM_IMPORT_BYTES: 16,
  MAX_DIAGRAM_IMPORT_LABEL: "16 bytes",
  importDiagramFile: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { importDiagramFile } from "@/lib/ea/diagram-import/import-diagram";
import { importEaDiagram } from "./ea-diagram-import";

const mockAuth = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;
const mockCan = vi.mocked(can);
const mockImport = vi.mocked(importDiagramFile);

function form(file?: File): FormData {
  const data = new FormData();
  if (file) data.set("file", file);
  return data;
}

describe("importEaDiagram", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", platformRole: "HR-300", isSuperuser: false } });
    mockCan.mockReturnValue(true);
  });

  it("refuses a user who cannot edit the EA model", async () => {
    mockCan.mockReturnValue(false);
    expect(await importEaDiagram(form(new File(["x"], "a.vsdx")))).toEqual({ ok: false, error: "You do not have permission to import diagrams." });
    expect(mockCan).toHaveBeenCalledWith({ platformRole: "HR-300", isSuperuser: false }, "manage_ea_model");
    expect(mockImport).not.toHaveBeenCalled();
  });

  it("refuses a missing or oversized file before reading it", async () => {
    expect((await importEaDiagram(form())).ok).toBe(false);
    expect(await importEaDiagram(form(new File(["x".repeat(17)], "a.vsdx")))).toEqual({ ok: false, error: "The file is larger than 16 bytes." });
    expect(mockImport).not.toHaveBeenCalled();
  });

  it("stages the file as the signed-in user and refreshes the views page", async () => {
    mockImport.mockResolvedValue({ ok: true, data: { importId: "imp-1" } as never });
    const result = await importEaDiagram(form(new File(["visio"], "Order platform.vsdx")));
    expect(result.ok).toBe(true);
    expect(mockImport).toHaveBeenCalledWith({ fileName: "Order platform.vsdx", bytes: Buffer.from("visio"), userId: "u1" });
    expect(revalidatePath).toHaveBeenCalledWith("/ea/views");
  });
});
