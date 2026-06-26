import { prisma } from "@dpf/db";

type TraversalStep = {
  elementTypeSlugs: string[];
  refinementLevel: string | null;
  relationshipTypeSlugs: string[];
  direction: "outbound" | "inbound" | "either" | "terminal";
};

type TraversalInput = {
  patternSlug: string;
  startElementIds: string[];
  notationSlug?: string;
  maxDepth?: number;
};

type PathStep = {
  elementId: string;
  elementName: string;
  elementType: string;
  refinementLevel: string | null;
  relationshipType?: string;
  direction?: string;
};

type TraversalResult = {
  ok: boolean;
  error?: string;
  data?: {
    paths: Array<{ steps: PathStep[]; complete: boolean; terminationReason: string }>;
    summary: {
      nodesTraversed: number;
      relationshipsFollowed: number;
      refinementGaps: string[];
      forbiddenShortcutsBlocked: string[];
      conformanceIssuesRaised: string[];
    };
  };
};

export async function runTraversalPattern(input: TraversalInput): Promise<TraversalResult> {
  const { patternSlug, startElementIds, notationSlug = "archimate4", maxDepth = 6 } = input;

  // Resolve notation
  const notation = await prisma.eaNotation.findUnique({ where: { slug: notationSlug } });
  if (!notation) return { ok: false, error: `Notation "${notationSlug}" not found` };

  const pattern = await prisma.eaTraversalPattern.findUnique({
    where: { notationId_slug: { notationId: notation.id, slug: patternSlug } },
  });
  if (!pattern) return { ok: false, error: `Traversal pattern "${patternSlug}" not found` };

  const steps = pattern.steps as TraversalStep[];
  const paths: NonNullable<TraversalResult["data"]>["paths"] = [];
  const refinementGaps: string[] = [];

  for (const startId of startElementIds) {
    const startEl = await prisma.eaElement.findUnique({
      where: { id: startId },
      include: { elementType: { select: { slug: true } } },
    });
    if (!startEl) continue;

    const path: PathStep[] = [{
      elementId: startEl.id,
      elementName: startEl.name,
      elementType: startEl.elementType.slug,
      refinementLevel: startEl.refinementLevel,
    }];
    let currentIds = [startId];
    let complete = false;
    let terminationReason = "max_depth_reached";

    for (let stepIdx = 0; stepIdx < steps.length && stepIdx < maxDepth; stepIdx++) {
      const step = steps[stepIdx];

      if (step.direction === "terminal") {
        complete = true;
        terminationReason = "terminal_step_reached";
        break;
      }

      const nextIds: string[] = [];

      // One batched query per depth step (was one findMany PER NODE — N+1 over a
      // 331+-edge graph). The rows are grouped back by their originating current
      // node and replayed in the original currentIds order so the per-node
      // traversal semantics (and therefore run_traversal_pattern output) are
      // byte-identical to the per-node loop.
      const relWhere =
        step.direction === "outbound" ? { fromElementId: { in: currentIds } } :
        step.direction === "inbound"  ? { toElementId: { in: currentIds } } :
        { OR: [{ fromElementId: { in: currentIds } }, { toElementId: { in: currentIds } }] };

      const allRels = await prisma.eaRelationship.findMany({
        where: relWhere,
        include: {
          fromElement: { include: { elementType: { select: { slug: true } } } },
          toElement:   { include: { elementType: { select: { slug: true } } } },
          relationshipType: { select: { slug: true } },
        },
      });

      // Group the batched rows by the current-node id the per-node query would
      // have matched on. For "either", a single row can match two distinct
      // current nodes (once via fromElementId, once via toElementId) — exactly
      // as the old OR-per-node query would have surfaced it under both — so it is
      // bucketed under each. Encounter order within a bucket follows the DB row
      // order, matching the per-node query's order for the same table state.
      const relsByCurrentId = new Map<string, typeof allRels>();
      const bucket = (id: string, rel: (typeof allRels)[number]) => {
        const list = relsByCurrentId.get(id);
        if (list) list.push(rel);
        else relsByCurrentId.set(id, [rel]);
      };
      const currentIdSet = new Set(currentIds);
      for (const rel of allRels) {
        if (step.direction === "outbound") {
          bucket(rel.fromElementId, rel);
        } else if (step.direction === "inbound") {
          bucket(rel.toElementId, rel);
        } else {
          if (currentIdSet.has(rel.fromElementId)) bucket(rel.fromElementId, rel);
          if (currentIdSet.has(rel.toElementId)) bucket(rel.toElementId, rel);
        }
      }

      for (const currentId of currentIds) {
        const rels = relsByCurrentId.get(currentId) ?? [];

        for (const rel of rels) {
          const nextEl = step.direction === "inbound" ? rel.fromElement : rel.toElement;

          // Filter by element type if specified
          if (step.elementTypeSlugs.length > 0 && !step.elementTypeSlugs.includes(nextEl.elementType.slug)) continue;

          // Filter by relationship type if specified
          if (step.relationshipTypeSlugs.length > 0 && !step.relationshipTypeSlugs.includes(rel.relationshipType.slug)) continue;

          // Enforce refinement level if specified; record gaps
          if (step.refinementLevel && nextEl.refinementLevel !== step.refinementLevel) {
            refinementGaps.push(
              `${nextEl.name} (${nextEl.elementType.slug}) expected refinementLevel="${step.refinementLevel}", got "${nextEl.refinementLevel ?? "unset"}"`
            );
            continue;
          }

          nextIds.push(nextEl.id);
          path.push({
            elementId: nextEl.id,
            elementName: nextEl.name,
            elementType: nextEl.elementType.slug,
            refinementLevel: nextEl.refinementLevel,
            relationshipType: rel.relationshipType.slug,
            direction: step.direction,
          });
        }
      }

      if (nextIds.length === 0) {
        terminationReason = "no_matching_elements";
        break;
      }
      currentIds = nextIds;
    }

    paths.push({ steps: path, complete, terminationReason });
  }

  return {
    ok: true,
    data: {
      paths,
      summary: {
        nodesTraversed: paths.reduce((acc, p) => acc + p.steps.length, 0),
        relationshipsFollowed: paths.reduce((acc, p) => acc + Math.max(0, p.steps.length - 1), 0),
        refinementGaps,
        forbiddenShortcutsBlocked: [],
        conformanceIssuesRaised: [],
      },
    },
  };
}
