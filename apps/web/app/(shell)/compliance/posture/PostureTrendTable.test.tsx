import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PostureTrendTable, type PostureSnapshotRow } from "./PostureTrendTable";
import { scoreIntent } from "./posture-score";

const ROWS: PostureSnapshotRow[] = [
  {
    snapshotId: "snap-1",
    takenAtISO: "2026-03-28T14:30:00.000Z",
    overallScore: 92,
    coveredObligations: 18,
    totalObligations: 20,
    implementedControls: 9,
    totalControls: 10,
    openIncidents: 0,
    overdueActions: 1,
    triggeredBy: "manual",
  },
  {
    snapshotId: "snap-2",
    takenAtISO: "2026-02-28T14:30:00.000Z",
    overallScore: 55,
    coveredObligations: 8,
    totalObligations: 20,
    implementedControls: 4,
    totalControls: 10,
    openIncidents: 3,
    overdueActions: 5,
    triggeredBy: "scheduled",
  },
];

describe("posture scoreIntent", () => {
  it("maps score bands to intents", () => {
    expect(scoreIntent(92)).toBe("success");
    expect(scoreIntent(65)).toBe("warning");
    expect(scoreIntent(40)).toBe("danger");
  });
});

describe("PostureTrendTable (report-kit migration)", () => {
  const html = renderToStaticMarkup(<PostureTrendTable rows={ROWS} />);

  it("renders snapshot rows", () => {
    expect(html).toContain("manual");
    expect(html).toContain("scheduled");
    expect(html).toContain("18/20");
  });

  it("colors the score via token-backed StatusBadge (no raw hex)", () => {
    expect(html).toContain('data-intent="success"'); // 92
    expect(html).toContain('data-intent="danger"'); // 55
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(html).not.toMatch(/(text|bg)-(green|yellow|red)-[0-9]/);
  });
});
