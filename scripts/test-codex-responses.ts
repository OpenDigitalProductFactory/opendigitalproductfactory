/**
 * Test script: verify Codex/ChatGPT backend Responses API works with reasoning effort.
 *
 * Usage: npx tsx scripts/test-codex-responses.ts
 *
 * No Prisma dependency — reads the token directly via psql.
 */

import { execSync } from "child_process";
import * as crypto from "crypto";

function decrypt(stored: string): string {
  // Legacy plaintext
  if (!stored.startsWith("enc:")) return stored;
  // Format: enc:base64iv:base64tag:base64data
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY ?? "dpf-dev-encryption-key-change-me!!";
  const keyBuffer = Buffer.alloc(32);
  Buffer.from(key).copy(keyBuffer);
  const parts = stored.split(":");
  if (parts.length !== 4) throw new Error("Bad encrypted format");
  const iv = Buffer.from(parts[1]!, "base64");
  const tag = Buffer.from(parts[2]!, "base64");
  const data = Buffer.from(parts[3]!, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuffer, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final("utf8");
}

function getOAuthToken(): string {
  const result = execSync(
    `docker compose exec -T postgres psql -U dpf dpf -t -A -c "SELECT \\"cachedToken\\" FROM \\"CredentialEntry\\" WHERE \\"providerId\\" IN ('codex','chatgpt') AND \\"cachedToken\\" IS NOT NULL LIMIT 1;"`,
    { encoding: "utf8", cwd: process.cwd() },
  ).trim();
  if (!result) throw new Error("No OAuth token found. Connect Codex in Platform > AI first.");
  return decrypt(result);
}

async function testResponsesApi(
  token: string,
  label: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  console.log(`\n--- Test: ${label} ---`);
  console.log(`  model=${body.model}, reasoning=${JSON.stringify(body.reasoning ?? "NOT SET")}, tools=${(body.tools as unknown[])?.length ?? 0}`);

  const res = await fetch("https://chatgpt.com/backend-api/codex/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.log(`  FAIL: HTTP ${res.status}`);
    console.log(`  ${(await res.text().catch(() => "")).slice(0, 300)}`);
    return false;
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
    } catch { /* skip malformed SSE */ }
  }

  const output = (lastCompleted?.output as unknown[]) ?? [];
  const reasoningEffort = (lastCompleted as any)?.reasoning?.effort ?? "unknown";

  if (output.length === 0 && !textDelta && funcCalls.length === 0) {
    console.log(`  FAIL: Empty response. reasoning.effort=${reasoningEffort}, SSE lines=${lines.length}`);
    return false;
  } else {
    console.log(`  OK: output=${output.length} items, text=${textDelta.length} chars, tools=[${funcCalls.join(",")}], reasoning.effort=${reasoningEffort}`);
    if (textDelta) console.log(`  Response: "${textDelta.slice(0, 150)}"`);
    return true;
  }
}

async function main() {
  console.log("Retrieving OAuth token from DB...");
  const token = getOAuthToken();
  console.log("Token retrieved.\n");

  const input = [{ role: "user", content: "Say hello in one sentence." }];
  let passed = 0;
  let failed = 0;

  // Test 1: No reasoning effort (expected: FAIL — the bug)
  const t1 = await testResponsesApi(token, "gpt-5.3-codex WITHOUT reasoning effort (BUG)", {
    model: "gpt-5.3-codex",
    input,
    instructions: "You are a helpful assistant.",
    store: false,
    stream: true,
  });
  if (!t1) { console.log("  ^ Expected failure (this is the bug)"); passed++; } else failed++;

  // Test 2: With reasoning.effort = "low" (expected: OK — the fix)
  const t2 = await testResponsesApi(token, "gpt-5.3-codex WITH reasoning.effort=low (FIX)", {
    model: "gpt-5.3-codex",
    input,
    instructions: "You are a helpful assistant.",
    reasoning: { effort: "low" },
    store: false,
    stream: true,
  });
  if (t2) passed++; else failed++;

  // Test 3: gpt-5.4 with reasoning
  const t3 = await testResponsesApi(token, "gpt-5.4 WITH reasoning.effort=low", {
    model: "gpt-5.4",
    input,
    instructions: "You are a helpful assistant.",
    reasoning: { effort: "low" },
    store: false,
    stream: true,
  });
  if (t3) passed++; else failed++;

  // Test 4: Tools + reasoning
  const t4 = await testResponsesApi(token, "gpt-5.4 WITH tools + reasoning.effort=medium", {
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
        properties: {
          content: { type: "string", description: "The note content" },
        },
        required: ["content"],
      },
    }],
    store: false,
    stream: true,
  });
  if (t4) passed++; else failed++;

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
