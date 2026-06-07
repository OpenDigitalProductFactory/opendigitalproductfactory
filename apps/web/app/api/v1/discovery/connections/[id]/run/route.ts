import { rerunDiscoveryConnection } from "@/lib/actions/discovery";
import { NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_req: Request, context: RouteContext) {
  const { id } = await context.params;
  const result = await rerunDiscoveryConnection(id);

  if (!result.ok) {
    const status = result.error === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(result);
}
