import { NextResponse } from "next/server";

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
  if (!task) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(task);
}
