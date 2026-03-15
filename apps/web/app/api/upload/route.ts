import { auth } from "@/lib/auth";
import { handleFileUpload } from "@/lib/file-upload";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const threadId = formData.get("threadId") as string | null;
  if (!file || !threadId) return NextResponse.json({ error: "file and threadId required" }, { status: 400 });

  const result = await handleFileUpload(file, threadId, session.user.id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
