import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeldWorkroomsList } from "./HeldWorkroomsList";
import type { HeldWorkroomRow } from "@/lib/work-management/held-workrooms";
describe("shared recovery issues", () => {
  it("groups the same recorded problem while retaining every case link and owner", () => {
    const rows: HeldWorkroomRow[] = ["one", "two"].map(capsuleId => ({ capsuleId,
      title: `Review ${capsuleId}`, action: "pause", reason: "executor_writeback_unavailable",
      deviationCodes: [], stageKey: capsuleId, since: null, stuckTicks: 4, notifiedAt: null, accountableName: "Dana" }));
    const html = renderToStaticMarkup(<HeldWorkroomsList rows={rows} nowIso="2026-10-13T18:00:00Z" />);
    expect(html.match(/<summary/g)).toHaveLength(1);
    expect(html).toContain("Stage results were not recorded");
    expect(html).toContain("2 rooms");
    for (const id of ["one", "two"]) expect(html).toContain(`/workspace/cases/work-capsule%3A${id}`);
    expect(html).toContain("Dana");
    expect(html).not.toContain("Owner told");
    expect(html).toContain("Changing its owner alone will not restore the result");
  });
});
