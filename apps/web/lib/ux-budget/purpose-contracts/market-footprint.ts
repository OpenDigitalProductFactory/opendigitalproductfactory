// Ratified page-purpose contract for /customer/footprint (BI-4EC1D572).
//
// The purpose-identity ratchet refuses to grandfather a NEW route, so the market
// footprint page arrives ratified. Shape mirrors mileage.ts.

import type { PurposeContractModule } from ".";

const SOURCE = "apps/web/app/(shell)/customer/footprint/page.tsx";

export const MARKET_FOOTPRINT_PURPOSE_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/customer/footprint",
    intent: {
      primaryUser:
        "The owner or sales lead of a business that sells beyond one town — first of all a software company deciding where to visit, support and sell.",
      triggeringNeed:
        "Seeing at a glance which countries the business targets, where its customers and deployments actually are, and where its English-only product fits.",
      prerequisites: [
        "Signed in with the view_customer capability.",
        "Business context lists the countries sold to or operated in, and customers have sites with addresses — or the page explains how to add them.",
      ],
      job: "Read the world by country, switching between target markets, customers, deployments and language fit, and pick a country to see its numbers.",
      successOutcome:
        "The owner names the countries that matter, sees how many customers and deployments each has, and sees how many customers could not be placed.",
      findability: {
        parentArea: "Customer",
        entryPoints: ["/customer", "Customer > Footprint"],
        navigationLayer: "Customer area tab nav",
        discoveryCue: "A 'Footprint' tab in the Customer area, beside Funnel and Marketing.",
        expectedPath: ["/customer", "/customer/footprint"],
      },
      contentRoles: {
        defaultVisibleKeys: ["footprint-stats", "world-map", "layer-switch", "country-table"],
        deferredRegions: [],
      },
      familyConsistency: {
        terminology:
          "Plain words — target market, customers, deployments, not placed, English official. Never ISO codes, projections or record ids.",
        actionLocation: "The layer switch sits above the map; selecting a country works from the map or the table row.",
        feedbackPrimitive: "The selected country is outlined on the map, highlighted in the table and summarised in one line.",
        disclosurePattern: "One layer at a time; the table always shows every column.",
        returnBehavior: "Switching layers or selecting a country never navigates away.",
      },
    },
    stateScenarios: {
      "no-data": {
        statePredicate: "No target markets, no customer sites with countries and no deployments.",
        stateSource: { oracleKey: "route-owned-read-model", sourceRef: SOURCE },
        essentialEvidenceKeys: ["footprint-stats"],
        primaryExperience: { kind: "informational", messageKey: "footprint.no-data" },
        prohibitedActionKeys: [],
        completionSignal: "The page says there is nothing to map yet and names what to fill in.",
        errorCorrection: "An empty world is explained as missing data, not shown as a blank map.",
        recovery: { actionKey: "open-customers", routePath: "/customer" },
      },
      "unplaced-customers": {
        statePredicate: "At least one customer account has no site, or no country on its site address.",
        stateSource: { oracleKey: "route-owned-read-model", sourceRef: SOURCE },
        essentialEvidenceKeys: ["footprint-stats", "country-table"],
        primaryExperience: { kind: "informational", messageKey: "footprint.unplaced" },
        prohibitedActionKeys: [],
        completionSignal: "A 'Not placed' figure and table row count the customers the map cannot show.",
        errorCorrection: "Unplaced customers are counted, never silently dropped from the totals.",
        recovery: { actionKey: "open-customers", routePath: "/customer" },
      },
      "footprint-shown": {
        statePredicate: "At least one country has a target market, customer or deployment.",
        stateSource: { oracleKey: "route-owned-read-model", sourceRef: SOURCE },
        essentialEvidenceKeys: ["world-map", "layer-switch", "country-table"],
        primaryExperience: { kind: "informational", messageKey: "footprint.shown" },
        prohibitedActionKeys: [],
        completionSignal: "The map colours the chosen layer and the table lists the same countries with the same numbers.",
        errorCorrection: "Every map state is repeated in the table in words, so colour is never the only signal.",
        recovery: { actionKey: "open-customers", routePath: "/customer" },
      },
    },
    taskProtocol: {
      startRoute: "/customer/footprint",
      taskPrompt: "Which countries do we sell to that have no customers yet, and where are we already deployed?",
      completionOracle:
        "The user names target-market countries with zero customers from the table, and the countries with deployments from the Deployments layer.",
      falseSuccessConditions: [
        "Customers with no address are assumed not to exist because the map cannot show them.",
        "A shaded country on the Customers layer is read as a target market.",
      ],
      acceptanceThresholds: [
        "Switching layers takes one interaction.",
        "The table and the map always show the same countries and numbers.",
        "The 'Not placed' figure is visible whenever it is above zero.",
      ],
    },
    ratifiedBy: { role: "owner", ref: "operator-request:mark-bodman-2026-09-23" },
    reviewRef: "BI-4EC1D572",
    intentEvidenceRefs: [
      {
        kind: "operator-request",
        ref: "EP-SPATIAL-OPERATIONAL-VIEWS",
        summary:
          "The founder asked for a world view of where the English-only platform is deployed and where customers and target markets are, so the business can visit, support and sell to them.",
      },
      {
        kind: "existing-behavior",
        ref: "apps/web/lib/footprint/market-footprint.ts",
        summary:
          "buildMarketFootprint derives every number on this page from existing business context, customer site addresses and active fulfilments; the page adds no store of its own.",
      },
    ],
  },
];
