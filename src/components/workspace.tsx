"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { TURN_STAGE_LABELS } from "@/lib/chat/protocol";
import {
  chatSubtitle,
  chatTitle,
  historyChats,
  type Conversation,
} from "@/lib/chat/conversations";
import { Icon } from "./icons";
import { PlanPanel } from "./plan-panel";
import { useConversations, type ReplyDisplay } from "./use-conversations";

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
  search,
  setSearch,
}: {
  chats: Conversation[];
  activeId: string | null;
  newChat: () => void;
  select: (id: string) => void;
  remove: (id: string) => void;
  mobileClose?: () => void;
  search: string;
  setSearch: (value: string) => void;
}) {
  const query = search.toLowerCase().trim();
  const matches = query
    ? chats.filter(
        (chat) =>
          chatTitle(chat).toLowerCase().includes(query) ||
          chat.messages.some((m) => m.text.toLowerCase().includes(query)),
      )
    : chats;
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
        {(chats.length > 7 || search) && (
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
        {chats.length > 0 && <p className="nav-label">History</p>}
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

/** Only this temporary message rerenders as each character arrives. */
function PendingReply({ request, ref, onReveal }: {
  request: NonNullable<Conversation["request"]>;
  ref: React.Ref<ReplyDisplay>;
  onReveal: () => void;
}) {
  const [text, setText] = useState<string>();
  useImperativeHandle(ref, () => ({ requestId: request.id, show: setText }), [request.id]);
  useEffect(onReveal, [text, onReveal]);
  return text !== undefined ? (
    <>
      <article className="message assistant revealing" aria-hidden="true">
        <span className="message-author">Kargo</span>
        <p>{text}</p>
      </article>
      <p className="sr-only" role="status">Writing response…</p>
    </>
  ) : (
    <p className="working" role="status">
      <span />
      {TURN_STAGE_LABELS[request.stage ?? "extract"]}
    </p>
  );
}

function Messages({
  chat,
  openPlan,
  replyRef,
}: {
  chat: Conversation;
  openPlan: () => void;
  replyRef: React.Ref<ReplyDisplay>;
}) {
  const log = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const shown = useRef<string | null>(null);
  const followToEnd = useCallback(() => {
    if (follow.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, []);
  const latest = chat.messages.findLast(
    (m) => m.basedOnRevision === chat.revision,
  )?.id;
  // Follow new messages unless the reader scrolled up; always follow a newly opened chat.
  useEffect(() => {
    if (shown.current !== chat.id) follow.current = true;
    shown.current = chat.id;
    followToEnd();
  }, [chat.id, chat.messages.length, chat.request, followToEnd]);
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
                {id === latest && chat.result?.recommendation && (
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
              <PendingReply key={chat.request.id} request={chat.request} ref={replyRef} onReveal={followToEnd} />
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
          ? "The bundled campaign data could not be loaded."
          : failed
            ? "Connection status is unavailable."
            : "Chat is offline. Start Ollama to continue."}
      </span>
      <button className="text-button" onClick={() => void read()}>
        Retry
      </button>
      <details>
        <summary>Setup</summary>
        <div>
          {noData ? (
            <>
              Restore the supplied files in <code>data/private/</code>, then restart.
            </>
          ) : (
            <>
              Start Ollama and install the model
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
  const { state, chat, hydrated, storageNotice, dispatch, replyRef, ...actions } =
    useConversations();
  const [mobile, setMobile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const [search, setSearch] = useState("");
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
  const navigation = (mobile ? drawerOpen : state.sidebarOpen) && (
    <ChatNavigation
      chats={historyChats(state)}
      activeId={state.activeId}
      newChat={startChat}
      select={selectChat}
      remove={actions.removeChat}
      mobileClose={mobile ? closeDrawer : undefined}
      search={search}
      setSearch={setSearch}
    />
  );
  const hasBrief = chat && Object.values(chat.brief).some(Boolean);

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
          {!mobile && navigation}
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
                <Messages chat={chat} openPlan={openPlan} replyRef={replyRef} />
                <div className="composer-area">
                  {chat.error && (
                    <p className="inline-error" role="alert">
                      {chat.error}
                    </p>
                  )}
                  <form
                    className="composer"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void actions.submit();
                    }}
                  >
                    <textarea
                      ref={composer}
                      aria-label="Message"
                      placeholder={
                        chat.messages.length
                          ? "Refine your brief or ask why…"
                          : "Describe your campaign…"
                      }
                      rows={1}
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
                    <button
                      className="send-button"
                      type={chat.request ? "button" : "submit"}
                      aria-label={chat.request ? "Stop response" : "Send message"}
                      disabled={!chat.request && !chat.composer.trim()}
                      onClick={(event) => {
                        if (chat.request) {
                          // Cancel the click before this same button becomes Submit.
                          event.preventDefault();
                          actions.stop(chat.id);
                        }
                      }}
                    >
                      {chat.request ? "Stop" : "Send"}
                    </button>
                  </form>
                  {chat.composer.length > 3600 && (
                    <p className="composer-hint">{chat.composer.length} / 4,000</p>
                  )}
                  <div className="composer-tools">
                    {hasBrief && (
                      <button className="text-button" onClick={openPlan}>Review brief</button>
                    )}
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
            <PlanPanel key={chat.id} chat={chat} />
          )}
        </main>
      </div>
      <MobileHistory open={drawerOpen} close={closeDrawer}>
        <div id="mobile-history">{mobile && navigation}</div>
      </MobileHistory>
    </div>
  );
}
