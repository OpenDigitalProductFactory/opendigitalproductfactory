import { NextRequest, NextResponse } from "next/server";
import { getAvailableDates } from "@/lib/slot-engine";
import { validateItemOwnership } from "@/lib/slot-engine/validate-item";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const { searchParams } = req.nextUrl;
  const itemId = searchParams.get("itemId");
  const month = searchParams.get("month"); // "YYYY-MM"

  if (!itemId || !month) {
    return NextResponse.json(
      { error: "itemId and month are required" },
      { status: 400 }
    );
  }

  if (!(await validateItemOwnership(slug, itemId))) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  try {
    const dates = await getAvailableDates(itemId, month);
    return NextResponse.json({ dates });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
