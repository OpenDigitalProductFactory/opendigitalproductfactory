import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DirectoryAuthoritiesPanel } from "./DirectoryAuthoritiesPanel";

describe("DirectoryAuthoritiesPanel", () => {
  it("renders the projected directory branches and publication posture", () => {
    const html = renderToStaticMarkup(
      <DirectoryAuthoritiesPanel
        baseDn="dc=dpf,dc=internal"
        branches={[
          { dn: "ou=people,dc=dpf,dc=internal", label: "People", entryCount: 12, description: "Employees and contractors" },
          { dn: "ou=agents,dc=dpf,dc=internal", label: "Agents", entryCount: 5, description: "AI coworkers with explicit principal type" },
          { dn: "ou=groups,dc=dpf,dc=internal", label: "Groups", entryCount: 8, description: "Role groups and business groups" },
        ]}
        publicationStatus={{
          authorityCount: 2,
          aliasCount: 27,
          readOnlyConsumers: true,
          primaryAuthorityLabel: "DPF remains authoritative",
          upstreamSummary: "Microsoft Entra connected; LDAP/AD optional",
        }}
      />,
    );

    expect(html).toContain("Directory");
    expect(html).toContain("dc=dpf,dc=internal");
    expect(html).toContain("ou=people,dc=dpf,dc=internal");
    expect(html).toContain("ou=agents,dc=dpf,dc=internal");
    expect(html).toContain("ou=groups,dc=dpf,dc=internal");
    expect(html).toContain("Read-only");
    expect(html).toContain("DPF remains authoritative");
  });
});
