import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/constants";
import { handleConfirmActionRequest } from "@/server/api/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const cookieStore = await cookies();
    const { id } = await params;
    const response = await handleConfirmActionRequest(
      cookieStore.get(SESSION_COOKIE_NAME)?.value,
      id,
    );

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action confirmation failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
