import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TestInfo } from "@playwright/test";
import {
  buildFunctionalFailureEvidence,
  redactEvidence,
  type FunctionalFailureEvidence,
  type FunctionalFailureEvidenceInput,
} from "../../apps/web/lib/testing/functional-evidence";

export async function attachFunctionalFailureEvidence(
  testInfo: TestInfo,
  input: FunctionalFailureEvidenceInput,
) {
  const evidence = redactEvidence(buildFunctionalFailureEvidence(input));
  const outputPath = join(testInfo.outputDir, "functional-failure-evidence.json");

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(evidence, null, 2), "utf8");
  testInfo.attachments.push({
    name: "functional-failure-evidence",
    contentType: "application/json",
    path: outputPath,
  });

  if (process.env.DPF_RECORD_FUNCTIONAL_FAILURES === "1") {
    await publishFunctionalFailureEvidence(evidence);
  }

  return evidence;
}

async function publishFunctionalFailureEvidence(evidence: FunctionalFailureEvidence) {
  const config = await readMcpConfig();
  if (!config) {
    throw new Error("DPF_RECORD_FUNCTIONAL_FAILURES=1 but no DPF MCP config was found");
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: config.authorization,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `functional-failure-${evidence.testId}`,
      method: "tools/call",
      params: {
        name: "record_functional_failure_evidence",
        arguments: evidence,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Functional evidence MCP publish failed with HTTP ${response.status}`);
  }

  const payload = await response.json() as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
  if (payload.result?.isError) {
    throw new Error(payload.result.content?.[0]?.text ?? "Functional evidence MCP publish failed");
  }
}

async function readMcpConfig(): Promise<{ url: string; authorization: string } | null> {
  const explicitUrl = process.env.DPF_MCP_URL;
  const explicitToken = process.env.DPF_MCP_TOKEN;
  if (explicitUrl && explicitToken) {
    return {
      url: explicitUrl,
      authorization: explicitToken.startsWith("Bearer ") ? explicitToken : `Bearer ${explicitToken}`,
    };
  }

  const raw = await readFile(".mcp.json", "utf8").catch(() => null);
  if (!raw) return null;

  const parsed = JSON.parse(raw) as {
    mcpServers?: { dpf?: { url?: string; headers?: { Authorization?: string } } };
  };
  const server = parsed.mcpServers?.dpf;
  if (!server?.url || !server.headers?.Authorization) return null;

  return { url: server.url, authorization: server.headers.Authorization };
}
