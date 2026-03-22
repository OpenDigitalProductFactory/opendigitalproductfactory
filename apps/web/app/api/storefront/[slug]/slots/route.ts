import { NextRequest, NextResponse } from "next/server";
import { computeAvailableSlots } from "@/lib/slot-engine";
import { validateItemOwnership } from "@/lib/slot-engine/validate-item";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const { searchParams } = req.nextUrl;
  const itemId = searchParams.get("itemId");
  const date = searchParams.get("date"); // "YYYY-MM-DD"
  const providerId = searchParams.get("providerId") ?? undefined;
  const holderToken = searchParams.get("holderToken") ?? undefined;

  if (!itemId || !date) {
    return NextResponse.json(
      { error: "itemId and date are required" },
      { status: 400 }
    );
  }

  if (!(await validateItemOwnership(slug, itemId))) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  try {
    const result = await computeAvailableSlots(itemId, date, {
      ...(providerId ? { providerId } : {}),
      ...(holderToken ? { holderToken } : {}),
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
