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
  briefFromForm,
  briefMessage,
  createWorkspaceSaver,
  emptyWorkspace,
  HISTORY_KEY,
  newConversation,
  restoreWorkspace,
  workspaceReducer,
  type FormBrief,
  type WorkspaceAction,
  type WorkspaceState,
} from "@/lib/conversations";
import { turnResponseSchema } from "@/lib/contract";

const create = () => newConversation(crypto.randomUUID(), Date.now());

/** Chats, their persistence in this browser, and one cancellable request per chat. */
export function useConversations() {
  const [state, dispatchAction] = useReducer(workspaceReducer, emptyWorkspace);
  const [hydrated, setHydrated] = useState(false);
  const [storageNotice, setStorageNotice] = useState("");
  const canSave = useRef(true);
  const requests = useRef(new Map<string, AbortController>());
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
  async function submit(mode: "chat" | "brief") {
    const { chats, activeId } = stateRef.current;
    const current = chats.find((c) => c.id === activeId);
    if (!current || current.request || requests.current.has(current.id)) return;
    const brief = briefFromForm(current.form);
    if (!brief) {
      const error =
        "Check the brief: budget must be positive and an impression goal must be a positive whole number.";
      dispatch({ type: "error", id: current.id, error });
      return;
    }
    const message =
      mode === "chat" ? current.composer.trim() : briefMessage(current.form);
    if (!message) return;
    const { id } = current;
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    requests.current.set(id, controller);
    dispatch({ type: "start", id, requestId, mode, message, now: Date.now() });
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(
          mode === "chat"
            ? { mode, brief, message, pending: current.pending }
            : { mode, brief },
        ),
      });
      const body = await response.json().catch(() => null);
      const parsed = turnResponseSchema.safeParse(body);
      if (!parsed.success)
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : "The server returned an unreadable response. Please try again.",
        );
      if (!controller.signal.aborted)
        dispatch({
          type: "resolve",
          id,
          requestId,
          response: parsed.data,
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
      if (requests.current.get(id) === controller) requests.current.delete(id);
    }
  }
  return {
    state,
    chat,
    hydrated,
    storageNotice,
    dispatch,
    submit,
    edit(field: keyof FormBrief, value: string) {
      if (!chat) return;
      abort(chat.id);
      dispatch({ type: "edit", id: chat.id, field, value, now: Date.now() });
    },
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
