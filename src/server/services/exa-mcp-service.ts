import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { env } from "@/lib/env";

const EXA_CLIENT_NAME = "waap-agent-exa-client";
const EXA_CLIENT_VERSION = "0.1.0";
const EXA_REQUEST_TIMEOUT_MS = 15_000;
const MAX_EXA_TEXT_LENGTH = 8_000;

type ExaToolName = "web_search_exa" | "web_fetch_exa";

interface ExaSourceLink {
  title: string;
  url: string;
  description?: string;
}

interface ExaToolResponse {
  text: string;
  sources: ExaSourceLink[];
  structuredContent: Record<string, unknown> | null;
}

interface ExaToolResultLike {
  content?: Array<Record<string, unknown>>;
  structuredContent?: Record<string, unknown>;
  toolResult?: unknown;
}

function truncateText(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 16)).trimEnd()}\n\n[truncated]`;
}

function toExaToolResultLike(result: unknown): ExaToolResultLike {
  if (!result || typeof result !== "object") {
    return {};
  }

  const candidate = result as Record<string, unknown>;

  return {
    content: Array.isArray(candidate.content)
      ? (candidate.content as Array<Record<string, unknown>>)
      : undefined,
    structuredContent:
      candidate.structuredContent &&
      typeof candidate.structuredContent === "object" &&
      !Array.isArray(candidate.structuredContent)
        ? (candidate.structuredContent as Record<string, unknown>)
        : undefined,
    toolResult: candidate.toolResult,
  };
}

function extractToolText(result: ExaToolResultLike) {
  const textParts: string[] = [];
  const sources: ExaSourceLink[] = [];

  for (const item of result.content ?? []) {
    if (item.type === "text" && typeof item.text === "string") {
      textParts.push(item.text.trim());
      continue;
    }

    if (
      item.type === "resource_link" &&
      typeof item.uri === "string" &&
      typeof item.name === "string"
    ) {
      sources.push({
        title: item.name,
        url: item.uri,
        description:
          typeof item.description === "string" ? item.description : undefined,
      });
      continue;
    }

    if (
      item.type === "resource" &&
      item.resource &&
      typeof item.resource === "object" &&
      "text" in item.resource &&
      typeof item.resource.text === "string"
    ) {
      textParts.push(item.resource.text.trim());
    }
  }

  const structuredText =
    !textParts.length && result.structuredContent
      ? JSON.stringify(result.structuredContent, null, 2)
      : !textParts.length && result.toolResult !== undefined
        ? JSON.stringify(result.toolResult, null, 2)
        : "";

  return {
    text: truncateText(
      [textParts.join("\n\n"), structuredText].filter(Boolean).join("\n\n").trim(),
      MAX_EXA_TEXT_LENGTH,
    ),
    sources,
    structuredContent: result.structuredContent ?? null,
  } satisfies ExaToolResponse;
}

function buildExaMcpUrl() {
  const url = new URL(env.EXA_MCP_URL);

  if (env.EXA_API_KEY && !url.searchParams.has("exaApiKey")) {
    url.searchParams.set("exaApiKey", env.EXA_API_KEY);
  }

  return url;
}

async function withExaClient<T>(run: (client: Client) => Promise<T>) {
  const transport = new StreamableHTTPClientTransport(buildExaMcpUrl(), {
    requestInit: {
      signal: AbortSignal.timeout(EXA_REQUEST_TIMEOUT_MS),
    },
  });

  const client = new Client(
    {
      name: EXA_CLIENT_NAME,
      version: EXA_CLIENT_VERSION,
    },
    {
      capabilities: {},
    },
  );

  try {
    await client.connect(transport);
    return await run(client);
  } finally {
    await transport.close().catch(() => undefined);
  }
}

export class ExaMcpService {
  async searchWeb(query: string, numResults = 5) {
    return this.callTool("web_search_exa", {
      query,
      numResults,
    });
  }

  async fetchWebPages(urls: string[], maxCharacters = 4_000) {
    return this.callTool("web_fetch_exa", {
      urls,
      maxCharacters,
    });
  }

  private async callTool(name: ExaToolName, args: Record<string, unknown>) {
    const result = await withExaClient((client) =>
      client.callTool({
        name,
        arguments: args,
      }),
    );

    const normalized = extractToolText(toExaToolResultLike(result));

    if (result.isError) {
      throw new Error(normalized.text || `Exa MCP tool ${name} failed.`);
    }

    return {
      tool: name,
      ...normalized,
    };
  }
}
