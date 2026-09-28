"use client";

import {
  History,
  LoaderCircle,
  MessageCircle,
  Plus,
  SendHorizontal,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

type ChatSession = {
  id: string;
  symbol: string;
  title: string;
  status: "idle" | "processing";
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview: string;
};

type ChatMessage = {
  id: string | number;
  turnId: string;
  role: "user" | "assistant";
  content: string;
  status: "pending" | "completed" | "failed";
  createdAt: string;
};

type SessionListResponse = {
  sessions: ChatSession[];
};

type SessionResponse = {
  session: ChatSession;
  messages: ChatMessage[];
};

type CreateSessionResponse = {
  session: ChatSession;
};

type MessageResponse = {
  session: ChatSession;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
};

type StockChatProps = {
  symbol: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class ChatRequestError extends Error {
  constructor(
    message: string,
    readonly responseBody: unknown
  ) {
    super(message);
    this.name = "ChatRequestError";
  }
}

function isMessageResponse(value: unknown): value is MessageResponse {
  return (
    isRecord(value) &&
    isRecord(value.session) &&
    isRecord(value.userMessage) &&
    isRecord(value.assistantMessage)
  );
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const message = isRecord(data) && typeof data.error === "string"
      ? data.error
      : `Chat request failed (${response.status}).`;
    throw new ChatRequestError(message, data);
  }

  return data as T;
}

function formatSessionTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function sortSessions(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((left, right) => {
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

function upsertSession(sessions: ChatSession[], session: ChatSession): ChatSession[] {
  return sortSessions([session, ...sessions.filter((item) => item.id !== session.id)]);
}

export function StockChat({ symbol }: StockChatProps) {
  const panelId = useId();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionRequestRef = useRef(0);
  const pollingRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [hasLoadedSessions, setHasLoadedSessions] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [sendError, setSendError] = useState("");

  const normalizedSymbol = symbol.trim().toUpperCase();
  const sessionsUrl = `/api/stocks/${encodeURIComponent(normalizedSymbol)}/chat/sessions`;
  const isAwaitingReply = isSending || currentSession?.status === "processing";
  const composerDisabled =
    !currentSession || isLoadingSession || isCreatingSession || isAwaitingReply;

  const loadSession = useCallback(
    async (sessionId: string, options: { silent?: boolean } = {}): Promise<SessionResponse | null> => {
      const requestId = ++sessionRequestRef.current;

      if (!options.silent) {
        setIsLoadingSession(true);
      }

      setSessionError("");

      try {
        const data = await requestJson<SessionResponse>(
          `${sessionsUrl}/${encodeURIComponent(sessionId)}`
        );

        if (requestId !== sessionRequestRef.current) {
          return null;
        }

        setSelectedSessionId(data.session.id);
        setCurrentSession(data.session);
        setMessages(data.messages);
        setSessions((current) => upsertSession(current, data.session));

        return data;
      } catch (error) {
        if (requestId === sessionRequestRef.current) {
          setSessionError(error instanceof Error ? error.message : "Unable to load this chat.");
        }

        return null;
      } finally {
        if (!options.silent && requestId === sessionRequestRef.current) {
          setIsLoadingSession(false);
        }
      }
    },
    [sessionsUrl]
  );

  const loadSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    setSessionsError("");

    try {
      const data = await requestJson<SessionListResponse>(sessionsUrl);
      const nextSessions = sortSessions(data.sessions);
      setSessions(nextSessions);
      setHasLoadedSessions(true);

      const selectedStillExists = selectedSessionId
        ? nextSessions.some((session) => session.id === selectedSessionId)
        : false;

      if (!selectedStillExists) {
        const firstSession = nextSessions[0];

        if (firstSession) {
          await loadSession(firstSession.id);
        } else {
          setSelectedSessionId(null);
          setCurrentSession(null);
          setMessages([]);
        }
      }
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : "Unable to load chat history.");
    } finally {
      setHasLoadedSessions(true);
      setIsLoadingSessions(false);
    }
  }, [loadSession, selectedSessionId, sessionsUrl]);

  const createSession = useCallback(async () => {
    if (
      !hasLoadedSessions ||
      isLoadingSessions ||
      isAwaitingReply ||
      isCreatingSession
    ) {
      return;
    }

    setIsCreatingSession(true);
    setSessionsError("");
    setSessionError("");
    setSendError("");

    try {
      const data = await requestJson<CreateSessionResponse>(sessionsUrl, {
        method: "POST",
      });
      sessionRequestRef.current += 1;
      setSessions((current) => upsertSession(current, data.session));
      setSelectedSessionId(data.session.id);
      setCurrentSession(data.session);
      setMessages([]);
      setDraft("");
      setHasLoadedSessions(true);
      setView("chat");
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : "Unable to create a new chat.");
    } finally {
      setIsCreatingSession(false);
    }
  }, [
    hasLoadedSessions,
    isAwaitingReply,
    isCreatingSession,
    isLoadingSessions,
    sessionsUrl,
  ]);

  const sendMessage = useCallback(async () => {
    const content = draft.trim();

    if (!content || !currentSession || composerDisabled) {
      return;
    }

    const sessionId = currentSession.id;
    const turnId = globalThis.crypto.randomUUID();
    const optimisticMessage: ChatMessage = {
      id: `optimistic-${turnId}`,
      turnId,
      role: "user",
      content,
      status: "completed",
      createdAt: new Date().toISOString(),
    };

    setDraft("");
    setSendError("");
    setSessionError("");
    setIsSending(true);
    setMessages((current) => [...current, optimisticMessage]);
    setCurrentSession((current) => current ? { ...current, status: "processing" } : current);

    try {
      const data = await requestJson<MessageResponse>(
        `${sessionsUrl}/${encodeURIComponent(sessionId)}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ turnId, content }),
        }
      );

      setMessages((current) => [
        ...current.filter((message) => message.turnId !== turnId),
        data.userMessage,
        data.assistantMessage,
      ]);
      setCurrentSession(data.session);
      setSessions((current) => upsertSession(current, data.session));

      if (data.assistantMessage.status === "failed") {
        setSendError(data.assistantMessage.content || "The AI could not answer this message.");
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The AI could not answer this message.";
      const failedResponse =
        error instanceof ChatRequestError &&
        isMessageResponse(error.responseBody)
          ? error.responseBody
          : null;

      if (failedResponse) {
        setMessages((current) => [
          ...current.filter((chatMessage) => chatMessage.turnId !== turnId),
          failedResponse.userMessage,
          failedResponse.assistantMessage,
        ]);
        setCurrentSession(failedResponse.session);
        setSessions((current) =>
          upsertSession(current, failedResponse.session)
        );
      } else {
        const reloaded = await loadSession(sessionId, { silent: true });
        const turnWasPersisted = reloaded?.messages.some(
          (chatMessage) => chatMessage.turnId === turnId
        );

        if (!turnWasPersisted) {
          setDraft(content);
        }
      }

      setSendError(message);
    } finally {
      setIsSending(false);
    }
  }, [composerDisabled, currentSession, draft, loadSession, sessionsUrl]);

  function closePanel(): void {
    setIsOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function submitMessage(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void sendMessage();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
  }

  useEffect(() => {
    if (isOpen && !hasLoadedSessions && !isLoadingSessions) {
      void loadSessions();
    }
  }, [hasLoadedSessions, isLoadingSessions, isOpen, loadSessions]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        closePanel();
      }
    };

    window.addEventListener("keydown", handleEscape);
    window.requestAnimationFrame(() => panelRef.current?.focus());

    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && view === "chat" && currentSession && !composerDisabled) {
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [composerDisabled, currentSession?.id, isOpen, view]);

  useEffect(() => {
    if (isOpen && view === "chat") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [isAwaitingReply, isOpen, messages, view]);

  useEffect(() => {
    if (
      !isOpen ||
      view !== "chat" ||
      !currentSession ||
      currentSession.status !== "processing" ||
      isSending
    ) {
      return;
    }

    const sessionId = currentSession.id;
    const interval = window.setInterval(() => {
      if (pollingRef.current) {
        return;
      }

      pollingRef.current = true;
      void loadSession(sessionId, { silent: true }).finally(() => {
        pollingRef.current = false;
      });
    }, 2_000);

    return () => {
      window.clearInterval(interval);
      pollingRef.current = false;
    };
  }, [currentSession, isOpen, isSending, loadSession, view]);

  const hasPendingAssistant = messages.some(
    (message) => message.role === "assistant" && message.status === "pending"
  );

  return (
    <>
      {!isOpen ? (
        <button
          aria-controls={panelId}
          aria-expanded="false"
          aria-label={`Open chat about ${normalizedSymbol}`}
          className="fixed bottom-4 right-4 z-50 inline-flex h-12 items-center gap-2 rounded-lg bg-[#161615] px-4 text-sm font-semibold text-white shadow-2xl transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 sm:bottom-5 sm:right-5"
          onClick={() => setIsOpen(true)}
          ref={triggerRef}
          type="button"
        >
          {isAwaitingReply ? (
            <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin text-emerald-300" />
          ) : (
            <MessageCircle aria-hidden="true" className="h-5 w-5 text-emerald-300" />
          )}
          <span>{isAwaitingReply ? "AI replying…" : `Ask about ${normalizedSymbol}`}</span>
        </button>
      ) : (
        <section
          aria-labelledby={titleId}
          aria-modal="false"
          className="fixed inset-x-2 bottom-2 z-50 flex h-[min(42rem,calc(100dvh-1rem))] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl focus:outline-none sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[min(42rem,calc(100dvh-2.5rem))] sm:w-[26rem]"
          id={panelId}
          ref={panelRef}
          role="dialog"
          tabIndex={-1}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 bg-[#161615] px-4 py-3 text-white">
            <div className="min-w-0">
              <h2 className="truncate font-semibold" id={titleId}>
                {view === "history" ? "Chat history" : `${normalizedSymbol} assistant`}
              </h2>
              <p className="truncate text-xs text-zinc-400">
                {view === "history" ? `${normalizedSymbol} sessions` : "Uses the current stock view"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                aria-label={view === "history" ? "Return to current chat" : "View chat history"}
                aria-pressed={view === "history"}
                className="rounded-md p-2 text-zinc-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={isAwaitingReply}
                onClick={() => setView((current) => current === "chat" ? "history" : "chat")}
                title={view === "history" ? "Current chat" : "Chat history"}
                type="button"
              >
                <History aria-hidden="true" className="h-4 w-4" />
              </button>
              <button
                aria-label={`Start a new ${normalizedSymbol} chat`}
                className="rounded-md p-2 text-zinc-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={
                  !hasLoadedSessions ||
                  isLoadingSessions ||
                  isAwaitingReply ||
                  isCreatingSession
                }
                onClick={() => void createSession()}
                title="New chat"
                type="button"
              >
                {isCreatingSession ? (
                  <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus aria-hidden="true" className="h-4 w-4" />
                )}
              </button>
              <button
                aria-label="Close chat"
                className="rounded-md p-2 text-zinc-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                onClick={closePanel}
                title="Close chat"
                type="button"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </header>

          {view === "history" ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
              {sessionsError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
                  <p>{sessionsError}</p>
                  <button
                    className="mt-2 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                    onClick={() => void loadSessions()}
                    type="button"
                  >
                    Try again
                  </button>
                </div>
              ) : null}

              {isLoadingSessions && sessions.length === 0 ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500" role="status">
                  <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
                  Loading chats…
                </div>
              ) : sessions.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <History aria-hidden="true" className="h-8 w-8 text-zinc-300" />
                  <p className="mt-3 font-semibold text-zinc-950">No chats for {normalizedSymbol} yet</p>
                  <p className="mt-1 text-sm leading-6 text-zinc-500">Start a session to ask about this stock view.</p>
                  <button
                    className="mt-4 inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                    disabled={isCreatingSession}
                    onClick={() => void createSession()}
                    type="button"
                  >
                    <Plus aria-hidden="true" className="h-4 w-4" />
                    New chat
                  </button>
                </div>
              ) : (
                <nav aria-label={`${normalizedSymbol} chat sessions`} className="space-y-2">
                  {sessions.map((session) => {
                    const isSelected = session.id === selectedSessionId;

                    return (
                      <button
                        aria-current={isSelected ? "true" : undefined}
                        className={`w-full rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 ${
                          isSelected
                            ? "border-emerald-300 bg-emerald-50"
                            : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50"
                        }`}
                        disabled={isAwaitingReply || isLoadingSession}
                        key={session.id}
                        onClick={() => {
                          setView("chat");
                          void loadSession(session.id);
                        }}
                        type="button"
                      >
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-zinc-950">
                              {session.title || "New chat"}
                            </span>
                            <span className="mt-1 block truncate text-xs text-zinc-500">
                              {session.lastMessagePreview || "No messages yet"}
                            </span>
                          </span>
                          {session.status === "processing" ? (
                            <LoaderCircle aria-label="AI response pending" className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-600" />
                          ) : null}
                        </span>
                        <span className="mt-2 flex items-center justify-between gap-3 text-xs text-zinc-400">
                          <span>{session.messageCount} {session.messageCount === 1 ? "message" : "messages"}</span>
                          <span>{formatSessionTime(session.updatedAt)}</span>
                        </span>
                      </button>
                    );
                  })}
                </nav>
              )}
            </div>
          ) : (
            <>
              <div
                aria-busy={isAwaitingReply}
                aria-live="polite"
                aria-relevant="additions text"
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-zinc-50 p-4"
                role="log"
              >
                {sessionsError ? (
                  <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
                    <p>{sessionsError}</p>
                    <button
                      className="mt-2 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                      onClick={() => void loadSessions()}
                      type="button"
                    >
                      Try again
                    </button>
                  </div>
                ) : null}

                {sessionError ? (
                  <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
                    <p>{sessionError}</p>
                    {selectedSessionId ? (
                      <button
                        className="mt-2 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                        onClick={() => void loadSession(selectedSessionId)}
                        type="button"
                      >
                        Try again
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {isLoadingSession ? (
                  <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500" role="status">
                    <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
                    Loading messages…
                  </div>
                ) : !currentSession ? (
                  <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                    <MessageCircle aria-hidden="true" className="h-9 w-9 text-emerald-500" />
                    <p className="mt-3 font-semibold text-zinc-950">Ask about {normalizedSymbol}</p>
                    <p className="mt-1 text-sm leading-6 text-zinc-500">
                      The assistant will use the quote, recent captures, documents, and analyses on this view.
                    </p>
                    <button
                      className="mt-4 inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isCreatingSession}
                      onClick={() => void createSession()}
                      type="button"
                    >
                      {isCreatingSession ? (
                        <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus aria-hidden="true" className="h-4 w-4" />
                      )}
                      New chat
                    </button>
                  </div>
                ) : messages.length === 0 && !isAwaitingReply ? (
                  <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                    <MessageCircle aria-hidden="true" className="h-9 w-9 text-emerald-500" />
                    <p className="mt-3 font-semibold text-zinc-950">New {normalizedSymbol} chat</p>
                    <p className="mt-1 text-sm leading-6 text-zinc-500">
                      Ask a question about anything currently shown on this stock page.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((message) => {
                      const isUser = message.role === "user";
                      const isFailed = message.status === "failed";
                      const content = message.content || (message.status === "pending" ? "Thinking…" : "No response was returned.");

                      return (
                        <article
                          aria-label={`${isUser ? "You" : "Signal Desk"}, ${formatSessionTime(message.createdAt)}`}
                          className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                          key={message.id}
                        >
                          <div
                            className={`max-w-[88%] rounded-lg px-3 py-2.5 text-sm shadow-sm ${
                              isUser
                                ? "bg-emerald-600 text-white"
                                : isFailed
                                  ? "border border-red-200 bg-red-50 text-red-800"
                                  : "border border-zinc-200 bg-white text-zinc-800"
                            }`}
                          >
                            <div className={`mb-1 text-xs font-semibold ${isUser ? "text-emerald-100" : isFailed ? "text-red-600" : "text-zinc-500"}`}>
                              {isUser ? "You" : "Signal Desk"}
                            </div>
                            <p className="whitespace-pre-wrap break-words leading-6">{content}</p>
                            <div className={`mt-1.5 text-[11px] ${isUser ? "text-emerald-100" : isFailed ? "text-red-500" : "text-zinc-400"}`}>
                              {message.status === "pending" ? "Replying…" : formatSessionTime(message.createdAt)}
                            </div>
                          </div>
                        </article>
                      );
                    })}

                    {isAwaitingReply && !hasPendingAssistant ? (
                      <div className="flex justify-start" role="status">
                        <div className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-600 shadow-sm">
                          <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin text-emerald-600" />
                          Analyzing {normalizedSymbol}…
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
                <div aria-hidden="true" ref={messagesEndRef} />
              </div>

              <form className="shrink-0 border-t border-zinc-200 bg-white p-3" onSubmit={submitMessage}>
                {sendError ? (
                  <div className="mb-2 flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
                    <span>{sendError}</span>
                    <button
                      aria-label="Dismiss chat error"
                      className="shrink-0 rounded p-0.5 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                      onClick={() => setSendError("")}
                      type="button"
                    >
                      <X aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
                <div className="flex items-end gap-2">
                  <textarea
                    aria-label={`Message the assistant about ${normalizedSymbol}`}
                    className="max-h-32 min-h-11 flex-1 resize-none rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm leading-5 text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
                    disabled={composerDisabled}
                    maxLength={4_000}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    placeholder={
                      !currentSession
                        ? "Create a chat to start"
                        : isAwaitingReply
                          ? "Waiting for the AI reply…"
                          : `Ask about ${normalizedSymbol}…`
                    }
                    ref={textareaRef}
                    rows={2}
                    value={draft}
                  />
                  <button
                    aria-label="Send message"
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-zinc-300"
                    disabled={composerDisabled || !draft.trim()}
                    title="Send message"
                    type="submit"
                  >
                    {isAwaitingReply ? (
                      <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
                    ) : (
                      <SendHorizontal aria-hidden="true" className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-zinc-400">Enter to send · Shift+Enter for a new line</p>
              </form>
            </>
          )}
        </section>
      )}
    </>
  );
}
