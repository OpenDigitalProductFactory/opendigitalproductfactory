import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReferenceProposalQueue } from "./ReferenceProposalQueue";

describe("ReferenceProposalQueue", () => {
  it("renders proposal rows", () => {
    const html = renderToStaticMarkup(
      <ReferenceProposalQueue
        proposals={[
          {
            id: "p1",
            proposalType: "guidance",
            status: "proposed",
            proposedByType: "agent",
            reviewNotes: null,
          },
        ]}
      />
    );

    expect(html).toContain("guidance");
    expect(html).toContain("proposed");
    expect(html).toContain("agent");
  });
});
