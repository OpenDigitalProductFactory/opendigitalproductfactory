// BI-8213E88B — codegen prompt guidance must never contradict the enforced
// UI guards or advertise utilities the Tailwind v4 setup does not generate.
// The drift shipped once (shadow-dpf-*/animate-fade-in taught as "tokens",
// hand-rolled animate-pulse skeletons taught while the guard bans them);
// this test makes the reconciliation permanent.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// specialist-prompts.ts pulls the DB-backed prompt loader (and transitively
// the generated Prisma client) only for buildSpecialistPrompt; this test
// reads the static prompt record, so stub the loader seam.
vi.mock("@/lib/tak/prompt-loader", () => ({ loadPrompt: vi.fn() }));

import { loadPrompt } from "@/lib/tak/prompt-loader";
import {
  buildSpecialistPrompt,
  buildSpecialistPromptWithProvenance,
  SPECIALIST_PROMPTS,
} from "./specialist-prompts";

const FRONTEND_ENGINEER_PROMPT = SPECIALIST_PROMPTS["frontend-engineer"];

describe("specialist prompt vs enforced-guard consistency (BI-8213E88B)", () => {
  it("only advertises dpf utilities the generated token CSS actually defines", () => {
    // BI-CD81FF7C inverted this check. It used to be a hardcoded deny-list of
    // classes the stale v3 config declared and v4 never generated. Now that the
    // L0 scales are generated from design/tokens.json, the durable guard is
    // grounded in the generated output instead: every dpf utility the prompt
    // teaches must correspond to a real @theme entry. A deny-list would have to
    // be re-edited every time the scales grow; this cannot drift.
    const generated = readFileSync(
      resolve(__dirname, "../../app/tokens.generated.css"),
      "utf8",
    );
    // Utility class -> the @theme namespace that must define it.
    const NAMESPACE: Record<string, string> = {
      shadow: "--shadow-dpf-",
      rounded: "--radius-dpf-",
      animate: "--animate-dpf-",
      duration: "--duration-dpf-",
      ease: "--ease-dpf-",
    };
    const taught = FRONTEND_ENGINEER_PROMPT.matchAll(
      /\b(shadow|rounded|animate|duration|ease)-dpf-([a-z0-9-]+)/g,
    );
    const undefinedUtilities: string[] = [];
    for (const [utility, prefix, step] of taught) {
      if (!generated.includes(`${NAMESPACE[prefix]}${step}:`)) undefinedUtilities.push(utility);
    }
    expect(
      undefinedUtilities,
      `prompt teaches utilities with no @theme entry in tokens.generated.css:\n${undefinedUtilities.join("\n")}`,
    ).toEqual([]);
  });

  it("still refuses the pre-L0 spellings that never generated anything", () => {
    // The unprefixed animate-fade-in / animate-slide-up / animate-scale-in were
    // the v3-config ghosts. They are gone; the canonical spellings carry -dpf-.
    expect(FRONTEND_ENGINEER_PROMPT).not.toMatch(/\banimate-(fade-in|slide-up|scale-in)\b/);
  });

  it("does not teach hand-rolled loading patterns the CI guard blocks", () => {
    // check-no-hand-rolled-loading.mjs bans animate-spin/animate-pulse
    // outside components/ui; the prompt may only mention them to warn.
    const teachingLines = FRONTEND_ENGINEER_PROMPT.split("\n").filter(
      (line) =>
        /animate-(spin|pulse)/.test(line) &&
        !/never|blocked|do not|don't/i.test(line),
    );
    expect(teachingLines, `prompt teaches banned loading patterns:\n${teachingLines.join("\n")}`).toEqual([]);
  });

  it("routes loading states through the components/ui primitives", () => {
    expect(FRONTEND_ENGINEER_PROMPT).toContain("components/ui/Spinner");
    expect(FRONTEND_ENGINEER_PROMPT).toContain("components/ui/Skeleton");
  });
});

// BI-CE93E314. The specialist prompt concatenates the platform-authored role
// prompt with build state, the assigned task, and another specialist's output.
// Only the first is the brief; declaring more would let real values ride into a
// cloud provider inside the prompt.
describe("buildSpecialistPromptWithProvenance declares the role prompt only", () => {
  it("declares the role prompt", async () => {
    vi.mocked(loadPrompt).mockResolvedValue("ROLE: you implement engineering tasks.");

    const result = await buildSpecialistPromptWithProvenance({
      role: "software-engineer",
      taskDescription: "Add an endpoint.",
      buildContext: "BUILD STATE",
    });

    expect(result.instructionSpans).toHaveLength(1);
    expect(result.instructionSpans[0]).toContain("ROLE: you implement engineering tasks.");
    expect(result.text).toContain(result.instructionSpans[0]!);
  });

  it("does NOT declare build context, the task, or prior specialist output", async () => {
    vi.mocked(loadPrompt).mockResolvedValue("ROLE: you implement engineering tasks.");

    const result = await buildSpecialistPromptWithProvenance({
      role: "software-engineer",
      taskDescription: "Set Dana's salary to 125000.",
      buildContext: "BUILD STATE: invoice 88213",
      priorResults: "PRIOR: bank account 021000021",
    });

    const declared = result.instructionSpans.join("\n");
    expect(declared).not.toContain("125000");
    expect(declared).not.toContain("88213");
    expect(declared).not.toContain("021000021");
  });

  it("keeps buildSpecialistPrompt returning the same text", async () => {
    vi.mocked(loadPrompt).mockResolvedValue("ROLE: you implement engineering tasks.");
    const params = {
      role: "software-engineer" as const,
      taskDescription: "Add an endpoint.",
      buildContext: "BUILD STATE",
    };

    expect(await buildSpecialistPrompt(params))
      .toBe((await buildSpecialistPromptWithProvenance(params)).text);
  });
});
