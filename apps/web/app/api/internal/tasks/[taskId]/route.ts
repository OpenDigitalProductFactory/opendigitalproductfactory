import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { taskId } = await context.params;
  const task = await prisma.taskRun.findFirst({
    where: {
      taskRunId: taskId,
      ...(session.user.isSuperuser ? {} : { userId: session.user.id }),
    },
    select: {
      taskRunId: true,
      contextId: true,
      status: true,
      title: true,
      objective: true,
      routeContext: true,
      source: true,
      initiatingAgentId: true,
      currentAgentId: true,
      parentTaskRunId: true,
      authorityScope: true,
      a2aMetadata: true,
      progressPayload: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        select: {
          messageId: true,
          contextId: true,
          role: true,
          parts: true,
          metadata: true,
          referenceTaskIds: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
      artifacts: {
        select: {
          artifactId: true,
          name: true,
          description: true,
          parts: true,
          metadata: true,
          producerAgentId: true,
          producerNodeId: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!task) {
    return new Response("Not Found", { status: 404 });
  }

  return Response.json({
    task: {
      taskId: task.taskRunId,
      contextId: task.contextId,
      state: task.status,
      title: task.title,
      objective: task.objective,
      routeContext: task.routeContext,
      source: task.source,
      initiatingAgentId: task.initiatingAgentId,
      currentAgentId: task.currentAgentId,
      parentTaskId: task.parentTaskRunId,
      authorityScope: task.authorityScope,
      a2aMetadata: task.a2aMetadata,
      progressPayload: task.progressPayload,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      messages: task.messages,
      artifacts: task.artifacts,
    },
  });
}
