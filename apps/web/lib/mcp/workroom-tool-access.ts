/** Operational access, not OAuth scope, an annotation, or a grant. */
export const WORKROOM_TOOL_ACCESS_CLASSES = [
  "outside-workroom",
  "source-read",
  "source-edit",
  "scoped-test",
  "gate",
  "evidence",
  "publication",
  "room-operation",
] as const;

export type McpToolAccess = (typeof WORKROOM_TOOL_ACCESS_CLASSES)[number];
const classes: ReadonlySet<unknown> = new Set(WORKROOM_TOOL_ACCESS_CLASSES);

export function isWorkroomToolAccess(value: unknown): value is McpToolAccess {
  return classes.has(value);
}
