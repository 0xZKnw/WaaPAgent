import { NextResponse } from "next/server";

import { handleAuthChallengeRequest } from "@/server/api/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const challenge = await handleAuthChallengeRequest(body);
    return NextResponse.json(challenge);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create challenge.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
