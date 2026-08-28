---
name: dpf-blast-radius
description: "Use before shipping a DPF change to find what it breaks elsewhere — a refactor, renamed field, contract/schema/enum edit, shared helper, or a diff you do not trust."
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash(git diff *) Bash(git log *) Grep Glob Read mcp__dpf__explain_blast_radius mcp__dpf__trace_code_surface mcp__dpf__search_code_graph mcp__dpf__find_related_tests
category: platform
assignTo: ["build-specialist", "platform-engineer", "ea-architect", "external-coding-agent"]
capability: null
taskType: analysis
triggerPattern: "blast radius|what could this break|what depends on|impact of this change|safe to rename|who calls this|downstream effects|breaking change"
userInvocable: true
agentInvocable: true
allowedTools: ["Bash", "mcp__dpf__explain_blast_radius", "mcp__dpf__trace_code_surface", "mcp__dpf__search_code_graph", "mcp__dpf__find_related_tests", "Grep", "Glob", "Read"]
composesFrom: ["dpf-evidence-before-diagnosis", "dpf-verify-substrate-first"]
contextRequirements: ["a committed or staged diff", "code graph reachable, and known to index the tree being changed"]
riskBand: low
enforces:
  - kernel/principles/evidence-before-diagnosis
  - kernel/principles/structural-verification-is-not-functional
---

# DPF Blast Radius

`dpf-evidence-before-diagnosis` looks backward: a symptom exists, find its cause. This looks forward: a change exists, find what it breaks. Same discipline, opposite direction — and the same failure mode, which is believing a confident story instead of running something.

## When to use

- Renaming or removing a field, export, enum member, route, or tool.
- Editing a shared helper, a contract, a schema, or anything under `packages/`.
- Reviewing a diff whose author (including you, an hour ago) you are not sure about.
- Someone asks "what could this break?"

## When NOT to use

- A leaf change with no importers — confirm that with one `Grep`, then stop. This skill is not a ceremony to perform on every diff.
- A symptom already exists. That is `dpf-systematic-debugging`.
- You have not yet decided what the change is. That is `dpf-brainstorming`.

## Enforces

- `kernel/principles/evidence-before-diagnosis` — the graph proposes; running code disposes.
- `kernel/principles/structural-verification-is-not-functional` — "the types still compile" is not "it still works".

## Steps

1. **Establish the change surface.** `git diff` the committed tree. List every exported symbol, field, enum value, route, tool name, and file path the diff adds, renames, or removes. That list — not the file list — is the surface.

2. **Verify the graph indexes the tree you are changing.** Before trusting any graph answer, confirm what it is reading. The portal's code search has previously answered from a stale checkout rather than the working tree (BI-6CFC5429), and a graph answering about the wrong tree returns confident, complete, wrong results. If you cannot establish which tree it indexed, treat the graph as a hint generator and let `Grep` be the authority.

3. **Fan out on each symbol.** `mcp__dpf__explain_blast_radius` and `mcp__dpf__trace_code_surface` for the structural reach; `mcp__dpf__search_code_graph` for callers; `mcp__dpf__find_related_tests` for the tests that already cover it. Then `Grep` the raw string anyway — the graph misses dynamic references, string-keyed lookups, generated code, and anything in a language it does not parse.

4. **Sweep the places the graph cannot see.** Each of these has broken a DPF change before and none of them are call edges:
   - seed data and registries under `packages/db/data/` and `skills/`
   - JSON baselines and allowlists under `scripts/*-baseline.*`
   - prompt text and skill bodies that name a tool or field in prose
   - migrations, and any `@@map` or column name a query builds by string
   - CI guard scripts asserting on file contents

5. **Name the load-bearing facts, then prove them by running code.** Reduce the finding to the one or two claims the whole conclusion rests on — "nothing outside this package imports it", "this enum value is never persisted". Prove each by running something: a test, a query, a script. Do not hand back a writeup whose confidence comes from having thought about it.

   **Your own earlier reasoning in this thread is not evidence.** A conclusion you reached ten tool calls ago and have been building on since is exactly as unverified as it was then.

6. **Report reach, risk, and what you ran.** Say which callers change behaviour versus merely recompile, which tests cover the change and which gap is uncovered, and name what you could NOT determine. An unverified corner reported as unverified is useful; the same corner reported as clear is a defect.

## Guardrails

- **An empty graph result is not "nothing depends on it".** It is one tool returning nothing. Confirm with `Grep` before concluding absence — absence is the hardest thing to establish and the easiest to assert.
- **Compiling is not working.** Typecheck green means the shapes line up, not that behaviour survived.
- **Do not fix what you find, here.** Blast radius reports. Folding repairs into the sweep loses the record of what the change actually reached.
- **Report the reach even when it is inconvenient.** A blast radius that only ever comes back clear is not being run.

## See also

- Backward twin: [`dpf-evidence-before-diagnosis`](../dpf-evidence-before-diagnosis/SKILL.md)
- Before claiming a concept is missing: [`dpf-verify-substrate-first`](../dpf-verify-substrate-first/SKILL.md)
