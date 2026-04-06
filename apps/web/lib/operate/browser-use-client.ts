// apps/web/lib/operate/browser-use-client.ts
// Client for the browser-use MCP server (AI-powered browser automation).
// Replaces playwright-runner.ts — all browser interaction goes through browser-use.

const BROWSER_USE_URL = process.env.BROWSER_USE_URL || "http://browser-use:8500/mcp";

export type UxTestStep = {
  step: string;
  passed: boolean;
  screenshotUrl: string | null;
  error: string | null;
};

type BrowserUseMcpResponse = {
  jsonrpc: string;
  id: number;
  result?: { content: Array<{ type: string; text: string }> };
  error?: { code: number; message: string };
};

async function callBrowserUse(
  method: string,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 60000,
): Promise<Record<string, unknown>> {
  const res = await fetch(BROWSER_USE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params: method === "tools/call" ? { name: toolName, arguments: args } : args,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new Error(`browser-use HTTP ${res.status}`);
  const body = (await res.json()) as BrowserUseMcpResponse;
  if (body.error) throw new Error(body.error.message);
  const text = body.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : {};
}

export async function runBrowserUseTests(
  sandboxUrl: string,
  testCases: string[],
): Promise<UxTestStep[]> {
  const result = await callBrowserUse(
    "tools/call",
    "browse_run_tests",
    { url: sandboxUrl, tests: testCases },
    300000,
  );

  const results = (result.results ?? []) as Array<Record<string, unknown>>;
  return results.map((r, i) => ({
    step: (r.test as string) ?? `Test ${i + 1}`,
    passed: r.status === "pass",
    screenshotUrl: null,
    error: r.status !== "pass" ? ((r.detail as string) ?? null) : null,
  }));
}

export async function evaluatePage(
  url: string,
): Promise<{ findings: Array<Record<string, unknown>>; screenshot: string | null }> {
  const open = await callBrowserUse("tools/call", "browse_open", { url });
  const sessionId = open.session_id as string;
  if (!sessionId) throw new Error("Failed to open browser session");

  try {
    const extract = await callBrowserUse("tools/call", "browse_extract", {
      session_id: sessionId,
      query: "Analyze this page for UX and accessibility issues. Return a JSON array of findings.",
    }, 120000);

    const ss = await callBrowserUse("tools/call", "browse_screenshot", {
      session_id: sessionId,
    }, 30000);

    let findings: Array<Record<string, unknown>> = [];
    try {
      const raw = typeof extract.data === "string" ? JSON.parse(extract.data as string) : extract.data;
      findings = Array.isArray(raw) ? raw : [];
    } catch {
      findings = [];
    }

    return {
      findings,
      screenshot: (ss.screenshot_base64 as string) ?? null,
    };
  } finally {
    await callBrowserUse("tools/call", "browse_close", { session_id: sessionId }, 10000).catch(() => {});
  }
}
