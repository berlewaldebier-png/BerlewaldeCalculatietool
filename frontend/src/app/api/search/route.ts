import { NextRequest, NextResponse } from "next/server";
import { createSearchResponse } from "@/lib/search";

export async function GET(request: NextRequest) {
  const q = String(request.nextUrl.searchParams.get("q") ?? "").trim();
  const mode = String(request.nextUrl.searchParams.get("mode") ?? "dropdown") as "dropdown" | "full";
  const scope = request.nextUrl.searchParams.get("scope") as any;

  return NextResponse.json(createSearchResponse(q, { mode, scope }));
}
