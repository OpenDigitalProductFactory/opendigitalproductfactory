import { NextRequest, NextResponse } from "next/server";
import { detectEmailType, EmailType } from "@/lib/storefront-auth";

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  if (!email) return NextResponse.json({ type: "unknown" });
  const type = await detectEmailType(email);
  // Never reveal employee status to unauthenticated callers
  const safeType = type === EmailType.Employee ? EmailType.Unknown : type;
  return NextResponse.json({ type: safeType });
}
