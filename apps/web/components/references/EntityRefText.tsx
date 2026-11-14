// BI-A63A9476: plain text with its readable entity ids linked, for surfaces that
// show text rather than markdown (Workroom activity messages). The ids are found
// by the parser's own pattern, and only ids the server resolved as readable
// (`hrefs`) become links; an unknown id and an unreadable id both stay text (R1).

import Link from "next/link";
import type { ReactNode } from "react";

import { ENTITY_ID_PATTERN } from "@dpf/db/wiki-frontmatter";

export function EntityRefText({ text, hrefs }: { text: string; hrefs?: Readonly<Record<string, string>> }): ReactNode {
  if (!hrefs || Object.keys(hrefs).length === 0) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(new RegExp(ENTITY_ID_PATTERN.source, "g"))) {
    const href = hrefs[match[0]];
    if (!href) continue;
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <Link key={`${match.index}:${match[0]}`} href={href} className="text-[var(--dpf-accent)] hover:underline">
        {match[0]}
      </Link>,
    );
    last = match.index + match[0].length;
  }
  if (parts.length === 0) return text;
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
