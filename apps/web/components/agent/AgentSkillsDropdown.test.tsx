import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentSkillsDropdown } from "./AgentSkillsDropdown";

const adminUser = { userId: "u-1", platformRole: "HR-000", isSuperuser: false };

describe("AgentSkillsDropdown", () => {
  it("renders without being open by default", () => {
    const html = renderToStaticMarkup(
      <AgentSkillsDropdown
        skills={[{ label: "Test", description: "A test skill", capability: null, prompt: "test" }]}
        userSkills={[]}
        userContext={adminUser}
        onSend={() => {}}
        onCreateSkill={() => {}}
      />,
    );
    expect(html).toContain("Skills");
    // Dropdown items should NOT be in the initial render (isOpen=false)
    expect(html).not.toContain("Test");
  });

  it("renders trigger button even with no skills", () => {
    const html = renderToStaticMarkup(
      <AgentSkillsDropdown
        skills={[]}
        userSkills={[]}
        userContext={adminUser}
        onSend={() => {}}
        onCreateSkill={() => {}}
      />,
    );
    expect(html).toContain("Skills");
  });
});
