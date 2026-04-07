import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/constants";
import { handleCompleteActionRequest } from "@/server/api/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const cookieStore = await cookies();
    const body = await request.json();
    const { id } = await params;
    const response = await handleCompleteActionRequest(
      cookieStore.get(SESSION_COOKIE_NAME)?.value,
      id,
      body,
    );

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action completion failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
