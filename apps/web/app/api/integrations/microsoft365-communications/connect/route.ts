import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { connectMicrosoft365Communications } from "@/lib/integrate/microsoft365-communications/connect-action";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "manage_provider_connections",
    )
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const result = await connectMicrosoft365Communications(body);

  if (result.ok) {
    return NextResponse.json(
      {
        status: result.status,
        tenantDisplayName: result.tenantDisplayName,
        mailboxDisplayName: result.mailboxDisplayName,
        lastTestedAt: result.lastTestedAt,
      },
      { status: 200 },
    );
  }

  return NextResponse.json(
    { error: result.error, status: result.status },
    { status: result.statusCode },
  );
}
