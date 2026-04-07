import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/constants";
import { handlePermissionGrantRequest } from "@/server/api/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const body = await request.json();
    const response = await handlePermissionGrantRequest(
      cookieStore.get(SESSION_COOKIE_NAME)?.value,
      body,
    );

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Permission grant failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
