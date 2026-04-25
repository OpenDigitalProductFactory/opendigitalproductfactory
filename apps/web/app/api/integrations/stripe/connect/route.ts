import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { connectStripe } from "@/lib/integrate/stripe/connect-action";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "manage_provider_connections",
    )
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const result = await connectStripe(body);
  if (!result.ok) {
    return NextResponse.json(
      { status: result.status, error: result.error },
      { status: result.statusCode },
    );
  }

  return NextResponse.json({
    status: result.status,
    mode: result.mode,
    lastTestedAt: result.lastTestedAt,
  });
}
