import type { PortalNavRecord } from "./portal-navigation-model";

export const BUSINESS_VIEW_ROUTES: readonly PortalNavRecord[] = [
  {
    key: "workspace",
    label: "Operations",
    path: "/workspace",
    parentPath: "/workspace",
    domain: "workspace",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
    capabilityKey: null,
    primaryOrder: 10,
    shellNav: {
      sectionKey: "workspace",
      description: "Current state and next action.",
    },
    sectionSiblings: ["/workspace", "/workspace/inbox", "/workspace/my-queue", "/workspace/documents"],
  },
  {
    key: "performance",
    label: "Performance",
    path: "/performance",
    parentPath: "/performance",
    domain: "performance",
    audienceModes: ["operator"],
    destinationKind: "domain-home",
    capabilityKey: "view_business_performance",
    primaryOrder: 15,
    shellNav: {
      sectionKey: "workspace",
      description: "Understand business results, trends, and operating drivers.",
    },
  },
];
