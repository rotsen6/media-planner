"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  createWorkspaceSaver,
  emptyWorkspace,
  HISTORY_KEY,
  newConversation,
  replyText,
  restoreWorkspace,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
} from "@/lib/chat/conversations";
import { revealText } from "@/lib/chat/reveal-text";
import { readTurnResponse } from "@/lib/chat/read-response";
import { CHAT_HISTORY_LIMIT, CHAT_HISTORY_TEXT_LIMIT } from "@/lib/chat/protocol";

const create = () => newConversation(crypto.randomUUID(), Date.now());
export type ReplyDisplay = { requestId: string; show: (text: string) => void };

/** Chats, their persistence in this browser, and one cancellable request per chat. */
export function useConversations() {
  const [state, dispatchAction] = useReducer(workspaceReducer, emptyWorkspace);
  const [hydrated, setHydrated] = useState(false);
  const [storageNotice, setStorageNotice] = useState("");
  const canSave = useRef(true);
  const requests = useRef(new Map<string, AbortController>());
  const replyRef = useRef<ReplyDisplay>(null);
  // Restore the displayed prefix when returning to a chat during its reveal or pause.
  const replies = useRef(new Map<string, string>());
  const showReply = useCallback((display: ReplyDisplay | null) => {
    replyRef.current = display;
    if (!display) return;
    const text = replies.current.get(display.requestId);
    if (text !== undefined) display.show(text);
  }, []);
  const stateRef = useRef(state);
  stateRef.current = state;
  const saver = useMemo(
    () =>
      createWorkspaceSaver((next) => {
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
          setStorageNotice("");
        } catch {
          setStorageNotice(
            "These changes could not be saved in this browser. Keep this tab open; removing an old chat may free space.",
          );
        }
      }),
    [],
  );
  const dispatch = useCallback(
    (action: WorkspaceAction) => {
      // Leaving a chat writes immediately, so a quick reload never loses it.
      if (["switch", "new", "remove"].includes(action.type)) saver.flush();
      dispatchAction(action);
    },
    [saver],
  );

  useEffect(() => {
    let restored: WorkspaceState | null = null;
    try {
      restored = restoreWorkspace(localStorage.getItem(HISTORY_KEY));
    } catch {
      canSave.current = false;
      setStorageNotice(
        "Saved chats could not be restored. This session still works, but new changes will not be saved.",
      );
    }
    if (!restored?.chats.length) {
      const chat = create();
      restored = { ...emptyWorkspace, chats: [chat], activeId: chat.id };
    }
    dispatch({ type: "restore", state: restored });
    setHydrated(true);
    const controllers = requests.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    };
  }, [dispatch]);

  useEffect(() => {
    if (hydrated && canSave.current) saver.schedule(state);
  }, [state, hydrated, saver]);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") saver.flush();
    };
    window.addEventListener("pagehide", saver.flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", saver.flush);
      document.removeEventListener("visibilitychange", onHidden);
      saver.flush();
    };
  }, [saver]);

  const chat = state.chats.find((c) => c.id === state.activeId) ?? null;
  const abort = (id: string) => {
    requests.current.get(id)?.abort();
    requests.current.delete(id);
  };
  async function submit() {
    const { chats, activeId } = stateRef.current;
    const current = chats.find((c) => c.id === activeId);
    if (!current || current.request || requests.current.has(current.id)) return;
    const message = current.composer.trim();
    if (!message) return;
    const { id } = current;
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    requests.current.set(id, controller);
    dispatch({ type: "start", id, requestId, message, now: Date.now() });
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        signal: controller.signal,
        body: JSON.stringify({
          brief: current.brief, message, pending: current.pending,
          history: current.messages.slice(-CHAT_HISTORY_LIMIT).map(({ role, text }) => ({
            role, text: text.slice(0, CHAT_HISTORY_TEXT_LIMIT),
          })),
        }),
      });
      const result = await readTurnResponse(response, (stage) => {
        if (!controller.signal.aborted)
          dispatch({ type: "progress", id, requestId, stage });
      });
      if (result.status !== "error") {
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        await revealText(
          replyText(result),
          (text) => {
            replies.current.set(requestId, text);
            if (replyRef.current?.requestId === requestId) replyRef.current.show(text);
          },
          controller.signal,
          () => !reducedMotion.matches && document.visibilityState === "visible"
            && stateRef.current.activeId === id && replyRef.current?.requestId === requestId,
          result.recommendation ? 1000 : undefined,
        );
      }
      if (!controller.signal.aborted)
        dispatch({
          type: "resolve",
          id,
          requestId,
          response: result,
          now: Date.now(),
        });
    } catch (cause) {
      if (!controller.signal.aborted)
        dispatch({
          type: "fail",
          id,
          requestId,
          error:
            cause instanceof Error
              ? cause.message
              : "Unable to connect. Please try again.",
          now: Date.now(),
        });
    } finally {
      replies.current.delete(requestId);
      if (requests.current.get(id) === controller) requests.current.delete(id);
    }
  }
  return {
    state,
    chat,
    hydrated,
    storageNotice,
    replyRef: showReply,
    dispatch,
    submit,
    stop(id: string) {
      abort(id);
      dispatch({ type: "cancel", id });
    },
    newChat: () => dispatch({ type: "new", chat: create() }),
    removeChat(id: string) {
      abort(id);
      dispatch({ type: "remove", id, replacement: create() });
    },
  };
}
