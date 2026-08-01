import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkItemCommentBox } from "./WorkItemCommentBox";

describe("WorkItemCommentBox", () => {
  it("presents commenting as room activity with accessible status feedback", () => {
    const html = renderToStaticMarkup(
      <WorkItemCommentBox
        workItemId="wi-cuid-1"
        caseKey="booking%3ABK-1"
      />,
    );

    expect(html).toContain("Share an update");
    expect(html).toContain("Add context or @mention a participant.");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("min-h-11");
    expect(html).toContain(">Post<");
    expect(html).not.toContain("window.confirm");
  });
});
