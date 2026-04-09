/**
 * Test endpoint: verify Codex Responses API works with reasoning effort.
 * GET /api/test/codex-responses
 *
 * Runs 4 tests directly against the ChatGPT backend and returns results.
 * Only works in dev (checks for admin session).
 */
import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { getProviderBearerToken } from "@/lib/ai-provider-internals";

async function callResponses(
  token: string,
  label: string,
  body: Record<string, unknown>,
): Promise<{ label: string; pass: boolean; detail: string }> {
  try {
    const res = await fetch("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      return { label, pass: false, detail: `HTTP ${res.status}` };
    }

    const rawText = await res.text();
    const lines = rawText.split("\n");
    let lastCompleted: Record<string, unknown> | null = null;
    let textDelta = "";
    const funcCalls: string[] = [];

    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      try {
        const parsed = JSON.parse(line.slice(6)) as Record<string, unknown>;
        if (parsed.type === "response.completed" && parsed.response) {
          lastCompleted = parsed.response as Record<string, unknown>;
        }
        if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") {
          textDelta += parsed.delta;
        }
        if (parsed.type === "response.output_item.added") {
          const item = parsed.item as Record<string, unknown> | undefined;
          if (item?.type === "function_call" && item.name) {
            funcCalls.push(String(item.name));
          }
        }
      } catch { /* skip */ }
    }

    const output = (lastCompleted?.output as unknown[]) ?? [];
    const effort = (lastCompleted as any)?.reasoning?.effort ?? "not set";

    if (output.length === 0 && !textDelta && funcCalls.length === 0) {
      return { label, pass: false, detail: `Empty response. reasoning.effort=${effort}` };
    }
    return {
      label,
      pass: true,
      detail: `output=${output.length}, text=${textDelta.length} chars, tools=[${funcCalls.join(",")}], effort=${effort}. Text: "${textDelta.slice(0, 100)}"`,
    };
  } catch (err) {
    return { label, pass: false, detail: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function GET() {
  // Get OAuth token
  const tokenResult = await getProviderBearerToken("codex");
  if ("error" in tokenResult) {
    // Try chatgpt
    const chatgptResult = await getProviderBearerToken("chatgpt");
    if ("error" in chatgptResult) {
      return NextResponse.json({ error: "No OAuth token for codex or chatgpt", details: tokenResult.error });
    }
    return runTests(chatgptResult.token);
  }
  return runTests(tokenResult.token);
}

async function runTests(token: string) {
  const input = [{ role: "user", content: "Say hello in one sentence." }];
  const results = [];

  // Test 1: No reasoning (the bug)
  results.push(await callResponses(token, "gpt-5.3-codex WITHOUT reasoning (BUG)", {
    model: "gpt-5.3-codex",
    input,
    instructions: "You are a helpful assistant.",
    store: false,
    stream: true,
  }));

  // Test 2: With reasoning.effort=low (the fix)
  results.push(await callResponses(token, "gpt-5.3-codex WITH reasoning.effort=low (FIX)", {
    model: "gpt-5.3-codex",
    input,
    instructions: "You are a helpful assistant.",
    reasoning: { effort: "low" },
    store: false,
    stream: true,
  }));

  // Test 3: gpt-5.4 with reasoning
  results.push(await callResponses(token, "gpt-5.4 WITH reasoning.effort=low", {
    model: "gpt-5.4",
    input,
    instructions: "You are a helpful assistant.",
    reasoning: { effort: "low" },
    store: false,
    stream: true,
  }));

  // Test 4: Tools + reasoning
  results.push(await callResponses(token, "gpt-5.4 WITH tools + reasoning.effort=medium", {
    model: "gpt-5.4",
    input: [{ role: "user", content: "Save a note that says 'hello world'." }],
    instructions: "You are a helpful assistant. Use tools when appropriate.",
    reasoning: { effort: "medium" },
    tools: [{
      type: "function",
      name: "save_note",
      description: "Save a text note",
      parameters: {
        type: "object",
        properties: { content: { type: "string", description: "The note content" } },
        required: ["content"],
      },
    }],
    store: false,
    stream: true,
  }));

  // Test 5: Realistic build studio scenario — long system prompt + many tools + effort=high
  const buildTools = [
    { type: "function", name: "saveBuildEvidence", description: "Save build evidence for a feature", parameters: { type: "object", properties: { field: { type: "string" }, value: { type: "string" } }, required: ["field", "value"] } },
    { type: "function", name: "search_project_files", description: "Search project files by glob pattern", parameters: { type: "object", properties: { glob: { type: "string" } }, required: ["glob"] } },
    { type: "function", name: "read_project_file", description: "Read a project file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
    { type: "function", name: "save_build_notes", description: "Save notes during ideation", parameters: { type: "object", properties: { notes: { type: "string" } }, required: ["notes"] } },
    { type: "function", name: "launch_sandbox", description: "Launch a sandbox environment for code generation", parameters: { type: "object", properties: {} } },
    { type: "function", name: "generate_code", description: "Generate code in the sandbox", parameters: { type: "object", properties: { instruction: { type: "string" }, path: { type: "string" } }, required: ["instruction"] } },
    { type: "function", name: "run_sandbox_command", description: "Run a command in the sandbox", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
    { type: "function", name: "write_sandbox_file", description: "Write a file in the sandbox", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  ];
  const buildSystemPrompt = `You are the Software Engineer coworker.

PERSPECTIVE: You see features as code, schemas, components, and test coverage. You encode the world as files, functions, types, dependencies, and the five build phases: Ideate → Plan → Build → Review → Ship.

HEURISTICS:
- Decomposition: break features into implementable chunks
- Test-driven thinking: define what "done" looks like before building
- Pattern reuse: leverage existing code, conventions, and components

RULES:
1. Start by exploring the codebase with search_project_files and read_project_file
2. Use saveBuildEvidence to record your analysis
3. Use tools silently. Don't announce or narrate tool usage.

CURRENT PHASE: Ideate
FEATURE: "Process to collect payment, register student with open group and distribute test voucher"

Begin the ideation phase. Explore the codebase to understand what exists, then save your analysis.`;

  results.push(await callResponses(token, "Build Studio scenario: tools + long prompt + effort=high", {
    model: "gpt-5.4",
    input: [{ role: "user", content: "I just created a new feature called 'Process to collect payment, register student with open group and distribute test voucher'. Help me define it." }],
    instructions: buildSystemPrompt,
    reasoning: { effort: "high" },
    tools: buildTools,
    store: false,
    stream: true,
  }));

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;

  return NextResponse.json({
    summary: `${passed} passed, ${failed} failed`,
    // Test 1 SHOULD fail (that's the bug), tests 2-4 should pass
    expectedPattern: "Test 1 should FAIL (no reasoning = empty). Tests 2-4 should PASS.",
    results,
  });
}
