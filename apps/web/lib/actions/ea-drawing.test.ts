// EA view drawing export action (BI-4C17BF51).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
vi.mock("@/lib/ea/view-drawing-export", () => ({
  EA_DRAWING_FORMATS: ["odg", "svg", "pdf", "png"],
  exportEaViewDrawingFile: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { exportEaViewDrawingFile } from "@/lib/ea/view-drawing-export";
import { exportEaViewDrawing } from "./ea-drawing";

const mockAuth = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;
const mockCan = vi.mocked(can);
const mockExport = vi.mocked(exportEaViewDrawingFile);

describe("exportEaViewDrawing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", platformRole: "HR-300", isSuperuser: false } });
    mockCan.mockReturnValue(true);
  });

  it("refuses a user who cannot view EA views, without rendering", async () => {
    mockCan.mockReturnValue(false);
    expect(await exportEaViewDrawing({ viewId: "v1", format: "odg" })).toEqual({ ok: false, error: "You do not have access to EA views." });
    expect(mockCan).toHaveBeenCalledWith({ platformRole: "HR-300", isSuperuser: false }, "view_ea_modeler");
    expect(mockExport).not.toHaveBeenCalled();
  });

  it("refuses a format the export does not offer", async () => {
    const result = await exportEaViewDrawing({ viewId: "v1", format: "vsdx" as never });
    expect(result).toEqual({ ok: false, error: "Unsupported export format: vsdx" });
    expect(mockExport).not.toHaveBeenCalled();
  });

  it("returns the rendered file as base64 for the browser to download", async () => {
    mockExport.mockResolvedValue({ ok: true, data: { fileName: "View.svg", mimeType: "image/svg+xml", bytes: Buffer.from("<svg/>") } });
    expect(await exportEaViewDrawing({ viewId: "v1", format: "svg" })).toEqual({
      ok: true,
      data: { fileName: "View.svg", mimeType: "image/svg+xml", base64: Buffer.from("<svg/>").toString("base64") },
    });
    expect(mockExport).toHaveBeenCalledWith({ viewId: "v1", format: "svg" });
  });

  it("passes an export failure through", async () => {
    mockExport.mockResolvedValue({ ok: false, error: "The drawing could not be rendered: timeout" });
    expect(await exportEaViewDrawing({ viewId: "v1", format: "pdf" })).toEqual({ ok: false, error: "The drawing could not be rendered: timeout" });
  });
});
