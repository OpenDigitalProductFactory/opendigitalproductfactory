"use server";

import { auth } from "@/lib/auth";
import {
  getCodeGraphFreshness,
  type CodeGraphFreshness,
} from "@/lib/build/code-graph-access";

export async function getCodeGraphFreshnessAction(): Promise<CodeGraphFreshness> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      graphKey: "source-code",
      available: false,
      indexStatus: "unauthorized",
      lastIndexedAt: null,
      lastIndexedBranch: null,
      lastIndexedHeadSha: null,
      workspaceDirty: false,
      indexedFileCount: 0,
      lastError: null,
      warnings: ["Sign in to view code graph status."],
      summary: "Sign in to view code graph status.",
    };
  }

  return getCodeGraphFreshness();
}
