// BI-8213E88B — codegen prompt guidance must never contradict the enforced
// UI guards or advertise utilities the Tailwind v4 setup does not generate.
// The drift shipped once (shadow-dpf-*/animate-fade-in taught as "tokens",
// hand-rolled animate-pulse skeletons taught while the guard bans them);
// this test makes the reconciliation permanent.
import { describe, expect, it, vi } from "vitest";

// specialist-prompts.ts pulls the DB-backed prompt loader (and transitively
// the generated Prisma client) only for buildSpecialistPrompt; this test
// reads the static prompt record, so stub the loader seam.
vi.mock("@/lib/tak/prompt-loader", () => ({ loadPrompt: vi.fn() }));

import { SPECIALIST_PROMPTS } from "./specialist-prompts";

const FRONTEND_ENGINEER_PROMPT = SPECIALIST_PROMPTS["frontend-engineer"];

describe("specialist prompt vs enforced-guard consistency (BI-8213E88B)", () => {
  it("does not advertise utilities the Tailwind v4 setup never generates", () => {
    // These classes only exist in the stale v3 tailwind.config.ts (unread by
    // v4 — no @config directive) and silently no-op at runtime. Teaching
    // them is allowed only inside an explicit do-NOT-use warning.
    for (const dead of ["shadow-dpf-xs", "shadow-dpf-sm", "shadow-dpf-md"]) {
      expect(FRONTEND_ENGINEER_PROMPT).not.toContain(`- ${dead}`);
    }
    expect(FRONTEND_ENGINEER_PROMPT).not.toMatch(/animate-(fade-in|slide-up|scale-in) \(\d+ms/);
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
