import { OpenRouter } from "@openrouter/agent";

import { env } from "@/lib/env";

export function createOpenRouterClient() {
  if (!env.OPENROUTER_API_KEY) {
    return null;
  }

  return new OpenRouter({
    apiKey: env.OPENROUTER_API_KEY,
    httpReferer: env.OPENROUTER_HTTP_REFERER,
    appTitle: env.OPENROUTER_APP_TITLE,
    timeoutMs: env.OPENROUTER_TIMEOUT_MS,
  });
}
