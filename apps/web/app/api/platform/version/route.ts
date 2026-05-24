import { NextResponse } from "next/server";
import { loadPlatformVersion } from "@/lib/platform/version";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Public read of the canonical platform version. No auth — the install's
 * version is not sensitive. See spec §4.1, §5.1.
 */
export async function GET() {
  const v = await loadPlatformVersion();
  return NextResponse.json(
    {
      version: v.version,
      publishedAt: v.publishedAt.toISOString(),
      gitSha: v.gitSha,
      note: v.note,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
