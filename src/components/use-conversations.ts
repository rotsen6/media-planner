"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { turnResponseSchema } from "@/lib/workflow-types";
import {
  briefFromForm,
  createWorkspaceSaver,
  emptyWorkspace,
  HISTORY_KEY,
  newConversation,
  restoreWorkspace,
  serializeWorkspace,
  workspaceReducer,
  type FormBrief,
  type WorkspaceAction,
  type WorkspaceState,
} from "@/lib/conversations";

export function useConversations() {
  const [state, dispatchAction] = useReducer(workspaceReducer, emptyWorkspace);
  const [hydrated, setHydrated] = useState(false);
  const [storageNotice, setStorageNotice] = useState("");
  const canSave = useRef(true);
  const requests = useRef(new Map<string, AbortController>());
  const stateRef = useRef(state);
  stateRef.current = state;
  const create = () => newConversation(crypto.randomUUID(), Date.now());
  const saver = useMemo(
    () =>
      createWorkspaceSaver((next) => {
        try {
          localStorage.setItem(HISTORY_KEY, serializeWorkspace(next));
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
      for (const request of controllers.values()) request.abort();
      controllers.clear();
    };
  }, [dispatch]);

  useEffect(() => {
    if (!hydrated || !canSave.current) return;
    saver.schedule(state);
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
  function edit(field: keyof FormBrief, value: string) {
    if (!chat) return;
    requests.current.get(chat.id)?.abort();
    requests.current.delete(chat.id);
    dispatch({ type: "edit", id: chat.id, field, value, now: Date.now() });
  }
  function stop(id: string) {
    requests.current.get(id)?.abort();
    requests.current.delete(id);
    dispatch({ type: "cancel", id });
  }
  async function submit(mode: "chat" | "brief") {
    const current = stateRef.current.chats.find(
      (c) => c.id === stateRef.current.activeId,
    );
    if (!current || current.request || requests.current.has(current.id)) return;
    let brief;
    try {
      brief = briefFromForm(current.form);
    } catch {
      dispatch({
        type: "error",
        id: current.id,
        error:
          "Check the brief: budget must be positive and an impression goal must be a positive whole number.",
      });
      return;
    }
    const message =
      mode === "chat"
        ? current.composer.trim()
        : [
            "Campaign brief",
            current.form.clientName,
            current.form.vertical,
            current.form.geo,
            current.form.kpi === "ctr"
              ? "Click-through rate"
              : current.form.kpi
                ? "In-view rate"
                : "",
            current.form.budget
              ? `$${Number(current.form.budget).toLocaleString("en-US")} budget`
              : "",
            current.form.impressionGoal
              ? `${Number(current.form.impressionGoal).toLocaleString("en-US")} minimum impressions`
              : "",
          ]
            .filter(Boolean)
            .join(" · ");
    if (!message) return;
    const id = current.id,
      requestId = crypto.randomUUID(),
      controller = new AbortController();
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
      const body = await response.json();
      const parsed = turnResponseSchema.safeParse(body);
      if (!parsed.success)
        throw new Error(
          typeof body.error === "string"
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
    edit,
    submit,
    stop,
    newChat: () => dispatch({ type: "new", chat: create() }),
    removeChat: (id: string) => {
      requests.current.get(id)?.abort();
      requests.current.delete(id);
      dispatch({ type: "remove", id, replacement: create() });
    },
  };
}
