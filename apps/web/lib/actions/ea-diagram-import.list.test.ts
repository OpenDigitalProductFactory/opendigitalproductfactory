// Import dialog read action (BI-4C17BF51).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
vi.mock("@/lib/ea/diagram-import/import-diagram", () => ({
  MAX_DIAGRAM_IMPORT_BYTES: 16,
  MAX_DIAGRAM_IMPORT_LABEL: "16 bytes",
  importDiagramFile: vi.fn(),
}));
vi.mock("@/lib/ea/diagram-import/load-imports", () => ({ loadDiagramImports: vi.fn() }));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { loadDiagramImports } from "@/lib/ea/diagram-import/load-imports";
import { listEaDiagramImports } from "./ea-diagram-import";

const mockAuth = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;
const mockCan = vi.mocked(can);

describe("listEaDiagramImports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", platformRole: "HR-300", isSuperuser: false } });
  });

  it("refuses a user who cannot view EA views", async () => {
    mockCan.mockReturnValue(false);
    expect(await listEaDiagramImports()).toEqual({ ok: false, error: "You do not have access to EA views." });
    expect(loadDiagramImports).not.toHaveBeenCalled();
  });

  it("returns the imports with dates serialized, and whether the user may review them", async () => {
    mockCan.mockImplementation((_role, capability) => capability === "view_ea_modeler");
    vi.mocked(loadDiagramImports).mockResolvedValue([
      { id: "imp-1", fileName: "a.vsdx", importedAt: new Date("2026-09-25T10:00:00Z"), previewDataUri: null, unattachedConnectors: 0, truncated: false, elements: [], relationships: [] },
    ]);
    expect(await listEaDiagramImports()).toEqual({
      ok: true,
      data: {
        canManage: false,
        imports: [{ id: "imp-1", fileName: "a.vsdx", importedAt: "2026-09-25T10:00:00.000Z", previewDataUri: null, unattachedConnectors: 0, truncated: false, elements: [], relationships: [] }],
      },
    });
  });
});
