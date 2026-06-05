import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ChangeLaneStatusBadge } from "./ChangeLaneStatusBadge";
import { CONTRIBUTOR_LANE_STATUSES } from "@/lib/contributor-change-lanes/types";

describe("ChangeLaneStatusBadge (report-kit wrapper)", () => {
  it("renders every lane status with a resolved intent and its label", () => {
    for (const status of CONTRIBUTOR_LANE_STATUSES) {
      const html = renderToStaticMarkup(<ChangeLaneStatusBadge status={status} />);
      expect(html).toMatch(/data-intent="(success|warning|danger|info|neutral|accent)"/);
      expect(html).toContain(status);
      // token-backed, never raw hex
      expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
  });

  it("maps key statuses to the expected intents", () => {
    expect(renderToStaticMarkup(<ChangeLaneStatusBadge status="blocked" />)).toContain('data-intent="danger"');
    expect(renderToStaticMarkup(<ChangeLaneStatusBadge status="ready-for-review" />)).toContain('data-intent="success"');
    expect(renderToStaticMarkup(<ChangeLaneStatusBadge status="running" />)).toContain('data-intent="accent"');
    expect(renderToStaticMarkup(<ChangeLaneStatusBadge status="available" />)).toContain('data-intent="neutral"');
  });
});
