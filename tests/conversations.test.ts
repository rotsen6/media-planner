import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceSaver,
  emptyWorkspace,
  formFromBrief,
  historyChats,
  newConversation,
  restoreWorkspace,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
} from "../src/lib/conversations";
import { recommend } from "../src/lib/recommend";
import type { TurnResponse } from "../src/lib/contract";
import { financeBrief, syntheticData } from "./fixtures";

const brief = { ...financeBrief, clientName: "First campaign" };
const result: TurnResponse = {
  status: "ready",
  brief,
  missing: [],
  pending: [],
  modelStatus: "not_used",
  recommendation: recommend(brief, syntheticData()),
  explanation: ["A verified recommendation."],
};
function workspace(...actions: WorkspaceAction[]): WorkspaceState {
  const chat = newConversation("first", 1);
  return apply({ ...emptyWorkspace, activeId: chat.id, chats: [chat] }, ...actions);
}
function apply(state: WorkspaceState, ...actions: WorkspaceAction[]) {
  return actions.reduce(workspaceReducer, state);
}
const restoreSaved = (state: unknown) => restoreWorkspace(JSON.stringify(state))!;
const start: WorkspaceAction = {
  type: "start",
  id: "first",
  requestId: "request-1",
  mode: "chat",
  message: "Finance in the US, $1000, CTR",
  now: 2,
};
const resolve: WorkspaceAction = {
  type: "resolve",
  id: "first",
  requestId: "request-1",
  response: result,
  now: 3,
};
const first = (state: WorkspaceState) =>
  state.chats.find((chat) => chat.id === "first")!;
const draft = (value: string): WorkspaceAction => ({
  type: "draft",
  id: "first",
  value,
  now: 4,
});
const newChat = (id: string): WorkspaceAction => ({
  type: "new",
  chat: newConversation(id, 5),
});
const fail = (error: string): WorkspaceAction => ({
  type: "fail",
  id: "first",
  requestId: "request-1",
  error,
  now: 5,
});
const progress: WorkspaceAction = {
  type: "progress",
  id: "first",
  requestId: "request-1",
  stage: "respond",
};

describe("saved conversations", () => {
  it("preserves each chat's brief, messages, plan and unsent draft when switching", () => {
    const state = workspace(
      start,
      resolve,
      draft("Make it $2,000"),
      newChat("second"),
      {
        type: "edit",
        id: "second",
        field: "vertical",
        value: "Retail",
        now: 6,
      },
      { type: "switch", id: "first" },
    );
    expect(state.activeId).toBe("first");
    expect(first(state)).toMatchObject({
      form: formFromBrief(brief),
      result,
      composer: "Make it $2,000",
    });
    expect(first(state).messages).toHaveLength(2);
    expect(state.chats[1].form.vertical).toBe("Retail");
    expect(state.chats[1].result).toBeNull();
  });
  it("reuses a pristine new chat and never accumulates empty history entries", () => {
    let state = workspace(newChat("unused"));
    expect(state.chats).toHaveLength(1);
    expect(state.activeId).toBe("first");
    expect(historyChats(state)).toHaveLength(0);
    state = apply(
      state,
      draft("Draft campaign"),
      newChat("second"),
      newChat("unused-again"),
    );
    expect(state.chats).toHaveLength(2);
    expect(historyChats(state)).toHaveLength(1);
    expect(state.activeId).toBe("second");
  });
  it("routes streamed progress and the final result to the original chat after navigation", () => {
    const pending = workspace(start, newChat("second"));
    const updated = apply(pending, progress);
    expect(first(updated)).toEqual({
      ...first(pending),
      request: { ...first(pending).request, stage: "respond" },
    });
    expect(updated.chats[1]).toBe(pending.chats[1]);
    expect(first(updated).planOpen).toBe(false);
    expect(first(updated).result).toBeNull();
    expect(first(updated).messages).toHaveLength(1);
    const state = apply(updated, resolve, progress);
    expect(state.activeId).toBe("second");
    expect(first(state).result).toEqual(result);
    expect(first(state).request).toBeNull();
    expect(first(state).planOpen).toBe(true);
    expect(first(state).messages.at(-1)?.text).toBe("A verified recommendation.");
    expect(state.chats[1].messages).toEqual([]);
  });
  it("invalidates a plan immediately on edit and ignores the obsolete response", () => {
    const state = workspace(
      start,
      resolve,
      { ...start, requestId: "request-2", now: 4 },
      { type: "edit", id: "first", field: "budget", value: "2000", now: 5 },
      { ...progress, requestId: "request-2" },
      { ...resolve, requestId: "request-2", now: 6 },
    );
    expect(first(state)).toMatchObject({
      result: null,
      dirty: true,
      request: null,
      form: { budget: "2000" },
    });
    expect(first(state).messages).toHaveLength(3);
    expect(first(state).messages[1].basedOnRevision).toBeLessThan(
      first(state).revision,
    );
  });
  it("keeps earlier plan messages current until the brief changes", () => {
    const question = {
      ...start,
      requestId: "request-2",
      message: "Why?",
      now: 4,
    };
    const pending = workspace(start, resolve, question);
    expect(first(pending).planOpen).toBe(false);
    let state = apply(pending, {
      ...resolve,
      requestId: "request-2",
      now: 5,
    });
    const plans = () => first(state).messages.filter((m) => m.basedOnRevision);
    expect(plans().map((m) => m.basedOnRevision)).toEqual([1, 1]);
    expect(first(state).revision).toBe(1);
    state = apply(state, {
      type: "edit",
      id: "first",
      field: "budget",
      value: "2000",
      now: 6,
    });
    expect(first(state).revision).toBe(2);
  });
  it("ignores late progress, completion or failure from an older request", () => {
    const stopped = workspace(start, {
      type: "cancel", id: "first",
    });
    expect(first(apply(stopped, progress))).toBe(first(stopped));
    const state = apply(
      stopped,
      { ...start, requestId: "request-2", now: 4 },
      progress,
      resolve,
      fail("Old failure"),
    );
    expect(first(state).request).toMatchObject({
      id: "request-2",
      stage: "extract",
    });
    expect(first(state).result).toBeNull();
    expect(first(state).error).toBe("");
  });
  it.each([resolve, fail("Offline"), { type: "cancel", id: "first" } as const])(
    "preserves a new draft on $type and recovers interrupted messages",
    (action) => {
      const pending = workspace(start);
      expect(
        first(apply(pending, draft("Next question"), action)).composer,
      ).toBe("Next question");
      expect(first(apply(pending, action)).composer).toBe(
        action.type === "resolve" ? "" : start.message,
      );
    },
  );
  it("restores an interrupted request as a retryable draft without a stale plan", () => {
    const restored = restoreSaved(workspace(start));
    expect(first(restored)).toMatchObject({
      request: null,
      result: null,
      dirty: true,
      composer: "Finance in the US, $1000, CTR",
    });
    expect(first(restored).error).toContain("interrupted");
    expect(first(restored).messages).toHaveLength(1);
  });
  it("restores results, pending questions, drafts and preferences", () => {
    const state = workspace(
      start,
      resolve,
      { type: "sidebar", open: false },
      draft("Keep this draft"),
    );
    expect(restoreSaved(state)).toEqual(state);
    const clarification: TurnResponse = {
      ...result,
      status: "clarification",
      recommendation: null,
      brief: { vertical: "Finance" },
      missing: ["geo", "budget", "kpi"],
      pending: ["impressionGoal"],
    };
    const clarifying = workspace(start, {
      ...resolve,
      response: clarification,
    });
    expect(first(restoreSaved(clarifying)).pending).toEqual(["impressionGoal"]);
  });
  it("rejects corrupt or unsupported stores instead of silently replacing them", () => {
    expect(restoreWorkspace(null)).toBeNull();
    expect(() => restoreWorkspace("invalid json")).toThrow();
    expect(() => restoreSaved({ ...workspace(), version: 2 })).toThrow();
    const state = workspace();
    state.chats.push(state.chats[0]);
    expect(() => restoreSaved(state)).toThrow("Duplicate chat IDs");
  });
  it("discards invalid or mismatched saved results while preserving the brief and chat", () => {
    const state = workspace(start, resolve);
    state.chats[0].form.budget = "2000";
    expect(first(restoreSaved(state))).toMatchObject({
      result: null,
      dirty: true,
      form: { budget: "2000" },
    });
    const invalid = JSON.parse(JSON.stringify(workspace(start, resolve)));
    invalid.chats[0].result.recommendation.recommended.ctr = "invented";
    expect(first(restoreSaved(invalid)).result).toBeNull();
  });
  it("invalidates persisted plans when source evidence changes", () => {
    const state = workspace(start, resolve);
    expect(
      apply(state, {
        type: "evidence",
        version: result.recommendation!.datasetVersion,
      }),
    ).toEqual(state);
    const changed = apply(state, { type: "evidence", version: "new-data" });
    expect(first(changed)).toMatchObject({ result: null, dirty: true });
    expect(first(changed).error).toContain("source data has changed");
  });
  it("removes only the selected chat and chooses another or a fresh draft", () => {
    let state = workspace(start, resolve, newChat("second"));
    state = apply(state, {
      type: "remove",
      id: "second",
      replacement: newConversation("replacement", 5),
    });
    expect(state.activeId).toBe("first");
    expect(first(state).result).toEqual(result);
    state = apply(state, {
      type: "remove",
      id: "first",
      replacement: newConversation("replacement", 6),
    });
    expect(state.activeId).toBe("replacement");
    expect(historyChats(state)).toEqual([]);
  });
});

describe("debounced workspace saves", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("writes only the latest draft after typing pauses", () => {
    const write = vi.fn();
    const saver = createWorkspaceSaver(write);
    let state = workspace();
    for (const value of ["A", "A draft", "A complete draft"]) {
      state = apply(state, draft(value));
      saver.schedule(state);
      vi.advanceTimersByTime(200);
      expect(write).not.toHaveBeenCalled();
    }
    vi.advanceTimersByTime(100);
    expect(write).toHaveBeenCalledExactlyOnceWith(state);
    vi.advanceTimersByTime(1000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("flushes before leaving and cancels the delayed duplicate write", () => {
    const write = vi.fn();
    const saver = createWorkspaceSaver(write);
    const state = workspace(start, resolve);
    saver.schedule(state);
    saver.flush();
    saver.flush();
    vi.runAllTimers();
    expect(write).toHaveBeenCalledExactlyOnceWith(state);
  });

  it("can resume saving after a page-hide flush", () => {
    const write = vi.fn();
    const saver = createWorkspaceSaver(write);
    saver.flush();
    expect(write).not.toHaveBeenCalled();
    saver.schedule(workspace());
    saver.flush();
    const next = workspace(start);
    saver.schedule(next);
    vi.advanceTimersByTime(300);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(next);
  });
});
