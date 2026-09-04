import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DirectoryAuthoritiesPanel } from "./DirectoryAuthoritiesPanel";

const branches = [
  { dn: "ou=people,dc=dpf,dc=internal", label: "People", entryCount: 12, description: "Employees and contractors" },
  { dn: "ou=agents,dc=dpf,dc=internal", label: "Agents", entryCount: 5, description: "AI coworkers with explicit principal type" },
  { dn: "ou=groups,dc=dpf,dc=internal", label: "Groups", entryCount: 8, description: "Role groups and business groups" },
];

const publicationStatus = {
  authorityCount: 2,
  aliasCount: 27,
  readOnlyConsumers: true,
  primaryAuthorityLabel: "DPF remains authoritative",
  upstreamSummary: "Microsoft Entra connected; LDAP/AD optional",
};

function render(listener: Parameters<typeof DirectoryAuthoritiesPanel>[0]["listener"]) {
  return renderToStaticMarkup(
    <DirectoryAuthoritiesPanel
      baseDn="dc=dpf,dc=internal"
      branches={branches}
      publicationStatus={publicationStatus}
      listener={listener}
    />,
  );
}

describe("DirectoryAuthoritiesPanel", () => {
  it("renders the projected directory branches and publication posture", () => {
    const html = render({ state: "disabled", detail: "Not served." });

    expect(html).toContain("Directory");
    expect(html).toContain("dc=dpf,dc=internal");
    expect(html).toContain("ou=people,dc=dpf,dc=internal");
    expect(html).toContain("ou=agents,dc=dpf,dc=internal");
    expect(html).toContain("ou=groups,dc=dpf,dc=internal");
    expect(html).toContain("Read-only");
    expect(html).toContain("DPF remains authoritative");
  });

  // EP-24741BBF · BI-A91004A7 — the three listener states must READ differently.
  // The defect this replaces was a directory that was absent and looked no
  // different from one that was never asked for.
  it("says plainly when the directory is not served", () => {
    const html = render({ state: "disabled", detail: "Set DPF_LDAP_ENABLED=1 to turn it on." });

    expect(html).toContain("Not served");
    expect(html).toContain("Set DPF_LDAP_ENABLED=1 to turn it on.");
  });

  it("names the port a client can bind to when it is serving", () => {
    const html = render({ state: "listening", port: 636, detail: "Serving LDAPS." });

    expect(html).toContain("Serving LDAPS");
    expect(html).toContain("port 636");
  });

  it("shows a started-and-failed listener as a failure, not as off", () => {
    const html = render({
      state: "refused",
      reason: "refusing to start without organization PKI material",
      detail: "DPF_LDAP_ENABLED is set but nothing is bound.",
    });

    expect(html).toContain("Failed to start");
    expect(html).toContain("refusing to start without organization PKI material");
    expect(html).not.toContain("Not served");
  });
});
