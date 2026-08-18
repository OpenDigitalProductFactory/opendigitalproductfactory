import { inngest } from "../inngest-client";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function buildGitPromotionVerificationScript(input: {
  repositoryCloneUrl: string;
  afterSha: string;
  candidateId: string;
}): string {
  const targetDir = `/workspace/git-promotion-${input.candidateId}`;
  return [
    "set -euo pipefail",
    `rm -rf ${shellQuote(targetDir)}`,
    `git clone --depth 1 ${shellQuote(input.repositoryCloneUrl)} ${shellQuote(targetDir)}`,
    `cd ${shellQuote(targetDir)}`,
    `git fetch --depth 1 origin ${shellQuote(input.afterSha)}`,
    `git checkout --detach ${shellQuote(input.afterSha)}`,
    "pnpm install --frozen-lockfile",
    "pnpm --filter @dpf/db exec prisma generate --schema prisma/schema",
    "pnpm --filter web typecheck",
    "pnpm --filter web exec next build",
  ].join("\n");
}

export const gitPromotionSandboxVerification = inngest.createFunction(
  {
    id: "build/git-promotion-sandbox-verification",
    retries: 0,
    concurrency: [{ limit: 1, scope: "fn" }],
    triggers: [{ event: "build/git-update.received" }],
  },
  async ({ event, step }) => {
    const { candidateId } = event.data as { candidateId: string };

    const candidate = await step.run("load-candidate", async () => {
      const { prisma } = await import("@dpf/db");
      return prisma.gitPromotionCandidate.findUnique({
        where: { candidateId },
        select: {
          candidateId: true,
          status: true,
          repositoryFullName: true,
          repositoryCloneUrl: true,
          afterSha: true,
          branch: true,
        },
      });
    });

    if (!candidate) return { skipped: true, reason: "candidate not found" };
    if (candidate.status !== "queued") {
      return { skipped: true, reason: `candidate status is ${candidate.status}` };
    }
    if (!candidate.repositoryCloneUrl || !candidate.afterSha) {
      await step.run("mark-missing-input", async () => {
        const { prisma } = await import("@dpf/db");
        await prisma.gitPromotionCandidate.update({
          where: { candidateId },
          data: {
            status: "failed",
            statusReason: "Missing clone URL or after SHA.",
            verificationCompletedAt: new Date(),
          },
        });
      });
      return { failed: true, reason: "missing clone URL or after SHA" };
    }

    const repositoryCloneUrl = candidate.repositoryCloneUrl;
    const afterSha = candidate.afterSha;
    const { getBuildExecutionProvider } = await import("@/lib/integrate/sandbox/providers");
    const provider = getBuildExecutionProvider("local-docker");

    await step.run("mark-running", async () => {
      const { prisma } = await import("@dpf/db");
      await prisma.gitPromotionCandidate.update({
        where: { candidateId },
        data: {
          status: "sandbox-verification-running",
          sandboxProviderId: provider.id,
          verificationStartedAt: new Date(),
        },
      });
    });

    const handle = await step.run("create-sandbox", async () => {
      try {
        const handle = await provider.createSandbox({
          buildId: candidateId,
          title: `Git update ${candidate.repositoryFullName}@${afterSha.slice(0, 12)}`,
        });
        await provider.startSandbox(handle);
        const { prisma } = await import("@dpf/db");
        await prisma.gitPromotionCandidate.update({
          where: { candidateId },
          data: { sandboxId: handle.id },
        });
        return handle;
      } catch (err) {
        const { prisma } = await import("@dpf/db");
        await prisma.gitPromotionCandidate.update({
          where: { candidateId },
          data: {
            status: "failed",
            statusReason: `Sandbox provisioning failed: ${err instanceof Error ? err.message : String(err)}`,
            verificationCompletedAt: new Date(),
          },
        });
        throw err;
      }
    });

    const verification = await step.run("run-sandbox-build", async () => {
      const script = buildGitPromotionVerificationScript({
        repositoryCloneUrl,
        afterSha,
        candidateId,
      });
      return provider.exec(handle, ["sh", "-lc", shellQuote(script)], {
        timeoutMs: 30 * 60 * 1000,
      });
    });

    const success = verification.exitCode === 0;
    await step.run("persist-result", async () => {
      const { prisma } = await import("@dpf/db");
      await prisma.gitPromotionCandidate.update({
        where: { candidateId },
        data: {
          status: success ? "sandbox-verification-complete" : "failed",
          statusReason: success ? null : "Sandbox verification failed.",
          verificationCompletedAt: new Date(),
          verificationResult: {
            exitCode: verification.exitCode,
            stdout: verification.stdout.slice(-12000),
            stderr: verification.stderr.slice(-12000),
            durationMs: verification.durationMs,
            repositoryFullName: candidate.repositoryFullName,
            branch: candidate.branch,
            afterSha: candidate.afterSha,
          },
        },
      });
    });

    await step.run("destroy-sandbox", async () => {
      await provider.destroySandbox(handle).catch(() => undefined);
    });

    return {
      status: success ? "sandbox-verification-complete" : "failed",
      exitCode: verification.exitCode,
    };
  },
);
