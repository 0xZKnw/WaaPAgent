import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/constants";
import { handleAuthVerifyRequest } from "@/server/api/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { session, walletContext } = await handleAuthVerifyRequest(body);
    const cookieStore = await cookies();

    cookieStore.set(SESSION_COOKIE_NAME, session.sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: new Date(session.expiresAt),
    });

    return NextResponse.json({
      success: true,
      address: session.address,
      expiresAt: new Date(session.expiresAt).toISOString(),
      walletContext,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify signature.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
