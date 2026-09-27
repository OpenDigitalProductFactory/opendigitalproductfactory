// Ratified page-purpose contract for the area home, /area/[key] (EP-2FB6C0CC;
// spec 2026-08-14-portfolio-shaped-information-architecture-design.md §9.3).
// The purpose-identity ratchet refuses to grandfather a NEW route, so the area
// home arrives ratified. It replaces the Delivery hub (/delivery), now a redirect.

import type { PurposeContractModule } from ".";

export const AREA_HOME_PURPOSE_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/area/[key]",
    intent: {
      primaryUser:
        "The owner or an operator responsible for one area of the business — serving customers, the team, delivery, or running the platform.",
      triggeringNeed:
        "Seeing what work is going on in the area, who (people and AI coworkers) works there and may act, and where the area's settings live — without knowing which admin page holds them.",
      prerequisites: ["Signed in.", "The area is one of the four portfolio sections of the rail."],
      job: "See the area's Workrooms, its team and their authority, and open the settings its work reads.",
      successOutcome:
        "The reader can name the live work in the area, who looks after it and who signs off, and open the setting they came for in one click.",
      findability: {
        parentArea: "The rail section of the same name",
        entryPoints: ["The rail section heading", "/delivery (redirects here for Improve & deliver)"],
        navigationLayer: "Rail section heading; Work, Team and Setup as section nav",
        discoveryCue: "Each portfolio section heading in the rail is a link.",
        expectedPath: ["/workspace", "/area/[key]"],
      },
      contentRoles: {
        defaultVisibleKeys: ["area-work", "area-nav"],
        deferredRegions: [
          {
            key: "area-team",
            role: "The people and AI coworkers who work in the area and what each may do, from bindings, participants and owner roles.",
            trigger: "Reader opens the Team view.",
          },
          {
            key: "area-setup",
            role: "Links to the one home of each setting the area's work reads.",
            trigger: "Reader opens the Setup view.",
          },
        ],
      },
      familyConsistency: {
        terminology:
          "Speak in activities: work, team, setup, looks after, coordinates, signs off. Never portfolio keys, binding, principal or scope.",
        actionLocation: "Work, Team and Setup sit in one section nav under the area heading; each row links to its canonical record.",
        feedbackPrimitive: "The lead band says in one sentence what the view shows and how much of it is live.",
        disclosurePattern: "One view at a time behind the section nav; Work is open on arrival.",
        returnBehavior: "The rail heading and browser back return to the area home with the same view.",
      },
    },
    stateScenarios: {
      "no-work-in-area": {
        statePredicate: "No Workroom carries this area's portfolio.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/components/ops/workrooms/WorkroomActivitySection.tsx",
        },
        essentialEvidenceKeys: ["area-work", "no-live-rooms"],
        primaryExperience: { kind: "informational", messageKey: "area.no-work" },
        prohibitedActionKeys: ["guess-unplaced-rooms-into-area"],
        completionSignal: "The lead band says no Workrooms in this area are live, and unplaced rooms are not shown as the area's.",
        errorCorrection: "Rooms without a portfolio stay in the full inventory's exception group until they are placed.",
        recovery: { actionKey: "open-work-in-progress", routePath: "/ops/workrooms" },
      },
      "owner-role-unassigned": {
        statePredicate: "A work shape in the area names a role:* owner that no person holds.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/areas/area-team.server.ts",
        },
        essentialEvidenceKeys: ["area-team", "unassigned-role"],
        primaryExperience: { kind: "informational", messageKey: "area.role-unassigned" },
        prohibitedActionKeys: [],
        completionSignal: "The Team view lists the role as not assigned to a person yet, after the coworkers and people.",
        errorCorrection: "The role stays visible until a person is bound to it; nothing is inferred from job titles.",
        recovery: { actionKey: "open-identity", routePath: "/platform/identity/principals" },
      },
    },
    taskProtocol: {
      startRoute: "/area/[key]",
      taskPrompt: "Where do you connect GitHub so the platform can share what it builds?",
      completionOracle: "Setup lists Contributing & GitHub, and opening it shows the contribution decision and GitHub connection.",
      falseSuccessConditions: [
        "The reader lands on an unrelated Admin page and scrolls to find it.",
        "A Setup link opens a page other than the setting's one home.",
      ],
      acceptanceThresholds: [
        "Rail heading to Contributing & GitHub takes at most three operations.",
        "Every Setup link opens a page that exists and the reader may open.",
      ],
    },
    ratifiedBy: { role: "owner", ref: "founder-direction:2026-09-25-workroom-shaped-areas" },
    reviewRef: "BI-A3E4BA47",
    intentEvidenceRefs: [
      {
        kind: "operator-request",
        ref: "EP-2FB6C0CC",
        summary:
          "The founder could not find GitHub setup from the menu and directed that the layout reflect workrooms, with admin and setup aligned to the activities that use them.",
      },
      {
        kind: "existing-behavior",
        ref: "docs/superpowers/specs/2026-08-14-portfolio-shaped-information-architecture-design.md",
        summary: "§9 defines the area template (Work, Team, Setup) over existing Workroom, binding and settings substrate.",
      },
    ],
  },
];
