import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeldWorkroomsList } from "./HeldWorkroomsList";
import type { HeldWorkroomRow } from "@/lib/work-management/held-workrooms";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { namespaceMessages } from "@dpf/i18n";

const renderHeld = (rows: HeldWorkroomRow[]) => renderToStaticMarkup(<MessagesProvider locale="en-US"
  messages={{ workrooms: namespaceMessages("en-US", "workrooms") }}><HeldWorkroomsList rows={rows} nowIso="2026-10-31T20:00:00Z" /></MessagesProvider>);
describe("shared recovery issues", () => {
  it("shows the recorded executor's concrete next step in the closed group header", () => {
    const rows: HeldWorkroomRow[] = ["A", "B"].map(capsuleId => ({ capsuleId, title: capsuleId,
      action: "pause", reason: "executor_writeback_unavailable", deviationCodes: [], stageKey: "check", since: null,
      stuckTicks: 2, notifiedAt: null, accountableName: "Dana", nextAction: {
        actor: "inventory.actor.executor", instruction: "inventory.action.recordResult", decisionRecorded: false,
      } }));
    const html = renderHeld(rows);
    const header = html.slice(0, html.indexOf("</summary>"));
    expect(header).toContain("Assigned coworker");
    expect(header).toContain("Record the missing result");
    expect(header).not.toContain("Accountable: Dana");
    expect(html).toContain("Dana");
  });
  it("does not borrow a first-room remedy for a heterogeneous recovery group", () => {
    const rows: HeldWorkroomRow[] = ["Record the missing test result", "Confirm the original review outcome"].map((recoveryCondition, i) => ({
      capsuleId: `WC-DIFFERENT-${i}`, title: `Held work ${i}`, action: "pause", reason: "conformance_pause", deviationCodes: [],
      stageKey: "check", since: null, stuckTicks: 2, notifiedAt: null, accountableName: "Dana", recoveryCondition,
    }));
    const html = renderHeld(rows);
    expect(html).toContain("Record the missing test result");
    expect(html).toContain("Confirm the original review outcome");
    expect(html).not.toContain("Recovery condition: Record the missing test result");
  });
  it("groups the same recorded problem while retaining every case link and owner", () => {
    const rows: HeldWorkroomRow[] = ["one", "two"].map(capsuleId => ({ capsuleId,
      title: `Review ${capsuleId}`, action: "pause", reason: "executor_writeback_unavailable",
      deviationCodes: [], stageKey: capsuleId, since: null, stuckTicks: 4, notifiedAt: null, accountableName: "Dana" }));
    const html = renderHeld(rows);
    expect(html.match(/Stage results were not recorded/g)).toHaveLength(1);
    expect(html).toContain("Stage results were not recorded");
    expect(html).toContain("2 rooms");
    for (const id of ["one", "two"]) expect(html).toContain(`/workspace/cases/work-capsule%3A${id}`);
    expect(html).toContain("Dana");
    expect(html).not.toContain("Owner told");
    expect(html).toContain("Changing its owner alone will not restore the result");
  });
});
