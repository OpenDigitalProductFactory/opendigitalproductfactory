// BI-A63A9476: what a server-rendered surface needs from the shared reader — the
// hrefs of the readable ids in its body and its "Referenced by" rows — for the
// signed-in person. A failure shows no references rather than failing the page.

import { getErrorMessage } from "@/lib/shared/get-error-message";
import { extractEntityIds } from "@dpf/db/wiki-frontmatter";

import type { UserContext } from "@/lib/permissions";

import { listInbound, resolveReadableEntityHrefs, type ReferenceRow } from "./read-references";
import { personReferenceReader, referenceReadDeps } from "./reference-reader.server";

export type ReferenceSurface = { hrefs: Record<string, string>; referencedBy: ReferenceRow[] };

export const EMPTY_REFERENCE_SURFACE: ReferenceSurface = { hrefs: {}, referencedBy: [] };

export async function loadReferenceSurface(
  user: { id: string } & UserContext,
  input: { key?: string; bodies?: readonly string[]; mention?: string },
): Promise<ReferenceSurface> {
  try {
    const reader = await personReferenceReader(user);
    const deps = referenceReadDeps(reader);
    const ids = (input.bodies ?? []).flatMap((body) => extractEntityIds(body));
    const [hrefs, inbound] = await Promise.all([
      ids.length ? resolveReadableEntityHrefs(ids, reader, deps) : Promise.resolve({}),
      input.key ? listInbound(input.key, reader, { mention: input.mention }, deps) : Promise.resolve(null),
    ]);
    return { hrefs, referencedBy: inbound?.rows ?? [] };
  } catch (err) {
    console.warn(`[references] surface for ${input.key ?? "body"} unavailable: ${getErrorMessage(err)}`);
    return EMPTY_REFERENCE_SURFACE;
  }
}
