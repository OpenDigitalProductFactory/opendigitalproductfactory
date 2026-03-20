import { NextRequest, NextResponse } from "next/server";
import { detectEmailType } from "@/lib/storefront-auth";

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  if (!email) return NextResponse.json({ type: "unknown" });
  const type = await detectEmailType(email);
  return NextResponse.json({ type });
}
