/**
 * Test: Agent message persistence
 * Directly tests the /api/agent/send endpoint to check if responses are saved.
 */
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@dpf.local";
const ADMIN_PASSWORD = process.env.DPF_ADMIN_PASSWORD || "N7YY1tktO9JOndnJ";

async function getAuthHeaders(page: any) {
  // Navigate and check for cookies
  await page.goto("http://localhost:3000");
  const cookies = await page.context().cookies();
  const sessionToken = cookies.find(c => c.name === "authjs.session-token");

  return {
    "Cookie": `authjs.session-token=${sessionToken?.value || ""}`,
    "Content-Type": "application/json",
  };
}

test("Agent: Message response should be saved to database", async ({ page, context }) => {
  test.setTimeout(120_000);

  // Get auth headers
  const headers = await getAuthHeaders(page);

  // 1. Create a test thread via API
  const createThreadRes = await page.request.post("http://localhost:3000/api/agent/thread", {
    headers,
    data: { routeContext: "/build" },
  });

  expect(createThreadRes.ok()).toBeTruthy();
  const threadData = await createThreadRes.json() as any;
  const threadId = threadData.threadId;

  console.log(`[test] Created thread: ${threadId}`);

  // 2. Send a test message
  const sendRes = await page.request.post("http://localhost:3000/api/agent/send", {
    headers,
    data: {
      threadId,
      content: "Hello, can you help me understand what Build Studio does?",
      routeContext: "/build",
      coworkerMode: "advise",
    },
  });

  expect(sendRes.ok()).toBeTruthy();
  const sendData = await sendRes.json() as any;
  console.log(`[test] Message sent: ${JSON.stringify(sendData)}`);

  // 3. Wait for the SSE "done" event
  console.log("[test] Waiting for agent response...");
  await page.waitForTimeout(5_000); // Give the agent time to process

  // 4. Poll for the response in the database
  let attempt = 0;
  let messages: any[] = [];
  while (attempt < 20) {
    const getRes = await page.request.get(
      `http://localhost:3000/api/agent/thread?threadId=${threadId}`,
      { headers },
    );

    if (getRes.ok()) {
      const data = await getRes.json() as any;
      messages = data.messages || [];
      console.log(`[test] Poll ${attempt + 1}: Found ${messages.length} messages`);

      // Check if we have an assistant response
      const hasAssistantMsg = messages.some((m: any) => m.role === "assistant");
      if (hasAssistantMsg) {
        console.log("[test] ✓ Agent response found!");
        break;
      }
    }

    await page.waitForTimeout(1_000);
    attempt++;
  }

  // 5. Verify the response exists
  const userMsgs = messages.filter((m: any) => m.role === "user");
  const assistantMsgs = messages.filter((m: any) => m.role === "assistant");

  console.log(`[test] User messages: ${userMsgs.length}, Assistant messages: ${assistantMsgs.length}`);

  expect(userMsgs.length).toBeGreaterThan(0);
  expect(assistantMsgs.length).toBeGreaterThan(0);

  // 6. Verify our original message is in the response
  expect(messages.some((m: any) => m.content.includes("Build Studio"))).toBeTruthy();

  console.log("[test] ✓ TEST PASSED: Message persisted correctly");
});
