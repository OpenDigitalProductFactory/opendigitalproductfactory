// Ratified purpose contract for the customer-owned WordPress channel.
// BI-8D98C5E6 / DI-BC2255C06EC5: one provider page in Platform Integrations;
// contextual publishing stays in the existing Customer Marketing queue.

import type { PurposeContractModule } from ".";

export const WORDPRESS_PURPOSE_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/platform/tools/integrations/wordpress",
    intent: {
      primaryUser: "A founder or platform operator connecting an existing customer-owned WordPress site.",
      triggeringNeed: "Use approved DPF business content on the public WordPress site without exposing DPF publicly or turning DPF into a hosting service.",
      prerequisites: [
        "Signed in with manage_provider_connections authority.",
        "A customer-owned HTTPS WordPress site is available.",
        "A dedicated WordPress user and Application Password can be created.",
      ],
      job: "Connect, verify, and supervise the WordPress channel, then understand exactly what DPF and WordPress each own.",
      successOutcome: "The operator sees the expected site identity and capabilities, can recover a failed connection, and can reach the existing approved-content queue without seeing or reusing a stored secret.",
      findability: {
        parentArea: "Platform > Tools > Native Integrations",
        entryPoints: [
          "/platform/tools/integrations",
          "Platform > Tools > Native Integrations > WordPress (self-hosted)",
        ],
        navigationLayer: "Existing integrations catalog card",
        discoveryCue: "A WordPress (self-hosted) card labelled Customer-owned website and External channel.",
        expectedPath: [
          "/platform/tools/integrations",
          "/platform/tools/integrations/wordpress",
        ],
      },
      contentRoles: {
        defaultVisibleKeys: [
          "site-identity-and-health",
          "capability-and-authority-boundary",
          "single-health-or-connect-action",
          "content-activity-summary",
        ],
        deferredRegions: [
          {
            key: "connection-settings-and-policy",
            role: "Credential replacement, public-capable policy, unsupported type evidence, and disconnect recovery.",
            trigger: "Operator opens the advanced connection disclosure.",
          },
          {
            key: "recent-projections-and-receipts",
            role: "Bounded diagnostic detail for drift and publication audit.",
            trigger: "Operator opens recent activity details.",
          },
        ],
      },
      familyConsistency: {
        terminology: "Customer-owned WordPress site, connection, approved content, draft, projection, drift, and receipt; never hosting or full-CMS parity.",
        actionLocation: "Connect or Check connection is the one lead action; publication stays in Customer Marketing.",
        feedbackPrimitive: "Shared FormStatus, Notice, StatusBadge, and confirmation dialog primitives.",
        disclosurePattern: "Identity and authority are visible first; credentials, public policy, unsupported types, disconnect, and receipts are progressive disclosures.",
        returnBehavior: "Connection actions refresh in place; publication links return to the existing Customer Marketing queue or open the customer-owned WordPress target.",
      },
    },
    stateScenarios: {
      unconfigured: {
        statePredicate: "No wordpress-self-hosted IntegrationCredential exists.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/integrations/kernel/credential-store.ts#readSetupState",
        },
        essentialEvidenceKeys: ["three-field-connection-form", "outbound-only-network-boundary"],
        primaryExperience: { kind: "command", actionKey: "check-connection" },
        prohibitedActionKeys: ["publish-content", "display-stored-secret"],
        completionSignal: "The connected state shows the expected WordPress site name, hostname, and effective capabilities.",
        errorCorrection: "A safe field or connection error explains whether the URL, identity, credential, REST API, or permission needs correction.",
        recovery: { actionKey: "correct-and-recheck", routePath: "/platform/tools/integrations/wordpress" },
      },
      connected: {
        statePredicate: "The canonical connector setup state is connected.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/integrations/kernel/credential-store.ts#readSetupState",
        },
        essentialEvidenceKeys: ["site-identity-and-health", "capabilities", "authority-boundary", "projection-summary"],
        primaryExperience: { kind: "command", actionKey: "check-connection" },
        prohibitedActionKeys: ["display-stored-secret", "claim-dpf-hosting", "publish-without-item-confirmation"],
        completionSignal: "Health is current, capabilities match the dedicated WordPress user, and the operator can open Customer Marketing for approved publication.",
        errorCorrection: "Drift and uncertain remote outcomes are named and direct the operator to inspect WordPress before any retry.",
        recovery: { actionKey: "open-customer-marketing", routePath: "/customer/marketing" },
      },
      degraded: {
        statePredicate: "The latest health probe failed or at least one projection is drifted or ambiguous.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/app/(shell)/platform/tools/integrations/wordpress/page.tsx",
        },
        essentialEvidenceKeys: ["safe-error", "last-check", "attention-count", "recovery-guidance"],
        primaryExperience: { kind: "command", actionKey: "check-connection-or-review-target" },
        prohibitedActionKeys: ["blind-retry", "create-duplicate", "display-stored-secret"],
        completionSignal: "The operator can distinguish connection failure from content drift and choose the matching recovery path.",
        errorCorrection: "The page preserves safe site identity and states that ambiguous writes must be reviewed before retry.",
        recovery: { actionKey: "recheck-or-review", routePath: "/platform/tools/integrations/wordpress" },
      },
    },
    taskProtocol: {
      startRoute: "/platform/tools/integrations/wordpress",
      taskPrompt: "Connect the rescue's existing WordPress site, verify draft capability, and find where an approved adoption post is created.",
      completionOracle: "The operator identifies the connected site and draft capability, then navigates to the Customer Marketing Ready to publish queue without exposing a credential.",
      falseSuccessConditions: [
        "A site URL is saved without a successful authenticated capability probe.",
        "The operator believes DPF now hosts the public site or supplies its CDN.",
        "Approval alone is mistaken for an external WordPress write.",
      ],
      acceptanceThresholds: [
        "Exactly one lead action is visible in the first viewport.",
        "No Application Password is redisplayed after submission.",
        "The DPF/WordPress ownership boundary is legible without opening diagnostics.",
        "A failed or drifted state provides one honest recovery path and prevents blind duplicate-prone retry.",
      ],
    },
    consequentialAction: {
      noActionConsequence: "Disconnect stops new reads and publications; enabling public capability can make separately authorized content visible to website visitors.",
      reversibility: "Connection policy can return to draft-only and DPF can disconnect; existing WordPress content remains under WordPress control.",
      confirmation: "Disconnect uses an explicit danger confirmation; public capability requires consequence acknowledgement and every external item still requires separate confirmation.",
      authority: "Only manage_provider_connections may change connection state; DPF approval and item authority govern publication.",
      recovery: "Rotate or revoke the Application Password in WordPress, reconnect in DPF, and inspect projection receipts before retrying uncertain writes.",
    },
    ratifiedBy: { role: "owner", ref: "operator-request:mark-bodman-2026-08-22" },
    reviewRef: "BI-8D98C5E6",
    intentEvidenceRefs: [
      {
        kind: "operator-request",
        ref: "BI-8D98C5E6",
        summary: "The founder requested deep WordPress analysis and delivery for an internal company system, explicitly excluding immediate public URL, network, and CDN responsibilities.",
      },
      {
        kind: "governance-decision",
        ref: "DI-BC2255C06EC5",
        summary: "The platform kernel selected DPF-canonical channel projection rather than a parallel CMS authority or bundled WordPress runtime.",
      },
      {
        kind: "design-review",
        ref: "docs/superpowers/specs/2026-08-21-wordpress-channel-projection-design.md",
        summary: "The reviewed design allocates internal content, approval, projection, and audit to DPF and public presentation and delivery to WordPress.",
      },
    ],
  },
];
