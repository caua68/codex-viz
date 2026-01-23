import { NextResponse } from "next/server";
import { getIndex } from "@/lib/indexer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const index = await getIndex();
  return NextResponse.json(index);
}

