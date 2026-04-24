import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ApplicationAssignmentsPanel } from "./ApplicationAssignmentsPanel";

describe("ApplicationAssignmentsPanel", () => {
  it("renders protocol readiness and downstream contract guidance", () => {
    const html = renderToStaticMarkup(
      <ApplicationAssignmentsPanel
        protocolProfiles={[
          {
            protocol: "oidc",
            label: "OIDC",
            readiness: "ready",
            description: "Use for modern relying parties and external products.",
            contractFields: ["claims", "groups", "manager-aware scope"],
          },
          {
            protocol: "saml",
            label: "SAML",
            readiness: "planned",
            description: "Use for legacy enterprise apps that still depend on SAML assertions.",
            contractFields: ["claims", "groups"],
          },
          {
            protocol: "ldap-only",
            label: "LDAP-only",
            readiness: "ready",
            description: "Use for directory-bound consumers that need bind or group lookups.",
            contractFields: ["groups", "directory projection"],
          },
        ]}
        publicationMetrics={{
          authorityCount: 2,
          aliasCount: 27,
          roleAssignmentCount: 6,
          businessGroupCount: 4,
          provisioningSummary: "Manual today, SCIM-ready next",
          connectionSummary: "entra connected; ldap connected",
        }}
      />,
    );

    expect(html).toContain("Applications");
    expect(html).toContain("OIDC");
    expect(html).toContain("SAML");
    expect(html).toContain("LDAP-only");
    expect(html).toContain("Manual today, SCIM-ready next");
    expect(html).toContain("entra connected; ldap connected");
    expect(html).toContain("claims");
    expect(html).toContain("groups");
  });
});
