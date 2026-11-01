// The read-only source-inquiry work shape (BI-D1FB8C4D, design
// docs/superpowers/specs/2026-10-14-worktree-provisioning-under-gpp-design.md §1).
//
// Review, diagnosis, research and answering a question about the source do not
// change it, so they get no working copy. Before this shape existed every such
// thread was given a full worktree, a branch and a dependency install, because
// no shape said otherwise (402 worktrees and 1,556 branches on 2026-10-14). A
// room on this shape holds `tool:read` only: it reads through the source-read
// tools and cannot reach worktree provisioning (worktree-provision-admission.ts).
// When the inquiry turns out to need a change, the room stops and the author
// claims the item with a delivery shape; that claim is the route to a worktree.
//
// Type-only import back to work-shapes.ts, like the other declaration modules.

import type { WorkShapeDefinition } from "./work-shapes";

export const SOURCE_INQUIRY_SHAPE_KEY = "source-inquiry";
export const SOURCE_INQUIRY_SHAPE_VERSION = "1.0.0";
export const SOURCE_INQUIRY_SHAPE_REF = `${SOURCE_INQUIRY_SHAPE_KEY}@${SOURCE_INQUIRY_SHAPE_VERSION}`;

/** Every source read goes through these immutable readers, never a checkout. */
export const SOURCE_INQUIRY_READ_TOOLS: readonly string[] = [
  "read_source_at_version",
  "search_source_at_version",
  "list_source_directory",
  "read_project_file",
];

export const SOURCE_INQUIRY_SHAPES: Record<string, WorkShapeDefinition> = {
  [SOURCE_INQUIRY_SHAPE_KEY]: {
    key: SOURCE_INQUIRY_SHAPE_KEY,
    version: SOURCE_INQUIRY_SHAPE_VERSION,
    title: "Source inquiry",
    description:
      "Review, diagnose, research or answer a question about the source without changing it. The "
      + "author reads through the source-read tools at a named version and records the answer, a "
      + "finding or a backlog item. The room has no worktree, branch or dependency install, and it "
      + "cannot provision one.",
    triggers: ["claim"],
    stages: [
      {
        key: "inquire",
        title: "Read the source at a named version",
        accountablePrincipalRef: "role:author",
        advance: {
          kind: "status-change",
          condition: "The source the question depends on has been read at a named commit through the source-read tools.",
        },
        evidence: ["source-verified"],
        tools: SOURCE_INQUIRY_READ_TOOLS,
      },
      {
        key: "answer",
        title: "Record the answer",
        accountablePrincipalRef: "role:author",
        advance: {
          kind: "status-change",
          condition: "The answer, finding or new backlog item is recorded, citing the commit and paths it was read from.",
        },
        evidence: ["cited-finding-list"],
        tools: SOURCE_INQUIRY_READ_TOOLS,
      },
    ],
    stopConditions: [
      { kind: "success", condition: "The question is answered with citations to a named commit.", disposition: "proceed" },
      {
        kind: "failure",
        condition: "The work needs a change to the source. The room stops; the author claims the item with a delivery shape, which is the only route to a worktree.",
        disposition: "awaiting-input",
      },
      { kind: "budget", condition: "Open past two days without an answer: reshape, split or close.", disposition: "awaiting-person" },
    ],
    grants: ["tool:read"],
    measures: [
      { key: "inquiry-rooms-share", description: "Share of new rooms created on source-inquiry rather than a delivery shape." },
    ],
    budgets: [{ kind: "cycles-per-window", limit: 2, unit: "days per inquiry" }],
    reviewPoint: { everyDays: 2, description: "An inquiry still open after two days is reviewed: answered, reshaped to delivery, or closed." },
    collaborationShape: null,
  },
};
