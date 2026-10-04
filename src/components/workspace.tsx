"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
const focusSoon = (target: () => HTMLElement | null | undefined) =>
  requestAnimationFrame(() => target()?.focus());
const planHeading = () => document.getElementById("plan-heading");

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
  const query = search.toLowerCase().trim();
  const matches = chats.filter((chat) =>
    [chatTitle(chat), ...chat.messages.map((m) => m.text)].some((text) =>
      text.toLowerCase().includes(query),
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
        {matches.map((chat) => {
          const title = chatTitle(chat);
          const active = chat.id === activeId;
          return (
            <div
              className={`history-row${active ? " active" : ""}`}
              key={chat.id}
            >
              <button
                className="history-link"
                onClick={() => select(chat.id)}
                aria-current={active ? "page" : undefined}
                title={title}
              >
                <span>{title}</span>
                <small>{chatSubtitle(chat)}</small>
              </button>
              <details className="chat-actions">
                <summary
                  className="icon-button"
                  aria-label={`Actions for ${title}`}
                >
                  <Icon name="more" />
                </summary>
                <div>
                  <button
                    onClick={() =>
                      window.confirm(`Delete “${title}” from this browser?`) &&
                      remove(chat.id)
                    }
                  >
                    Delete chat
                  </button>
                </div>
              </details>
            </div>
          );
        })}
        {chats.length > 0 && !matches.length && (
          <p className="muted small empty-history">No matching chats.</p>
        )}
      </div>
      <p className="history-footer">Saved in this browser</p>
    </nav>
  );
}

/** A native modal dialog: it traps focus, closes on Escape, and restores focus on close. */
function MobileHistory({
  open,
  close,
  children,
}: {
  open: boolean;
  close: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="history-drawer"
      aria-label="Chat history"
      onClose={close}
      // The content fills the dialog, so a click on the dialog itself hit the backdrop.
      onClick={(event) => event.target === event.currentTarget && close()}
    >
      {children}
    </dialog>
  );
}

function Messages({
  chat,
  openPlan,
}: {
  chat: Conversation;
  openPlan: () => void;
}) {
  const log = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const shown = useRef<string | null>(null);
  // Follow new messages unless the reader scrolled up; always follow a newly opened chat.
  useEffect(() => {
    if (shown.current !== chat.id) follow.current = true;
    shown.current = chat.id;
    if (follow.current && log.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [chat.id, chat.messages.length, chat.request]);
  return (
    <div
      className="conversation-scroll"
      ref={log}
      onScroll={({ currentTarget: el }) => {
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
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
            {chat.messages.map(({ id, role, text, basedOnRevision }) => (
              <article
                className={`message ${role}`}
                key={id}
                aria-label={role === "user" ? "You" : "Media planner"}
              >
                <span className="message-author">
                  {role === "user" ? "You" : "Kargo"}
                </span>
                {basedOnRevision !== undefined &&
                  basedOnRevision !== chat.revision && (
                    <span className="earlier-label">Earlier plan</span>
                  )}
                <p>{text}</p>
                {role === "assistant" &&
                  basedOnRevision === chat.revision &&
                  chat.result?.recommendation && (
                    <button
                      className="text-button inline-plan-link"
                      onClick={openPlan}
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
  );
}

/** Checks setup once (and on Retry) and reports the evidence version for stale plans. */
function SetupNote({ onVersion }: { onVersion: (version: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const read = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch("/api/status", { signal });
        if (!response.ok) throw new Error("Status unavailable");
        const next: Status = await response.json();
        if (signal?.aborted) return;
        setStatus(next);
        setFailed(false);
        if (next.data.version) onVersion(next.data.version);
      } catch {
        if (!signal?.aborted) setFailed(true);
      }
    },
    [onVersion],
  );
  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal);
    return () => controller.abort();
  }, [read]);
  const noData = status?.data.ready === false;
  if (!failed && !noData && status?.modelReady !== false) return null;
  return (
    <div className="connection-note">
      <span>
        {noData
          ? "Campaign data needs to be added before calculating."
          : failed
            ? "Connection status is unavailable."
            : "Chat is offline. You can still enter details manually."}
      </span>
      <button className="text-button" onClick={() => void read()}>
        Retry
      </button>
      <details>
        <summary>Setup</summary>
        <div>
          {noData ? (
            <>
              Extract the four assessment files into <code>data/private/</code>{" "}
              as the README shows, then restart.
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
  );
}

export default function Workspace({ examples }: { examples: string[] }) {
  const { state, chat, hydrated, storageNotice, dispatch, ...actions } =
    useConversations();
  const [mobile, setMobile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const onVersion = useCallback(
    (version: string) => dispatch({ type: "evidence", version }),
    [dispatch],
  );
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
    const box = composer.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
  }, [chat?.composer, chat?.id, chat?.planOpen]);

  function startChat() {
    actions.newChat();
    setDrawerOpen(false);
    setShowExamples(false);
    focusSoon(() => composer.current);
  }
  function selectChat(id: string) {
    dispatch({ type: "switch", id });
    setDrawerOpen(false);
    setShowExamples(false);
    // Below 1200px the plan replaces the chat, so focus whichever is visible.
    const planVisible =
      window.matchMedia("(max-width: 1199px)").matches &&
      state.chats.find((c) => c.id === id)?.planOpen;
    focusSoon(() => (planVisible ? planHeading() : composer.current));
  }
  function setPlan(open: boolean) {
    if (chat) dispatch({ type: "plan", id: chat.id, open });
    focusSoon(() => (open ? planHeading() : composer.current));
  }
  const openPlan = () => setPlan(true);
  const draft = (value: string) =>
    chat && dispatch({ type: "draft", id: chat.id, value, now: Date.now() });
  const navigation = (mobileClose?: () => void) => (
    <ChatNavigation
      chats={historyChats(state)}
      activeId={state.activeId}
      newChat={startChat}
      select={selectChat}
      remove={actions.removeChat}
      mobileClose={mobileClose}
    />
  );
  const hasBrief = chat && Object.values(chat.form).some(Boolean);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-group">
          <button
            className="icon-button sidebar-toggle"
            aria-label={
              !mobile && state.sidebarOpen
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
            onClick={() => setPlan(!chat.planOpen)}
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
                <Messages chat={chat} openPlan={openPlan} />
                <div className="composer-area">
                  {chat.error && (
                    <p className="inline-error" role="alert">
                      {chat.error}
                    </p>
                  )}
                  {chat.result?.status === "error" && (
                    <button
                      className="text-button fallback-link"
                      onClick={openPlan}
                    >
                      Enter details manually <Icon name="chevron" />
                    </button>
                  )}
                  <form
                    className="composer"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void actions.submit("chat");
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
                      onChange={(event) => draft(event.target.value)}
                      onKeyDown={(event) => {
                        // Enter sends; Shift+Enter and IME composition insert text.
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
                          onClick={() => actions.stop(chat.id)}
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
                    <button className="text-button" onClick={openPlan}>
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
                          if (!event.target.value) return;
                          draft(event.target.value);
                          setShowExamples(false);
                          focusSoon(() => composer.current);
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
                  <SetupNote onVersion={onVersion} />
                </div>
              </>
            )}
          </section>
          {chat?.planOpen && (
            <PlanPanel
              key={chat.id}
              chat={chat}
              edit={actions.edit}
              submit={() => void actions.submit("brief")}
              close={() => setPlan(false)}
            />
          )}
        </main>
      </div>
      <MobileHistory open={drawerOpen} close={closeDrawer}>
        <div id="mobile-history">{navigation(closeDrawer)}</div>
      </MobileHistory>
    </div>
  );
}
