// apps/web/lib/tak/coworker-prompt-provenance.ts
//
// Which parts of a coworker's assembled system prompt are platform- or
// operator-authored INSTRUCTION, and which are the turn's DATA (BI-463BE12A).
//
// This lives away from the call site for one reason: getting it wrong in either
// direction is consequential and the reasoning deserves to be readable. Declare
// too little and a coworker whose job description names payroll is pinned to
// local-only routing forever — measured at 100% of turns for five coworkers on
// the live install. Declare too much and real governed values launder
// themselves into a cloud provider by riding inside the prompt.
//
// The asymmetry decides the default: anything NOT declared here is classified
// as data, so under-declaring costs routing quality and over-declaring costs
// containment. When unsure, leave it out.

/** The pieces that make up a coworker's domain block, by who authored them. */
export type CoworkerDomainParts = {
  /** The coworker's persona — what it is and what it does. Operator-authored. */
  persona: string;
  /** Fixed platform instruction appended to every coworker's domain block. */
  surfaceInstruction: string;
  /** Knowledge recalled from the organization's own records. DATA. */
  knowledge?: string | null;
  /** The coworker's semantic memory of prior work. DATA. */
  memory?: string | null;
};

/**
 * Compose the domain block AND say which parts of it are instruction.
 *
 * Composition and provenance live in one function because they are the same
 * decision: whoever concatenates these four pieces into a single string is the
 * last place that still knows which was which. Splitting them is how the
 * knowledge and memory blocks came to be indistinguishable from the persona by
 * the time the screener saw them.
 *
 * `knowledge` and `memory` are deliberately absent from the returned spans.
 * They are recalled from the organization's own records and can carry names,
 * salaries and account numbers.
 */
export function composeCoworkerDomainContext(parts: CoworkerDomainParts): {
  domainContext: string;
  instructionSpans: string[];
} {
  let domainContext = `${parts.persona}\n\n${parts.surfaceInstruction}`;
  if (parts.knowledge) domainContext += "\n\n" + parts.knowledge;
  if (parts.memory) domainContext += "\n\n" + parts.memory;

  return {
    domainContext,
    instructionSpans: [parts.persona, parts.surfaceInstruction]
      .map((span) => span?.trim())
      .filter((span): span is string => Boolean(span)),
  };
}

/**
 * The instruction spans for a prompt that is ENTIRELY the coworker's brief
 * (BI-CE93E314).
 *
 * `loadPromptBackplane` composes the identity block, company mission, platform
 * preamble and route persona — four authored prompt templates, with no
 * runtime-injected business data anywhere in them. Callers that hand that string
 * straight to the agentic loop (the scheduled runner, the thread dispatcher, the
 * MCP task path, the certification runner) can declare the whole thing.
 *
 * Named rather than inlined at each call site so there is one place to correct
 * if the backplane ever starts injecting recalled data — at which point this
 * function must narrow, and every caller narrows with it.
 */
export function coworkerBriefSpans(systemPrompt: string | null | undefined): string[] {
  const brief = systemPrompt?.trim();
  return brief ? [brief] : [];
}
