"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  chatSubtitle,
  chatTitle,
  historyChats,
  type Conversation,
} from "@/lib/conversations";
import { Icon } from "./icons";
import { PlanPanel } from "./plan-panel";
import { useConversations } from "./use-conversations";

type Status = {
  data: { ready: boolean; version?: string };
  modelReady: boolean;
  model: string;
};

function ChatNavigation({
  chats,
  activeId,
  newChat,
  select,
  remove,
  mobileClose,
}: {
  chats: Conversation[];
  activeId: string | null;
  newChat: () => void;
  select: (id: string) => void;
  remove: (id: string) => void;
  mobileClose?: () => void;
}) {
  const [search, setSearch] = useState("");
  const matches = chats.filter((chat) =>
    [chatTitle(chat), ...chat.messages.map((m) => m.text)].some((text) =>
      text.toLowerCase().includes(search.toLowerCase().trim()),
    ),
  );
  return (
    <nav className="chat-navigation" aria-label="Chat history">
      <div className="nav-top">
        {mobileClose && (
          <div className="drawer-heading">
            <span>Chats</span>
            <button
              className="icon-button"
              onClick={mobileClose}
              aria-label="Close chat history"
            >
              <Icon name="close" />
            </button>
          </div>
        )}
        <button className="new-chat" onClick={newChat}>
          <Icon name="compose" />
          New chat
        </button>
        {chats.length > 7 && (
          <label className="history-search">
            <Icon name="search" />
            <input
              type="search"
              aria-label="Search chats"
              placeholder="Search chats"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        )}
      </div>
      <div className="history-scroll">
        {chats.length > 0 && <p className="nav-label">Recent chats</p>}
        {matches.map((chat) => (
          <div
            className={`history-row${chat.id === activeId ? " active" : ""}`}
            key={chat.id}
          >
            <button
              className="history-link"
              onClick={() => select(chat.id)}
              aria-current={chat.id === activeId ? "page" : undefined}
              title={chatTitle(chat)}
            >
              <span>{chatTitle(chat)}</span>
              <small>{chatSubtitle(chat)}</small>
            </button>
            <details className="chat-actions">
              <summary
                className="icon-button"
                aria-label={`Actions for ${chatTitle(chat)}`}
              >
                <Icon name="more" />
              </summary>
              <div>
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete “${chatTitle(chat)}” from this browser?`,
                      )
                    )
                      remove(chat.id);
                  }}
                >
                  Delete chat
                </button>
              </div>
            </details>
          </div>
        ))}
        {chats.length > 0 && !matches.length && (
          <p className="muted small empty-history">No matching chats.</p>
        )}
      </div>
      <p className="history-footer">Saved in this browser</p>
    </nav>
  );
}

function MobileHistory({
  open,
  close,
  children,
  opener,
}: {
  open: boolean;
  close: () => void;
  children: React.ReactNode;
  opener: RefObject<HTMLButtonElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) {
      dialog.current?.close();
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    return () => {
      document.body.style.overflow = previousOverflow;
      dialog.current?.close();
      opener.current?.focus();
    };
  }, [open, opener]);
  return (
    <dialog
      ref={dialog}
      className="history-drawer"
      aria-label="Chat history"
      onCancel={close}
      onClose={close}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), summary, [tabindex="0"]',
          ),
        ].filter(
          (element) =>
            element.checkVisibility() &&
            (!element.closest("details:not([open])") ||
              element.tagName === "SUMMARY"),
        );
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX > box.right ||
            event.clientX < box.left ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            close();
        }
      }}
    >
      {children}
    </dialog>
  );
}

export default function Workspace({ examples }: { examples: string[] }) {
  const {
    state,
    chat,
    hydrated,
    storageNotice,
    dispatch,
    edit,
    submit,
    stop,
    newChat,
    removeChat,
  } = useConversations();
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const followMessages = useRef(true);
  const previousChat = useRef<string | null>(null);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const readStatus = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch("/api/status", { signal });
        if (!response.ok) throw new Error("Status unavailable");
        const next: Status = await response.json();
        if (signal?.aborted) return;
        setStatus(next);
        setStatusError(false);
        if (next.data.version)
          dispatch({ type: "evidence", version: next.data.version });
      } catch {
        if (!signal?.aborted) setStatusError(true);
      }
    },
    [dispatch],
  );
  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();
    void readStatus(controller.signal);
    return () => controller.abort();
  }, [hydrated, readStatus]);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 899px)");
    const sync = () => {
      setMobile(query.matches);
      if (!query.matches) setDrawerOpen(false);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (previousChat.current !== chat?.id) followMessages.current = true;
    previousChat.current = chat?.id ?? null;
    if (followMessages.current && log.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [chat?.id, chat?.messages.length, chat?.request]);
  useEffect(() => {
    if (composer.current) {
      composer.current.style.height = "auto";
      composer.current.style.height = `${Math.min(composer.current.scrollHeight, 160)}px`;
    }
  }, [chat?.composer, chat?.id, chat?.planOpen]);

  const focusComposer = () =>
    requestAnimationFrame(() => composer.current?.focus());
  function startChat() {
    newChat();
    setDrawerOpen(false);
    setShowExamples(false);
    focusComposer();
  }
  function selectChat(id: string) {
    dispatch({ type: "switch", id });
    setDrawerOpen(false);
    setShowExamples(false);
    requestAnimationFrame(() => {
      if (
        window.matchMedia("(max-width: 1199px)").matches &&
        state.chats.find((c) => c.id === id)?.planOpen
      )
        document.getElementById("plan-heading")?.focus();
      else composer.current?.focus();
    });
  }
  function openBrief() {
    if (!chat) return;
    dispatch({ type: "plan", id: chat.id, open: true });
    requestAnimationFrame(() =>
      document.getElementById("plan-heading")?.focus(),
    );
  }
  function closeBrief() {
    if (chat) dispatch({ type: "plan", id: chat.id, open: false });
    focusComposer();
  }
  const chats = historyChats(state);
  const hasBrief = chat && Object.values(chat.form).some(Boolean);
  const navigation = (isMobile = false) => (
    <ChatNavigation
      chats={chats}
      activeId={state.activeId}
      newChat={startChat}
      select={selectChat}
      remove={removeChat}
      mobileClose={isMobile ? closeDrawer : undefined}
    />
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-group">
          <button
            ref={opener}
            className="icon-button sidebar-toggle"
            aria-label={
              mobile
                ? "Open chat history"
                : state.sidebarOpen
                  ? "Collapse chat history"
                  : "Open chat history"
            }
            aria-expanded={mobile ? drawerOpen : state.sidebarOpen}
            aria-controls={mobile ? "mobile-history" : "desktop-history"}
            onClick={() =>
              mobile
                ? setDrawerOpen(true)
                : dispatch({ type: "sidebar", open: !state.sidebarOpen })
            }
          >
            <Icon name="sidebar" />
          </button>
          <img
            className="wordmark"
            src="/kargo-wordmark.svg"
            alt="Kargo"
            width="80"
            height="30"
          />
          <span className="brand-divider" />
          <span className="app-name">Media planner</span>
          <button
            className={`icon-button compact-new${state.sidebarOpen ? " desktop-hidden" : ""}`}
            onClick={startChat}
            aria-label="New chat"
            title="New chat"
          >
            <Icon name="compose" />
          </button>
        </div>
        {chat && (hasBrief || chat.planOpen || chat.messages.length > 0) && (
          <button
            className={`plan-toggle${chat.planOpen ? " selected" : ""}`}
            aria-expanded={chat.planOpen}
            onClick={chat.planOpen ? closeBrief : openBrief}
          >
            {chat.planOpen ? (
              <>
                <span className="wide-plan-label">Hide plan</span>
                <span className="narrow-plan-label">Back to chat</span>
              </>
            ) : chat.result?.recommendation ? (
              "View plan"
            ) : (
              "View brief"
            )}
            <Icon
              name="chevron"
              style={
                chat.planOpen ? { transform: "rotate(180deg)" } : undefined
              }
            />
          </button>
        )}
      </header>
      {storageNotice && (
        <div className="storage-notice" role="status">
          {storageNotice}
        </div>
      )}
      <div
        className={`workspace${state.sidebarOpen ? " sidebar-open" : ""}${chat?.planOpen ? " plan-open" : ""}`}
      >
        <aside
          id="desktop-history"
          className="desktop-history"
          hidden={!state.sidebarOpen}
        >
          {navigation()}
        </aside>
        <main className="work-area">
          <section
            className={`chat-pane${!chat?.messages.length ? " empty-chat" : ""}`}
            aria-label="Campaign conversation"
          >
            {!hydrated || !chat ? (
              <p className="loading-workspace" role="status">
                Opening your workspace…
              </p>
            ) : (
              <>
                <div
                  className="conversation-scroll"
                  ref={log}
                  onScroll={(event) => {
                    const el = event.currentTarget;
                    followMessages.current =
                      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                  }}
                >
                  {chat.messages.length === 0 ? (
                    <div className="welcome">
                      <p className="eyebrow">Kargo media planner</p>
                      <h1>What are we planning?</h1>
                      <p>
                        Tell me about your campaign.
                        <br />
                        We’ll fill in the details together.
                      </p>
                    </div>
                  ) : (
                    <div className="conversation-inner">
                      <h1 className="conversation-title">{chatTitle(chat)}</h1>
                      <div
                        role="log"
                        aria-label="Messages"
                        aria-live="polite"
                        aria-relevant="additions text"
                      >
                        {chat.messages.map((message) => (
                          <article
                            className={`message ${message.role}`}
                            key={message.id}
                            aria-label={
                              message.role === "user" ? "You" : "Media planner"
                            }
                          >
                            <span className="message-author">
                              {message.role === "user" ? "You" : "Kargo"}
                            </span>
                            {message.basedOnRevision !== undefined &&
                              message.basedOnRevision !== chat.revision && (
                                <span className="earlier-label">
                                  Earlier plan
                                </span>
                              )}
                            <p>{message.text}</p>
                            {message.role === "assistant" &&
                              message.basedOnRevision === chat.revision &&
                              chat.result?.recommendation && (
                                <button
                                  className="text-button inline-plan-link"
                                  onClick={openBrief}
                                >
                                  View your plan <Icon name="chevron" />
                                </button>
                              )}
                          </article>
                        ))}
                        {chat.request && (
                          <p className="working" role="status">
                            <span />
                            {chat.request.mode === "brief"
                              ? "Calculating your plan…"
                              : "Working on your brief…"}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="composer-area">
                  {chat.error && (
                    <p className="inline-error" role="alert">
                      {chat.error}
                    </p>
                  )}
                  {chat.result?.status === "error" && (
                    <button
                      className="text-button fallback-link"
                      onClick={openBrief}
                    >
                      Enter details manually <Icon name="chevron" />
                    </button>
                  )}
                  <form
                    className="composer"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submit("chat");
                    }}
                  >
                    <textarea
                      ref={composer}
                      aria-label="Message"
                      placeholder={
                        chat.messages.length
                          ? "Refine your brief or ask a follow-up…"
                          : "Describe your campaign…"
                      }
                      rows={2}
                      maxLength={4000}
                      value={chat.composer}
                      onChange={(event) =>
                        dispatch({
                          type: "draft",
                          id: chat.id,
                          value: event.target.value,
                          now: Date.now(),
                        })
                      }
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          !event.shiftKey &&
                          !event.nativeEvent.isComposing
                        ) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                    />
                    <div className="composer-bottom">
                      <span className="composer-hint">
                        {chat.composer.length > 3600
                          ? `${chat.composer.length} / 4,000`
                          : "A little context is enough to start"}
                      </span>
                      {chat.request ? (
                        <button
                          className="send-button"
                          type="button"
                          aria-label="Stop response"
                          title="Stop response"
                          onClick={() => stop(chat.id)}
                        >
                          <Icon name="stop" />
                        </button>
                      ) : (
                        <button
                          className="send-button"
                          type="submit"
                          aria-label="Send message"
                          title="Send message"
                          disabled={!chat.composer.trim()}
                        >
                          <Icon name="send" />
                        </button>
                      )}
                    </div>
                  </form>
                  <div className="composer-tools">
                    <button className="text-button" onClick={openBrief}>
                      {hasBrief ? "Review brief" : "Enter details manually"}
                    </button>
                    {examples.length > 0 && chat.messages.length === 0 && (
                      <button
                        className="text-button"
                        aria-expanded={showExamples}
                        onClick={() => setShowExamples(!showExamples)}
                      >
                        Try an example
                      </button>
                    )}
                  </div>
                  {showExamples && (
                    <div className="example-picker">
                      <label htmlFor="example-brief">Example brief</label>
                      <select
                        id="example-brief"
                        value=""
                        onChange={(event) => {
                          if (event.target.value) {
                            dispatch({
                              type: "draft",
                              id: chat.id,
                              value: event.target.value,
                              now: Date.now(),
                            });
                            setShowExamples(false);
                            focusComposer();
                          }
                        }}
                      >
                        <option value="">Choose an example…</option>
                        {examples.map((example, index) => (
                          <option key={index} value={example}>
                            {example}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {(statusError ||
                    status?.modelReady === false ||
                    status?.data.ready === false) && (
                    <div className="connection-note">
                      <span>
                        {status?.data.ready === false
                          ? "Campaign data needs to be added before calculating."
                          : statusError
                            ? "Connection status is unavailable."
                            : "Chat is offline. You can still enter details manually."}
                      </span>
                      <button
                        className="text-button"
                        onClick={() => void readStatus()}
                      >
                        Retry
                      </button>
                      <details>
                        <summary>Setup</summary>
                        <div>
                          {status?.data.ready === false ? (
                            <>
                              Import the assessment files with{" "}
                              <code>
                                npm run import:data --
                                /path/to/AI_Engineer_Case_Study.zip
                              </code>
                              , then restart.
                            </>
                          ) : (
                            <>
                              Start Ollama and install the configured model
                              {status?.model && (
                                <>
                                  : <code>ollama pull {status.model}</code>
                                </>
                              )}
                              . Retry when it is running.
                            </>
                          )}
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
          {chat?.planOpen && (
            <PlanPanel
              key={chat.id}
              chat={chat}
              edit={edit}
              submit={() => void submit("brief")}
              close={closeBrief}
            />
          )}
        </main>
      </div>
      <MobileHistory open={drawerOpen} close={closeDrawer} opener={opener}>
        <div id="mobile-history">{navigation(true)}</div>
      </MobileHistory>
    </div>
  );
}
