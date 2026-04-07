import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/constants";
import { handleChatRequest, resolveChatRequest } from "@/server/api/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const body = await request.json();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const wantsStream = request.headers.get("x-chat-stream") === "true";

    if (!wantsStream) {
      const response = await handleChatRequest(sessionToken, body);
      return NextResponse.json(response);
    }

    const resolved = resolveChatRequest(sessionToken, body);
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        void (async () => {
          const writeChunk = (payload: unknown) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
          };

          try {
            const response = await resolved.deps.agentService.runChatStream(
              resolved.session,
              resolved.message,
              (delta) => {
                if (!delta) {
                  return;
                }

                writeChunk({ type: "delta", delta });
              },
            );

            writeChunk({ type: "final", response });
            controller.close();
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Chat request failed.";
            writeChunk({ type: "error", error: message });
            controller.close();
          }
        })();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat request failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
