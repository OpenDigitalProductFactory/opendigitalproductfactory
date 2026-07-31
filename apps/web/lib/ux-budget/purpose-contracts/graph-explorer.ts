// Ratified page-purpose contract for /admin/graph-explorer (BI-89A149A9).
//
// The purpose-identity ratchet grandfathers pre-existing draft routes but refuses
// to grandfather a NEW one, so a route added after the ratchet landed must arrive
// ratified. This is the first contract module in the registry; the shape below is
// the reference for the ones that follow.

import type { PurposeContractModule } from ".";

export const GRAPH_EXPLORER_PURPOSE_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/admin/graph-explorer",
    intent: {
      primaryUser:
        "A platform operator or architect who wants to see how the platform is wired together.",
      triggeringNeed:
        "Understanding or demonstrating the breadth of what the platform knows about itself — source code, data model, architecture, and infrastructure — which was only possible through the Neo4j browser before BET-5 retired it.",
      prerequisites: [
        "Signed in with the view_admin capability.",
        "The graph mirror has been populated by the code-graph indexer and the EA/discovery sync.",
      ],
      job: "Find a starting point in the corpus and follow its relationships outward to see what it connects to.",
      successOutcome:
        "The operator can name a thing (a file, a data model, a route, a tool, an EA element), see its neighbourhood drawn, and read its properties and degree.",
      findability: {
        parentArea: "Admin",
        entryPoints: ["/admin", "Admin > Advanced > Graph Explorer"],
        navigationLayer: "Admin secondary nav, Advanced family",
        discoveryCue:
          "A 'Graph Explorer' item in the Advanced family, alongside Platform Development.",
        expectedPath: ["/admin", "/admin/graph-explorer"],
      },
      contentRoles: {
        defaultVisibleKeys: [
          "corpus-census",
          "domain-filter",
          "search-field",
          "hop-depth",
          "graph-canvas",
          "node-inspector",
        ],
        deferredRegions: [
          {
            key: "advanced-filters",
            role: "Per-label and per-relationship-type facets with live counts.",
            trigger: "Operator activates 'Advanced filters'.",
          },
          {
            key: "node-properties",
            role: "Raw property map for one node.",
            trigger: "Operator clicks a node on the canvas.",
          },
        ],
      },
      familyConsistency: {
        terminology:
          "Operator-facing names throughout — 'Source file', 'Data model', 'Route' — never the raw storage labels stored in graph_node.labels.",
        actionLocation:
          "Search and depth controls sit above the canvas; per-node actions sit in the right-hand inspector.",
        feedbackPrimitive:
          "Inline text status (searching, loading, clipped-view notice) — no native dialogs.",
        disclosurePattern:
          "Four choices by default (domain, search, hops, expand); the 12 node labels and 15 relationship types stay behind 'Advanced filters'.",
        returnBehavior:
          "Reset returns the surface to the census-only state without leaving the route.",
      },
    },
    stateScenarios: {
      "empty-corpus": {
        statePredicate: "The graph mirror has no rows.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/graph/explorer-queries.ts#getGraphCensus",
        },
        essentialEvidenceKeys: ["corpus-census"],
        primaryExperience: {
          kind: "informational",
          messageKey: "graph-explorer.empty-corpus",
        },
        prohibitedActionKeys: ["expand-from-here"],
        completionSignal: "The census reads zero nodes and zero relationships.",
        errorCorrection:
          "The operator runs the code-graph indexer or discovery sync to populate the mirror.",
        recovery: {
          actionKey: "open-platform-development",
          routePath: "/admin/platform-development",
        },
      },
      "no-starting-point": {
        statePredicate: "The corpus is populated but the operator has not chosen a seed node.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/graph/explorer-queries.ts#getGraphCensus",
        },
        essentialEvidenceKeys: ["corpus-census", "search-field"],
        primaryExperience: {
          kind: "command",
          actionKey: "search-graph",
        },
        prohibitedActionKeys: ["expand-from-here"],
        completionSignal: "Search results list at least one candidate starting point.",
        errorCorrection:
          "An unmatched query explains that nothing matched and suggests a shorter fragment or clearing the domain filter.",
        recovery: {
          actionKey: "reset-explorer",
          routePath: "/admin/graph-explorer",
        },
      },
      "neighbourhood-drawn": {
        statePredicate: "A seed node is selected and its neighbourhood has loaded.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/graph/explorer-queries.ts#expandGraphNeighbourhood",
        },
        essentialEvidenceKeys: ["graph-canvas", "node-inspector"],
        primaryExperience: {
          kind: "command",
          actionKey: "expand-from-here",
        },
        prohibitedActionKeys: [],
        completionSignal:
          "The canvas draws the seed and its neighbours, and the inspector shows the clicked node's labels, properties, and degree.",
        errorCorrection:
          "A clipped view states the node cap and names the three ways to narrow it — relationship filter, node-type filter, or fewer hops.",
        recovery: {
          actionKey: "reset-explorer",
          routePath: "/admin/graph-explorer",
        },
      },
    },
    taskProtocol: {
      startRoute: "/admin/graph-explorer",
      taskPrompt:
        "Find the BacklogItem data model in the graph and tell me how many relationships it has.",
      completionOracle:
        "The inspector shows the BacklogItem node with the Data model label and a relationship count.",
      falseSuccessConditions: [
        "The operator reads a count from the corpus census tiles instead of the node inspector.",
        "The canvas renders but the inspector is never opened, so no per-node evidence is read.",
        "A clipped view is mistaken for the node's complete neighbourhood.",
      ],
      acceptanceThresholds: [
        "The starting point is found within three search attempts.",
        "No raw storage label (for example ArchiMate__DataObject) is shown to the operator.",
        "Rendered subgraphs stay within the node cap so the canvas remains interactive.",
      ],
    },
    ratifiedBy: {
      role: "owner",
      ref: "operator-request:mark-bodman-2026-07-30",
    },
    reviewRef: "BI-89A149A9",
    intentEvidenceRefs: [
      {
        kind: "operator-request",
        ref: "BI-89A149A9",
        summary:
          "Operator asked for the Neo4j-style visual graph exploration capability to return, under Admin, for exploring and demonstrating the corpus and code graph.",
      },
      {
        kind: "existing-behavior",
        ref: "packages/db/src/pg-graph.ts",
        summary:
          "BET-5 mirrored the Neo4j graph into graph_node / graph_edge with the same traversal surface, but shipped no visual explorer over it.",
      },
    ],
  },
];
