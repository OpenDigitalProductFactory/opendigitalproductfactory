// apps/web/lib/tak/intent-taxonomy.ts
//
// EP-E431FC8A Phase 2 (BI-DF3092F4). A data-driven task-class taxonomy that
// replaces the Phase-1 inline route/keyword heuristic in evidence-requirement.ts.
// One structured registry maps a task class to the routes it lives on, the
// AUTHORITATIVE (live-state) tools that answer it, and the message cues that
// signal it. The evidence gate (Phase 1), the fidelity harness (Phase 2), the
// capability broker (Phase 3), and specialist routing (Phase 4) all read from
// this single source instead of re-encoding intent rules.
//
// Pure + dependency-light so it unit-tests in isolation and stays a leaf module.

export interface TaskClassDef {
  /** Stable id, e.g. "backlog-status". */
  taskClass: string;
  /** Route prefixes this class serves (longest-prefix wins across classes). */
  routePrefixes: readonly string[];
  /** The authoritative tools that produce evidence for this class. A turn is
   *  "tool-verified" for the class iff one of these ran successfully. */
  authoritativeToolNames: readonly string[];
  /** Message cues that mark a live-state question for this class. */
  cues: readonly RegExp[];
}

/**
 * The task-class registry. Additive: adding a row teaches the evidence gate, the
 * fidelity harness, the broker, and the specialist router about a new class at
 * once. Keep cues high-precision — a false positive forces an unnecessary tool
 * call, a false negative lets a fabricated answer through.
 */
export const TASK_CLASSES: readonly TaskClassDef[] = [
  {
    taskClass: "backlog-status",
    routePrefixes: ["/ops"],
    authoritativeToolNames: ["query_backlog", "list_backlog_items", "get_backlog_item"],
    cues: [
      /\bbacklog\b/i,
      /\bissues?\b/i,
      /\bitems?\b/i,
      /\bresolved\b/i,
      /\bin[- ]?progress\b/i,
      /\b(still )?(open|blocked|deferred|pending|done|closed)\b/i,
      /\bstatus\b/i,
      /\bhow many\b/i,
    ],
  },
  {
    taskClass: "provider-health",
    routePrefixes: ["/platform/ai", "/ops/self-upgrade"],
    authoritativeToolNames: ["resolve_model_selection", "get_build_engine_readiness", "get_self_upgrade_queue_status"],
    cues: [/\bprovider\b/i, /\bmodel\b/i, /\bhealth\b/i, /\b(online|offline|available|degraded)\b/i, /\bendpoint\b/i, /\brouting\b/i],
  },
  {
    taskClass: "capsule-status",
    routePrefixes: ["/build", "/workspace/work"],
    authoritativeToolNames: ["get_workroom", "list_workrooms", "get_build_progress_visibility"],
    cues: [/\bbuild\b/i, /\bcapsule\b/i, /\bprogress\b/i, /\bphase\b/i, /\bstatus\b/i],
  },
];

/** Longest matching route prefix across all classes for a pathname. */
function routeMatches(routeContext: string, prefixes: readonly string[]): number {
  let best = -1;
  for (const p of prefixes) {
    if ((routeContext === p || routeContext.startsWith(p + "/")) && p.length > best) best = p.length;
  }
  return best;
}

export interface TaskClassification {
  taskClass: string;
  authoritativeToolNames: readonly string[];
}

/**
 * A supplied source artifact is evidence for what that source says, not for the
 * running system. Keep quoted code out of intent matching and preserve any live
 * request outside it. This narrows classification only; it grants no tool or
 * writer authority and does not accept 'do not use tools' as an exemption.
 */
export function isSuppliedSourceAnalysis(message: string): boolean {
  let suppliedSource = false;
  const withoutFences = message.replace(/```[^\n]*\n[\s\S]*?```/g, () => {
    suppliedSource = true;
    return "\n";
  });
  let inDiff = false;
  let oldLines = 0;
  let newLines = 0;
  const request = withoutFences.split(/\r?\n/).filter((line) => {
    if (/^diff --git a\/.+ b\//.test(line)) {
      suppliedSource = true;
      inDiff = true;
      oldLines = newLines = 0;
      return false;
    }
    if (!inDiff) return true;
    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldLines = Number(hunk[1] ?? 1);
      newLines = Number(hunk[2] ?? 1);
      return false;
    }
    if ((oldLines > 0 || newLines > 0) && /^[ +\-]/.test(line)) {
      if (line[0] !== "+") oldLines--;
      if (line[0] !== "-") newLines--;
      return false;
    }
    if (/^(?:--- a\/|--- \/dev\/null|\+\+\+ b\/|\+\+\+ \/dev\/null|index |(?:new|deleted) file mode |(?:old|new) mode |(?:similarity|dissimilarity) index |(?:rename|copy) (?:from|to) |\\ No newline)/.test(line)) return false;
    if (line.trim() === "") return false;
    inDiff = false;
    return true;
  }).join("\n");
  if (!suppliedSource || !/\b(?:read|summari[sz]e|explain|review|analy[sz]e|compare)\b[^.!?\n]{0,160}\b(?:diff|patch|source code|code snippet)\b/i.test(request)) return false;
  // Mixed source/live questions still owe live evidence, wherever they appear.
  return !/\b(?:check|verify|query|fetch|show|report|tell|give|count|is|are|has|have|did|does|do|was|were|when|which|what|how)\b[^.!?\n]{0,120}\b(?:current(?:ly)?|latest|live|running|deployed|production|now|today|status|health|queue|completed|resolved|open|pending|remaining|pass(?:ed)?|fail(?:ed)?)\b/i.test(request)
    && !/\b(?:current|latest|live|running|today['’]s)\b[^.!?\n]{0,80}\b(?:build|status|queue|provider|backlog|workroom|deployment)\b/i.test(request);
}

/**
 * Classify a turn's task class from its route + message. Returns the best-matching
 * class when the route matches a class AND the message reads like a live-state
 * question (a cue hit or a literal '?'). Returns null for turns no class covers —
 * the caller then treats the turn as not-evidence-required (or falls back to a
 * route-local heuristic). Deterministic; longest route prefix wins ties.
 */
export function classifyTaskClass(params: {
  routeContext?: string | null;
  message: string;
}): TaskClassification | null {
  const routeContext = params.routeContext ?? "";
  const message = (params.message ?? "").trim();
  if (message.length === 0) return null;
  if (isSuppliedSourceAnalysis(message)) return null;
  const isQuestion = message.includes("?");

  let best: { def: TaskClassDef; prefixLen: number } | null = null;
  for (const def of TASK_CLASSES) {
    const prefixLen = routeMatches(routeContext, def.routePrefixes);
    if (prefixLen < 0) continue;
    const cueHit = isQuestion || def.cues.some((re) => re.test(message));
    if (!cueHit) continue;
    if (!best || prefixLen > best.prefixLen) best = { def, prefixLen };
  }
  if (!best) return null;
  return { taskClass: best.def.taskClass, authoritativeToolNames: best.def.authoritativeToolNames };
}

/** All authoritative tool names across the taxonomy (for broker/harness use). */
export function allAuthoritativeToolNames(): Set<string> {
  const s = new Set<string>();
  for (const def of TASK_CLASSES) for (const n of def.authoritativeToolNames) s.add(n);
  return s;
}
