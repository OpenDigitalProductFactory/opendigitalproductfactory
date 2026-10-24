// Mailroom navigation records (design 2026-09-09 §4.9, BI-727D5FD9). Split out of
// portal-navigation-model.ts to keep that module under its size ceiling.

import type { PortalNavRecord } from "./portal-navigation-model";

export const MAILROOM_NAV_ROUTES: readonly PortalNavRecord[] = [
  {
    // Mailroom (design 2026-09-09 §4.9, BI-727D5FD9): the business's inbound
    // correspondence — declared mailboxes, what arrived, who has acknowledged it.
    // A workspace-section sibling beside Needs you and Documents.
    key: "mailroom",
    label: "Mailroom",
    path: "/workspace/mailroom",
    parentPath: "/workspace",
    domain: "workspace",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: null,
    shellNav: {
      sectionKey: "workspace",
      description: "The mailboxes the business reads, what arrived, and who has acknowledged it.",
    },
  },
  { key: "mailroom-item", label: "Mailroom item", path: "/workspace/mailroom/items/[inboundId]", parentPath: "/workspace/mailroom", domain: "workspace", audienceModes: ["operator"], destinationKind: "detail", capabilityKey: null },
];
