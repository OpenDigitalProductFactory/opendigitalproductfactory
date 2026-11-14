// BI-A63A9476: where a referenced entity opens. Pure, so client and server
// surfaces link to the same place.

import type { ReferenceEntityKind } from "@dpf/db/entity-reference-scope";

export function entityHref(kind: ReferenceEntityKind, key: string, extra: { slug?: string; roomKey?: string } = {}): string {
  switch (kind) {
    case "backlog":
      return `/ops?itemId=${encodeURIComponent(key)}`;
    case "epic":
      return `/ops#${encodeURIComponent(key)}`;
    case "document":
      return `/workspace/documents/${encodeURIComponent(key)}`;
    case "wiki":
      return `/coworker-decisions/${extra.slug ?? key}`;
    case "workroom":
      return `/ops/workrooms#${encodeURIComponent(key)}`;
    case "message":
      return `/ops/workrooms#${encodeURIComponent(extra.roomKey ?? key)}`;
  }
}
