"use client";

import { Fragment, useState } from "react";
import type { KeyboardEvent } from "react";

import type { AgentToolTraceItem, ChatMessage } from "@/lib/types";

type DisplayChatMessage = ChatMessage & {
  toolTrace?: AgentToolTraceItem[];
};

interface ChatPanelProps {
  busy: boolean;
  streaming: boolean;
  streamingMessage: string;
  streamingToolTrace: AgentToolTraceItem[];
  messages: DisplayChatMessage[];
  suggestions: string[];
  onSend: (message: string) => Promise<void> | void;
}

function renderMessageContent(content: string) {
  const lines = content.split("\n");

  return lines.map((line, lineIndex) => {
    const segments = line.split(/(\*\*[^*]+\*\*)/g);

    return (
      <Fragment key={`${line}-${lineIndex}`}>
        {segments.map((segment, segmentIndex) => {
          const isBold = segment.startsWith("**") && segment.endsWith("**") && segment.length > 4;

          if (isBold) {
            return <strong key={`${segment}-${segmentIndex}`}>{segment.slice(2, -2)}</strong>;
          }

          return <Fragment key={`${segment}-${segmentIndex}`}>{segment}</Fragment>;
        })}
        {lineIndex < lines.length - 1 ? <br /> : null}
      </Fragment>
    );
  });
}

function renderToolTrace(items: AgentToolTraceItem[], live = false) {
  if (!items.length) {
    return null;
  }

  const visibleItems = live ? items.slice(-3) : items;

  return (
    <section className={`tool-trace ${live ? "tool-trace-live" : ""}`}>
      <div className="tool-trace-header">
        <span>{live ? "Agent activity" : "Resolution path"}</span>
        <strong>
          {items.some((item) => item.status === "running")
            ? "Working"
            : `${items.length} step${items.length > 1 ? "s" : ""}`}
        </strong>
      </div>
      <div className="tool-trace-list">
        {visibleItems.map((item, index) => (
          <article key={item.id} className={`tool-trace-item tool-trace-${item.status}`}>
            <span className="tool-trace-rail" aria-hidden="true">
              <span className="tool-trace-dot" />
              {index < visibleItems.length - 1 ? <span className="tool-trace-line" /> : null}
            </span>
            <div className="tool-trace-copy">
              <div className="tool-trace-title-row">
                <strong>{item.label}</strong>
                <em className="tool-trace-status">
                  {item.status === "running"
                    ? "Running"
                    : item.status === "completed"
                      ? "Done"
                      : "Issue"}
                </em>
              </div>
              {item.detail ? <p>{item.detail}</p> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ChatPanel({
  busy,
  streaming,
  streamingMessage,
  streamingToolTrace,
  messages,
  suggestions,
  onSend,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");

  async function submit(prefilled?: string) {
    const value = (prefilled ?? draft).trim();

    if (!value || busy) {
      return;
    }

    if (!prefilled) {
      setDraft("");
    }

    try {
      await onSend(value);
    } catch {
      // The mutation layer already records the error in-chat.
    }
  }

  async function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    await submit();
  }

  return (
    <section className="panel chat-panel">
      <div className="panel-header chat-header">
        <div>
          <p className="eyebrow">Agent channel</p>
          <h2 className="section-title">Wallet copilot</h2>
          <p className="micro-copy chat-header-copy">
            Ask naturally, or use the quick prompts to inspect, swap, and prepare actions faster.
          </p>
        </div>
      </div>

      <div className="suggestion-row">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="suggestion-chip"
            disabled={busy}
            onClick={() => submit(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <div className="chat-log">
        {messages.length === 0 ? (
          <div className="empty-state">
            <p>Your wallet is live. The copilot can inspect balances, route swaps, and prepare NFT moves.</p>
            <p>Use the tabs on the right for direct actions, or ask in chat.</p>
          </div>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              className={`bubble ${message.role === "assistant" ? "bubble-assistant" : "bubble-user"}`}
            >
              <p className="bubble-role">{message.role === "assistant" ? "Agent" : "You"}</p>
              <p>{renderMessageContent(message.content)}</p>
              {message.role === "assistant" ? renderToolTrace(message.toolTrace ?? []) : null}
            </article>
          ))
        )}
        {streaming ? (
          <article className="bubble bubble-assistant bubble-streaming">
            <p className="bubble-role">Agent</p>
            {renderToolTrace(streamingToolTrace, true)}
            {streamingMessage ? (
              <p>
                {renderMessageContent(streamingMessage)}
                <span className="stream-cursor" aria-hidden="true" />
              </p>
            ) : (
              <div className="thinking-indicator" aria-label="Agent is thinking">
                <span />
                <span />
                <span />
              </div>
            )}
          </article>
        ) : null}
      </div>

      <div className="composer">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask for balance, preview a transfer, inspect NFTs, or prepare a swap."
          rows={4}
        />
        <div className="composer-footer">
          <p className="micro-copy">Enter sends. Shift+Enter adds a new line.</p>
          <button className="primary-button" onClick={() => submit()} disabled={busy}>
            {busy ? "Thinking..." : "Send message"}
          </button>
        </div>
      </div>
    </section>
  );
}
