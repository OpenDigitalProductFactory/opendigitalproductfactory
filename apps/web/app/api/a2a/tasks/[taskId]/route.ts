import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/error";
import { readCoworkerA2aTask } from "@/lib/coworker-service-catalog/a2a-tasks";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { taskId } = await context.params;
  const task = await readCoworkerA2aTask(taskId);
  if (!task) return apiErrorResponse("NOT_FOUND", "Task not found", 404);
  return NextResponse.json(task);
}
