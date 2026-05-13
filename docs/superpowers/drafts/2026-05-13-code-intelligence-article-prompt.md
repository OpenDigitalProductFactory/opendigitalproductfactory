# Article Prompt: Lessons From Building a Code Graph for AI Agents

Write a practical engineering article for software teams experimenting with AI coding agents.

Working title: "A Code Graph Is Not a Search Replacement: What We Learned Benchmarking AI Agent Code Discovery"

Audience:

- Engineering leaders evaluating AI coding workflows.
- Staff/principal engineers designing agentic development platforms.
- Developers who have tried "just grep the repo" and found it both useful and insufficient.

Core thesis:

A code graph is useful when it gives agents structural context that text search cannot, but it should not replace source search. The durable pattern is a two-lane workflow: source search for exact text and runtime symptoms, graph navigation for known routes, tools, models, symbols, files, and test targeting.

Use these concrete observations:

- Exact source search still wins for raw errors like `P2002`, log lines, comments, and unknown phrasing.
- Graph search wins once the agent has a structural handle such as an MCP tool name, route, Prisma model, symbol, or source file.
- A graph that is stale, failed, or opaque is worse than no graph. Agents need a freshness/readiness check before trusting it.
- Test targeting is where the graph starts to pay off: `find_related_tests` can turn source discovery into a verification set.
- Large shared files remain hard. A central file such as `apps/web/lib/mcp-tools.ts` can produce a broad test set unless the graph models smaller handler-level relationships.
- Full rebuild performance matters. In this benchmark, a naive version took about 364 seconds for 2,804 files. After batching file nodes, file hashes, structural nodes, and typed relationship writes with conservative transaction sizes, the latest full rebuild took 13.1 seconds for 2,805 files.
- The tuning lesson was not just "batch writes." A naive batched relationship query that dynamically scanned node keys crashed Neo4j. The stable approach used typed endpoint labels and indexed key properties.
- The benchmark redo exposed a client-contract bug: a PowerShell MCP caller sent a numeric `limit` that Neo4j saw as `10.0`, so graph tools failed until limits were normalized to bounded integer literals at the graph-query boundary.
- The practical recommendation is not "use graphs everywhere." It is "route the agent based on input shape."

Suggested structure:

1. Open with the problem: AI agents waste time rediscovering code structure through repeated text search.
2. Explain the first version of the graph and why we questioned whether it was useful.
3. Describe the benchmark: source-only MCP calls versus graph-assisted MCP calls on two real tasks.
4. Show the results:
   - Seed/P2002: source 414 ms, graph 31 ms warm after a symbol was known.
   - MCP tool surface: source 403 ms, graph 54 ms.
   - Full rebuild: 364 seconds before tuning, 13.1 seconds after stable tuning.
5. Explain where source search still wins.
6. Explain where graph navigation wins.
7. Discuss freshness, governance, and why agents should check graph readiness first.
8. Discuss the performance tuning lesson: typed relationships beat dynamic endpoint scans.
9. End with a concrete workflow rule that readers can adopt:
   - Exact text or runtime symptom: search source first.
   - Route/tool/model/symbol/file: check graph freshness, then use graph.
   - Before editing: read the actual file.
   - Before shipping: use graph-related tests as a starting verification set, not the only gate.

Tone:

Concrete, measured, and field-tested. Avoid hype. Make it clear that the value came from integrating the graph into agent workflow policy, not from the existence of graph data alone.

Include a short "What we would build next" section:

- Better ranking for source search.
- Handler-level graph nodes for central files.
- Projection performance regression tests.
- MCP client-contract tests for numeric arguments.
- Agent prompts that choose tools based on input shape.
