// Where a decision came from (BI-6700AF66, EP-0AF96937).
//
// A DecisionInteraction records what was asked and how the kernel scored it,
// but the audit record shows the caller as an agent slug, a thread id and a
// token id. That is not enough for an owner to rule: they need the piece of
// work the coworker was inside, what that work is for, and whether this same
// question has come back before.
//
// Nothing here invents context. Each step resolves against a real row, and the
// result records WHICH step matched (`matchedVia`) so the surface can say how
// it knew instead of implying certainty. When no step resolves, the origin is
// `null` and the page says so — an honest gap beats a plausible guess.
//
// Spec: docs/superpowers/specs/2026-08-23-decision-concierge-design.md §4.1

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

/** How the origin was established. Ordered strongest-evidence first. */
export type OriginMatch =
  | "build" // the decision names a build, and a workroom owns that build
  | "task-run" // the decision names a task run, and a workroom owns that run
  | "session-token" // the caller's session ref matches a workroom's executor ref
  | "agent" // only the coworker is known, not the room it worked in
  | "thread" // only the conversation is known
  | "none";

export type DecisionOriginWorkroom = {
  capsuleId: string;
  title: string;
  objective: string;
  activityKind: string | null;
  status: string;
};

export type DecisionOriginCoworker = {
  agentId: string;
  displayName: string;
  role: string | null;
  portfolioSlug: string | null;
};

/** What the coworker was doing when the decision was raised. */
export type DecisionOriginActivity = {
  kind: "build" | "task-run" | "thread" | "mcp-session";
  label: string;
  detail: string | null;
  href: string | null;
};

/** How often this same question has already been asked. */
export type DecisionOriginRecurrence = {
  /** Rows with the same question text, excluding this one. */
  priorOccurrences: number;
  /** Of those, how many are still unresolved. */
  stillOpen: number;
  firstSeenAt: Date | null;
};

export type DecisionOrigin = {
  matchedVia: OriginMatch;
  workroom: DecisionOriginWorkroom | null;
  coworker: DecisionOriginCoworker | null;
  activity: DecisionOriginActivity | null;
  recurrence: DecisionOriginRecurrence;
};

/** The interaction fields the resolver reads. */
export type DecisionOriginRow = {
  interactionId: string;
  question: string;
  buildId: string | null;
  taskRunId: string | null;
  outcomePayload: unknown;
};

/* -------------------------------------------------------------------------- */
/* Caller parsing (pure)                                                      */
/* -------------------------------------------------------------------------- */

export type DecisionCaller = {
  client: string | null;
  agentId: string | null;
  threadId: string | null;
  /** Raw token id, e.g. "session:<sessionId>:<agent>". */
  apiTokenId: string | null;
  /** The session segment of an MCP session token, when the token carries one. */
  sessionRef: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Read the caller block off an interaction's outcomePayload. MCP session tokens
 * are recorded as `session:<sessionId>:<agentSlug>`; the middle segment is what
 * a Workroom stores as its executorRef, which is the only link between an
 * external CLI session and the room it claimed.
 */
export function parseDecisionCaller(outcomePayload: unknown): DecisionCaller {
  const caller = asRecord(asRecord(outcomePayload).caller);
  const apiTokenId = asString(caller.apiTokenId);
  let sessionRef: string | null = null;
  if (apiTokenId?.startsWith("session:")) {
    const segments = apiTokenId.split(":");
    sessionRef = segments.length >= 2 ? (asString(segments[1]) ?? null) : null;
  }
  return {
    client: asString(caller.client),
    agentId: asString(caller.agentId),
    threadId: asString(caller.threadId),
    apiTokenId,
    sessionRef,
  };
}

/* -------------------------------------------------------------------------- */
/* Database surface (structural, so tests inject a fake)                      */
/* -------------------------------------------------------------------------- */

type WorkroomRow = {
  capsuleId: string;
  title: string;
  objective: string;
  activityKind: string | null;
  status: string;
};

type TaskRunRow = { id: string; title: string; objective: string; status: string };

type BuildRow = { id: string; title: string | null };

type AgentRow = {
  agentId: string;
  name: string;
  displayName: string | null;
  role: string | null;
  kind: string | null;
  portfolio: { slug: string } | null;
};

export type DecisionOriginDb = {
  workroom: {
    findFirst(args: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
      orderBy?: Record<string, unknown>;
    }): Promise<WorkroomRow | null>;
  };
  taskRun: {
    findUnique(args: {
      where: { taskRunId: string };
      select: Record<string, boolean>;
    }): Promise<TaskRunRow | null>;
  };
  featureBuild: {
    findUnique(args: {
      where: { buildId: string };
      select: Record<string, boolean>;
    }): Promise<BuildRow | null>;
  };
  agent: {
    findUnique(args: {
      where: { agentId: string };
      select: Record<string, unknown>;
    }): Promise<AgentRow | null>;
  };
  decisionInteraction: {
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
      orderBy?: Record<string, unknown>;
      take?: number;
    }): Promise<Array<{ interactionId: string; createdAt: Date; humanOutcome: unknown }>>;
  };
};

const WORKROOM_SELECT = {
  capsuleId: true,
  title: true,
  objective: true,
  activityKind: true,
  status: true,
};

/* -------------------------------------------------------------------------- */
/* Resolution                                                                 */
/* -------------------------------------------------------------------------- */

function toCoworker(agent: AgentRow | null): DecisionOriginCoworker | null {
  if (!agent) return null;
  return {
    agentId: agent.agentId,
    displayName: agent.displayName || agent.name,
    role: agent.role ?? agent.kind ?? null,
    portfolioSlug: agent.portfolio?.slug ?? null,
  };
}

/**
 * How many times this same question has already been recorded, and how many of
 * those are still waiting on a human. Exact-question matching only: the
 * semantic clusterer on the review page owns paraphrase grouping, and running
 * embeddings from a record page would make the page fail when the embedding
 * runtime is down.
 */
async function resolveRecurrence(
  db: DecisionOriginDb,
  row: DecisionOriginRow,
): Promise<DecisionOriginRecurrence> {
  const question = row.question.trim();
  if (!question) return { priorOccurrences: 0, stillOpen: 0, firstSeenAt: null };
  const siblings = await db.decisionInteraction.findMany({
    where: { question, interactionId: { not: row.interactionId } },
    select: { interactionId: true, createdAt: true, humanOutcome: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return {
    priorOccurrences: siblings.length,
    stillOpen: siblings.filter((s) => s.humanOutcome === null).length,
    firstSeenAt: siblings[0]?.createdAt ?? null,
  };
}

/**
 * Resolve the origin of one decision. Steps run strongest-evidence first and
 * stop at the first workroom match; the coworker and the recurrence count are
 * always attempted, because they are useful even when no room resolves.
 */
export async function resolveDecisionOrigin(
  db: DecisionOriginDb,
  row: DecisionOriginRow,
): Promise<DecisionOrigin> {
  const caller = parseDecisionCaller(row.outcomePayload);
  const [recurrence, agent] = await Promise.all([
    resolveRecurrence(db, row),
    caller.agentId
      ? db.agent.findUnique({
        where: { agentId: caller.agentId },
        select: {
          agentId: true,
          name: true,
          displayName: true,
          role: true,
          kind: true,
          portfolio: { select: { slug: true } },
        },
      })
      : Promise.resolve(null),
  ]);
  const coworker = toCoworker(agent);

  // 1. A build the decision names, and the workroom that owns that build.
  if (row.buildId) {
    const build = await db.featureBuild.findUnique({
      where: { buildId: row.buildId },
      select: { id: true, title: true },
    });
    if (build) {
      const workroom = await db.workroom.findFirst({
        where: { featureBuildId: build.id },
        select: WORKROOM_SELECT,
        orderBy: { updatedAt: "desc" },
      });
      return {
        matchedVia: "build",
        workroom,
        coworker,
        activity: {
          kind: "build",
          label: build.title ?? row.buildId,
          detail: null,
          href: `/build/${encodeURIComponent(row.buildId)}`,
        },
        recurrence,
      };
    }
  }

  // 2. A coworker task run, and the workroom that owns it. Note the key spaces
  //    differ: the interaction stores the semantic taskRunId, the workroom
  //    stores the row id, so the run must be resolved before the room.
  if (row.taskRunId) {
    const taskRun = await db.taskRun.findUnique({
      where: { taskRunId: row.taskRunId },
      select: { id: true, title: true, objective: true, status: true },
    });
    if (taskRun) {
      const workroom = await db.workroom.findFirst({
        where: { taskRunId: taskRun.id },
        select: WORKROOM_SELECT,
        orderBy: { updatedAt: "desc" },
      });
      return {
        matchedVia: "task-run",
        workroom,
        coworker,
        activity: {
          kind: "task-run",
          label: taskRun.title,
          detail: taskRun.objective,
          href: null,
        },
        recurrence,
      };
    }
  }

  // 3. An external CLI session: its session ref is what the room recorded as
  //    its executor ref when the session claimed it.
  if (caller.sessionRef) {
    const workroom = await db.workroom.findFirst({
      where: { executorRef: { contains: caller.sessionRef } },
      select: WORKROOM_SELECT,
      orderBy: { updatedAt: "desc" },
    });
    if (workroom) {
      return {
        matchedVia: "session-token",
        workroom,
        coworker,
        activity: {
          kind: "mcp-session",
          label: caller.client ?? "external session",
          detail: null,
          href: null,
        },
        recurrence,
      };
    }
  }

  // 4. No room resolved. Report what is actually known — the coworker, or the
  //    conversation — rather than nothing.
  if (coworker) {
    return {
      matchedVia: "agent",
      workroom: null,
      coworker,
      activity: caller.client
        ? { kind: "mcp-session", label: caller.client, detail: null, href: null }
        : null,
      recurrence,
    };
  }
  if (caller.threadId) {
    return {
      matchedVia: "thread",
      workroom: null,
      coworker: null,
      activity: { kind: "thread", label: "a coworker conversation", detail: null, href: null },
      recurrence,
    };
  }
  return { matchedVia: "none", workroom: null, coworker: null, activity: null, recurrence };
}

/* -------------------------------------------------------------------------- */
/* Copy (pure)                                                                */
/* -------------------------------------------------------------------------- */

export type DecisionOriginCopy = {
  heading: string;
  /** One line per fact that actually resolved. */
  lines: Array<{ label: string; value: string; href: string | null }>;
  /** How the link was established, stated plainly. Null when nothing resolved. */
  basis: string | null;
  /** Recurrence sentence, or null when this is the first time. */
  recurrence: string | null;
  /** Shown when nothing resolved at all. */
  unresolved: string | null;
};

const BASIS_TEXT: Record<OriginMatch, string | null> = {
  build: "Matched through the build this decision belongs to.",
  "task-run": "Matched through the coworker task that raised it.",
  "session-token": "Matched through the session token that raised it.",
  agent: "Only the coworker is known; no room claimed this work.",
  thread: "Only the conversation is known.",
  none: null,
};

/** Turn a resolved origin into the lines a surface renders. Pure. */
export function buildDecisionOriginCopy(origin: DecisionOrigin): DecisionOriginCopy {
  const lines: DecisionOriginCopy["lines"] = [];
  if (origin.workroom) {
    lines.push({
      label: "Work room",
      value: origin.workroom.title,
      href: `/build/work/${encodeURIComponent(origin.workroom.capsuleId)}`,
    });
    lines.push({ label: "What that room is for", value: origin.workroom.objective, href: null });
  }
  if (origin.coworker) {
    const role = origin.coworker.role ? ` (${origin.coworker.role})` : "";
    lines.push({ label: "Coworker", value: `${origin.coworker.displayName}${role}`, href: null });
  }
  if (origin.activity) {
    lines.push({
      label: "Doing",
      value: origin.activity.detail
        ? `${origin.activity.label} — ${origin.activity.detail}`
        : origin.activity.label,
      href: origin.activity.href,
    });
  }

  const { priorOccurrences, stillOpen } = origin.recurrence;
  let recurrence: string | null = null;
  if (priorOccurrences > 0) {
    const times = priorOccurrences === 1 ? "once before" : `${priorOccurrences} times before`;
    recurrence =
      stillOpen > 0
        ? `Asked ${times}; ${stillOpen} of those still waiting on you.`
        : `Asked ${times}, and answered each time.`;
  }

  return {
    heading: "Where this came from",
    lines,
    basis: lines.length > 0 ? BASIS_TEXT[origin.matchedVia] : null,
    recurrence,
    unresolved:
      lines.length === 0
        ? "The work behind this decision could not be traced. What it names is below."
        : null,
  };
}
