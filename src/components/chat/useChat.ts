"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { withBasePath } from "@/lib/base-path";
import type { ChatContextRef, ChatMessage, ChatSession, ChatStatus, ChatStreamEvent, ChatTraceEvent } from "@/lib/chat/types";
import { consumeNdjsonStream, mergeTraceEvent } from "./stream";

export interface UseChatOptions {
  chatId?: string | null;
}

export interface UseChatResult {
  session: ChatSession | null;
  liveTrace: ChatTraceEvent[];
  liveDraft: string;
  status: ChatStatus;
  error: string | null;
  send: (prompt: string, context?: ChatContextRef) => Promise<void>;
  stop: () => void;
  chatId: string | null;
}

async function fetchChatSession(url: string): Promise<ChatSession> {
  const response = await fetch(withBasePath(url), { cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<ChatSession>;
}

function pendingMessage(prompt: string): ChatMessage {
  return {
    id: `pending-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    content: prompt,
    timestamp: Date.now(),
  };
}

function optimisticSession(chatId: string, message: ChatMessage): ChatSession {
  return {
    id: chatId,
    context: { kind: "none" },
    contextLabel: "",
    title: "New chat",
    claudeSessionId: null,
    messages: [message],
    status: "sending",
    archivedAt: null,
    unreadCount: 0,
    createdAt: message.timestamp,
    updatedAt: message.timestamp,
  };
}

export function useChat(options: UseChatOptions): UseChatResult {
  const [capturedChatId, setCapturedChatId] = useState<string | null>(options.chatId ?? null);
  const [pendingUserMessage, setPendingUserMessage] = useState<ChatMessage | null>(null);
  const [liveTrace, setLiveTrace] = useState<ChatTraceEvent[]>([]);
  const [liveDraft, setLiveDraft] = useState("");
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const chatIdRef = useRef<string | null>(options.chatId ?? null);
  const statusRef = useRef<ChatStatus>("idle");
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const next = options.chatId ?? null;
    setCapturedChatId(next);
    chatIdRef.current = next;
    setPendingUserMessage(null);
    setLiveTrace([]);
    setLiveDraft("");
    setError(null);
  }, [options.chatId]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const swrKey = capturedChatId ? `/api/chat/sessions/${capturedChatId}` : null;
  const { data: serverSession } = useSWR<ChatSession>(
    swrKey,
    fetchChatSession,
    { keepPreviousData: true },
  );

  const session = useMemo(() => {
    if (!pendingUserMessage) return serverSession ?? null;
    const base = serverSession ?? (capturedChatId ? optimisticSession(capturedChatId, pendingUserMessage) : null);
    if (!base) return null;
    const alreadyPersisted = base.messages.some((message) =>
      message.id === pendingUserMessage.id
      || (message.role === "user"
        && message.content === pendingUserMessage.content
        && message.timestamp >= pendingUserMessage.timestamp));
    if (alreadyPersisted) return base;
    return { ...base, messages: [...base.messages, pendingUserMessage] };
  }, [capturedChatId, pendingUserMessage, serverSession]);

  const send = useCallback(async (prompt: string, context?: ChatContextRef) => {
    if (statusRef.current === "sending") return;
    const trimmed = prompt.trim();
    if (!trimmed) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const optimisticUser = pendingMessage(trimmed);
    statusRef.current = "sending";
    setStatus("sending");
    setError(null);
    setLiveTrace([]);
    setLiveDraft("");
    setPendingUserMessage(optimisticUser);

    try {
      const body = {
        ...(chatIdRef.current ? { chatId: chatIdRef.current } : {}),
        ...(context ? { context } : {}),
        prompt: trimmed,
      };
      const response = await fetch(withBasePath("/api/chat/message"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || `Request failed: ${response.status}`);
      }

      await consumeNdjsonStream<ChatStreamEvent>(response, (event) => {
        if (event.type === "session") {
          chatIdRef.current = event.chatId;
          setCapturedChatId(event.chatId);
          return;
        }
        if (event.type === "trace") {
          setLiveTrace((current) => mergeTraceEvent(current, event.trace));
          return;
        }
        if (event.type === "message") {
          setLiveDraft((current) => current + event.content);
          return;
        }
        if (event.type === "error" && !controller.signal.aborted) {
          setError(event.error);
        }
      });
    } catch (err) {
      if (!controller.signal.aborted && !(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "Chat request failed");
      }
    } finally {
      const finalChatId = chatIdRef.current;
      if (finalChatId) {
        await globalMutate(`/api/chat/sessions/${finalChatId}`).catch(() => undefined);
      }
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      setPendingUserMessage(null);
      setLiveTrace([]);
      setLiveDraft("");
      statusRef.current = "idle";
      setStatus("idle");
    }
  }, []);

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  return {
    session,
    liveTrace,
    liveDraft,
    status,
    error,
    send,
    stop,
    chatId: capturedChatId,
  };
}
