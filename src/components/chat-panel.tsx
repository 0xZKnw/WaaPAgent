"use client";

import { Fragment } from "react";
import type { KeyboardEvent } from "react";
import { useState } from "react";

import type { ChatMessage } from "@/lib/types";

interface ChatPanelProps {
  busy: boolean;
  streaming: boolean;
  streamingMessage: string;
  messages: ChatMessage[];
  onSend: (message: string) => Promise<void> | void;
}

function renderMessageContent(content: string) {
  return content.split("\n").map((line, lineIndex) => {
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
        {lineIndex < content.split("\n").length - 1 ? <br /> : null}
      </Fragment>
    );
  });
}

export function ChatPanel({
  busy,
  streaming,
  streamingMessage,
  messages,
  onSend,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");

  async function submit() {
    const value = draft.trim();

    if (!value || busy) {
      return;
    }

    setDraft("");

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
      <div className="panel-header">
        <div>
          <p className="eyebrow">Agent channel</p>
          <h2 className="section-title">Wallet copilot</h2>
        </div>
      </div>

      <div className="chat-log">
        {messages.length === 0 ? (
          <div className="empty-state">
            <p>Ask for your balance, preview a transfer, or swap ETH and USDC on Sepolia.</p>
            <p>&quot;What is my balance?&quot;</p>
            <p>&quot;Prepare 0.01 ETH to 0x...&quot;</p>
            <p>&quot;Send 0.005 ETH to 0x...&quot;</p>
            <p>&quot;Swap 0.01 ETH to USDC&quot;</p>
          </div>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              className={`bubble ${message.role === "assistant" ? "bubble-assistant" : "bubble-user"}`}
            >
              <p className="bubble-role">{message.role === "assistant" ? "Agent" : "You"}</p>
              <p>{renderMessageContent(message.content)}</p>
            </article>
          ))
        )}
        {streaming ? (
          <article className="bubble bubble-assistant bubble-streaming">
            <p className="bubble-role">Agent</p>
            {streamingMessage ? (
              <p>{renderMessageContent(streamingMessage)}</p>
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
          placeholder="Ask for balance, prepare a transfer, or tell the agent to send."
          rows={4}
        />
        <button className="primary-button" onClick={submit} disabled={busy}>
          {busy ? "Thinking..." : "Send message"}
        </button>
      </div>
    </section>
  );
}
