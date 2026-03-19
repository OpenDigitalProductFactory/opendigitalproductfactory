/**
 * EP-INF-001-P6: Golden test sets for dimension evaluation.
 * Each dimension has ~10 deterministic prompts with verifiable expected outputs.
 * These are the primary authority for capability scores.
 */
import type { BuiltinDimension } from "./types";

export type ScoringMethod =
  | "exact"        // exact string match
  | "partial"      // partial credit (correct/partial/wrong)
  | "orchestrator" // LLM-graded 1-5, scaled to 0-100
  | "structural"   // AST/pattern-based code analysis
  | "schema"       // JSON schema conformance
  | "tool_call"    // tool call structure validation
  | "retrieval";   // needle-in-haystack extraction

export interface GoldenTest {
  id: string;
  version: number;
  dimension: BuiltinDimension;
  prompt: string;
  systemPrompt?: string;
  tools?: Array<Record<string, unknown>>;
  expectedSchema?: Record<string, unknown>;
  scoring: ScoringMethod;
  expectedOutput?: string;
  maxTokens?: number;
}

// ── Reasoning Tests ──────────────────────────────────────────────────────────

const REASONING_TESTS: GoldenTest[] = [
  {
    id: "reasoning-001",
    version: 1,
    dimension: "reasoning",
    prompt: "A farmer has 17 sheep. All but 9 die. How many sheep does the farmer have left?",
    scoring: "exact",
    expectedOutput: "9",
    maxTokens: 100,
  },
  {
    id: "reasoning-002",
    version: 1,
    dimension: "reasoning",
    prompt: "If it takes 5 machines 5 minutes to make 5 widgets, how long would it take 100 machines to make 100 widgets?",
    scoring: "exact",
    expectedOutput: "5 minutes",
    maxTokens: 150,
  },
  {
    id: "reasoning-003",
    version: 1,
    dimension: "reasoning",
    prompt: "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?",
    scoring: "exact",
    expectedOutput: "$0.05",
    maxTokens: 150,
  },
  {
    id: "reasoning-004",
    version: 1,
    dimension: "reasoning",
    prompt: "Three people check into a hotel room that costs $30. They each pay $10. The manager realizes the room costs $25, so gives $5 to the bellboy to return. The bellboy keeps $2 and gives each person $1 back. Each person paid $9 (total $27), the bellboy has $2. That's $29. Where is the missing dollar?",
    scoring: "partial",
    expectedOutput: "There is no missing dollar. The $27 paid includes the $25 for the room plus the $2 the bellboy kept.",
    maxTokens: 300,
  },
  {
    id: "reasoning-005",
    version: 1,
    dimension: "reasoning",
    prompt: "In a race, you overtake the person in second place. What position are you in now?",
    scoring: "exact",
    expectedOutput: "second",
    maxTokens: 100,
  },
];

// ── Instruction Following Tests ──────────────────────────────────────────────

const INSTRUCTION_FOLLOWING_TESTS: GoldenTest[] = [
  {
    id: "instfollow-001",
    version: 1,
    dimension: "instructionFollowing",
    prompt: "List exactly 3 benefits of exercise. Use bullet points. Do not include an introduction or conclusion.",
    systemPrompt: "You must follow the user's formatting instructions exactly.",
    scoring: "partial",
    expectedOutput: "3 bullet points, no intro, no conclusion",
    maxTokens: 200,
  },
  {
    id: "instfollow-002",
    version: 1,
    dimension: "instructionFollowing",
    prompt: "Respond with exactly the word 'CONFIRMED' and nothing else.",
    scoring: "exact",
    expectedOutput: "CONFIRMED",
    maxTokens: 10,
  },
  {
    id: "instfollow-003",
    version: 1,
    dimension: "instructionFollowing",
    prompt: "Write a haiku about databases. It must have exactly 3 lines with 5, 7, and 5 syllables respectively.",
    scoring: "partial",
    expectedOutput: "3 lines, approximately 5-7-5 syllables",
    maxTokens: 100,
  },
  {
    id: "instfollow-004",
    version: 1,
    dimension: "instructionFollowing",
    prompt: "Answer in JSON format only: What are the three primary colors? Use the key 'colors' with an array value.",
    scoring: "schema",
    expectedSchema: {
      type: "object",
      properties: { colors: { type: "array", items: { type: "string" } } },
      required: ["colors"],
    },
    maxTokens: 100,
  },
  {
    id: "instfollow-005",
    version: 1,
    dimension: "instructionFollowing",
    prompt: "Respond in exactly 2 sentences. The first sentence must start with 'Yes' and the second with 'However'. Topic: remote work.",
    scoring: "partial",
    expectedOutput: "2 sentences, first starts with Yes, second starts with However",
    maxTokens: 150,
  },
];

// ── Tool Fidelity Tests ──────────────────────────────────────────────────────

const TOOL_FIDELITY_TESTS: GoldenTest[] = [
  {
    id: "toolfidelity-001",
    version: 1,
    dimension: "toolFidelity",
    prompt: "Create a new backlog item titled 'Fix login timeout' with status 'open'.",
    tools: [
      {
        type: "function",
        function: {
          name: "create_backlog_item",
          description: "Create a new backlog item",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              status: { type: "string", enum: ["open", "in-progress", "done"] },
            },
            required: ["title", "status"],
          },
        },
      },
    ],
    scoring: "tool_call",
    expectedOutput: "create_backlog_item",
    maxTokens: 200,
  },
  {
    id: "toolfidelity-002",
    version: 1,
    dimension: "toolFidelity",
    prompt: "What is the weather like today?",
    tools: [
      {
        type: "function",
        function: {
          name: "create_backlog_item",
          description: "Create a new backlog item",
          parameters: {
            type: "object",
            properties: { title: { type: "string" }, status: { type: "string" } },
            required: ["title", "status"],
          },
        },
      },
    ],
    scoring: "tool_call",
    expectedOutput: "__ABSTAIN__",
    maxTokens: 200,
  },
  {
    id: "toolfidelity-003",
    version: 1,
    dimension: "toolFidelity",
    prompt: "Search the web for 'TypeScript 5.5 release notes' and summarize the key features.",
    tools: [
      {
        type: "function",
        function: {
          name: "web_search",
          description: "Search the web for information",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "create_backlog_item",
          description: "Create a new backlog item",
          parameters: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
          },
        },
      },
    ],
    scoring: "tool_call",
    expectedOutput: "web_search",
    maxTokens: 200,
  },
];

// ── Structured Output Tests ──────────────────────────────────────────────────

const STRUCTURED_OUTPUT_TESTS: GoldenTest[] = [
  {
    id: "structout-001",
    version: 1,
    dimension: "structuredOutput",
    prompt: "Return a JSON object with fields: name (string), age (number), active (boolean). Use realistic values.",
    scoring: "schema",
    expectedSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        active: { type: "boolean" },
      },
      required: ["name", "age", "active"],
    },
    maxTokens: 100,
  },
  {
    id: "structout-002",
    version: 1,
    dimension: "structuredOutput",
    prompt: "Return a JSON array of exactly 3 objects, each with 'id' (number) and 'label' (string) fields.",
    scoring: "schema",
    expectedSchema: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "number" }, label: { type: "string" } },
        required: ["id", "label"],
      },
      minItems: 3,
      maxItems: 3,
    },
    maxTokens: 200,
  },
  {
    id: "structout-003",
    version: 1,
    dimension: "structuredOutput",
    systemPrompt: "Always respond in valid JSON. No markdown, no explanation.",
    prompt: "Classify the sentiment of 'I love this product!' as positive, negative, or neutral. Return {\"text\": \"...\", \"sentiment\": \"...\"}",
    scoring: "schema",
    expectedSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
      },
      required: ["text", "sentiment"],
    },
    maxTokens: 100,
  },
];

// ── Conversational Tests ─────────────────────────────────────────────────────

const CONVERSATIONAL_TESTS: GoldenTest[] = [
  {
    id: "convo-001",
    version: 1,
    dimension: "conversational",
    prompt: "Hi! How are you today?",
    scoring: "orchestrator",
    maxTokens: 200,
  },
  {
    id: "convo-002",
    version: 1,
    dimension: "conversational",
    prompt: "Can you explain what you can help me with in simple terms? I'm not very technical.",
    scoring: "orchestrator",
    maxTokens: 300,
  },
  {
    id: "convo-003",
    version: 1,
    dimension: "conversational",
    prompt: "I just said I don't want to use that approach. Why are you suggesting it again?",
    systemPrompt: "The user previously rejected using microservices. You suggested microservices anyway.",
    scoring: "orchestrator",
    maxTokens: 200,
  },
];

// ── Codegen Tests ────────────────────────────────────────────────────────────

const CODEGEN_TESTS: GoldenTest[] = [
  {
    id: "codegen-001",
    version: 1,
    dimension: "codegen",
    prompt: "Write a TypeScript function called `isPalindrome` that takes a string and returns true if it's a palindrome (case-insensitive, ignoring spaces and punctuation).",
    scoring: "structural",
    expectedOutput: "function isPalindrome",
    maxTokens: 500,
  },
  {
    id: "codegen-002",
    version: 1,
    dimension: "codegen",
    prompt: "Write a TypeScript function called `groupBy` that takes an array of objects and a key name, and returns an object where each key is a unique value of that property and the value is an array of matching objects.",
    scoring: "structural",
    expectedOutput: "function groupBy",
    maxTokens: 500,
  },
  {
    id: "codegen-003",
    version: 1,
    dimension: "codegen",
    prompt: "Write a TypeScript function called `debounce` that takes a function and a delay in milliseconds, and returns a debounced version.",
    scoring: "structural",
    expectedOutput: "function debounce",
    maxTokens: 500,
  },
];

// ── Context Retention Tests ──────────────────────────────────────────────────

const CONTEXT_RETENTION_TESTS: GoldenTest[] = [
  {
    id: "context-001",
    version: 1,
    dimension: "contextRetention",
    systemPrompt: "You are helping a user with project planning. The user previously told you: 'Our project codename is Phoenix, we're targeting Q3 launch, and the budget is $2.5M.' Remember all details they've shared.",
    prompt: "What was the project codename I mentioned?",
    scoring: "retrieval",
    expectedOutput: "Phoenix",
    maxTokens: 50,
  },
  {
    id: "context-002",
    version: 1,
    dimension: "contextRetention",
    systemPrompt: "You are a technical consultant. The user has shared the following context across your conversation: 'My team has 7 developers. We primarily use Rust for our backend. Our main database is PostgreSQL. We deploy to AWS us-east-1. Our CI runs on GitHub Actions.' Answer questions about what the user has told you.",
    prompt: "How many developers are on my team and what language do we use?",
    scoring: "retrieval",
    expectedOutput: "7 developers, Rust",
    maxTokens: 100,
  },
];

// ── Public Registry ──────────────────────────────────────────────────────────

export const GOLDEN_TESTS: GoldenTest[] = [
  ...REASONING_TESTS,
  ...INSTRUCTION_FOLLOWING_TESTS,
  ...TOOL_FIDELITY_TESTS,
  ...STRUCTURED_OUTPUT_TESTS,
  ...CONVERSATIONAL_TESTS,
  ...CODEGEN_TESTS,
  ...CONTEXT_RETENTION_TESTS,
];

/** Get golden tests for a specific dimension. */
export function getTestsForDimension(dimension: BuiltinDimension): GoldenTest[] {
  return GOLDEN_TESTS.filter((t) => t.dimension === dimension);
}
