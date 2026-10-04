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
import { syntheticData } from "./fixtures";

const brief = {
  clientName: "First campaign",
  vertical: "Finance",
  geo: "US",
  kpi: "ctr",
  budget: 1000,
} as const;
const result: TurnResponse = {
  status: "ready",
  brief,
  missing: [],
  pending: [],
  modelStatus: "not_used",
  recommendation: recommend(brief, syntheticData()),
  explanation: ["A verified recommendation."],
};
function workspace(): WorkspaceState {
  const chat = newConversation("first", 1);
  return { ...emptyWorkspace, activeId: chat.id, chats: [chat] };
}
function apply(state: WorkspaceState, ...actions: WorkspaceAction[]) {
  return actions.reduce(workspaceReducer, state);
}
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

describe("saved conversations", () => {
  it("preserves each chat's brief, messages, plan and unsent draft when switching", () => {
    const state = apply(
      workspace(),
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
    let state = apply(workspace(), newChat("unused"));
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
  it("routes an in-flight result to its original chat after navigation", () => {
    const state = apply(workspace(), start, newChat("second"), resolve);
    expect(state.activeId).toBe("second");
    expect(first(state).result).toEqual(result);
    expect(state.chats[1].messages).toEqual([]);
  });
  it("invalidates a plan immediately on edit and ignores the obsolete response", () => {
    const state = apply(
      workspace(),
      start,
      resolve,
      { ...start, requestId: "request-2", now: 4 },
      { type: "edit", id: "first", field: "budget", value: "2000", now: 5 },
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
  it("ignores a late completion or failure from an older request", () => {
    const state = apply(
      workspace(),
      start,
      { type: "cancel", id: "first" },
      { ...start, requestId: "request-2", now: 4 },
      resolve,
      fail("Old failure"),
    );
    expect(first(state).request?.id).toBe("request-2");
    expect(first(state).result).toBeNull();
    expect(first(state).error).toBe("");
  });
  it("keeps a newly typed draft when an earlier turn succeeds or fails", () => {
    const pending = apply(workspace(), start, draft("Next question"));
    expect(first(apply(pending, resolve)).composer).toBe("Next question");
    expect(first(apply(pending, fail("Offline"))).composer).toBe(
      "Next question",
    );
  });
  it("restores an interrupted request as a retryable draft without a stale plan", () => {
    const state = apply(workspace(), start);
    const restored = restoreWorkspace(JSON.stringify(state))!;
    expect(first(restored)).toMatchObject({
      request: null,
      result: null,
      dirty: true,
      composer: "Finance in the US, $1000, CTR",
    });
    expect(first(restored).error).toContain("interrupted");
  });
  it("restores results, pending questions, drafts and preferences", () => {
    const state = apply(
      workspace(),
      start,
      resolve,
      { type: "sidebar", open: false },
      draft("Keep this draft"),
    );
    expect(restoreWorkspace(JSON.stringify(state))).toEqual(state);
    const clarification: TurnResponse = {
      ...result,
      status: "clarification",
      recommendation: null,
      brief: { vertical: "Finance" },
      missing: ["geo", "budget", "kpi"],
      pending: ["impressionGoal"],
    };
    const clarifying = apply(workspace(), start, {
      ...resolve,
      response: clarification,
    });
    expect(
      first(restoreWorkspace(JSON.stringify(clarifying))!).pending,
    ).toEqual(["impressionGoal"]);
  });
  it("rejects corrupt or unsupported stores instead of silently replacing them", () => {
    expect(restoreWorkspace(null)).toBeNull();
    expect(() => restoreWorkspace("invalid json")).toThrow();
    expect(() =>
      restoreWorkspace(JSON.stringify({ ...workspace(), version: 2 })),
    ).toThrow();
    const state = workspace();
    state.chats.push(state.chats[0]);
    expect(() => restoreWorkspace(JSON.stringify(state))).toThrow(
      "Duplicate chat IDs",
    );
  });
  it("discards invalid or mismatched saved results while preserving the brief and chat", () => {
    const state = apply(workspace(), start, resolve);
    state.chats[0].form.budget = "2000";
    expect(first(restoreWorkspace(JSON.stringify(state))!)).toMatchObject({
      result: null,
      dirty: true,
      form: { budget: "2000" },
    });
    const invalid = JSON.parse(
      JSON.stringify(apply(workspace(), start, resolve)),
    );
    invalid.chats[0].result.recommendation.recommended.ctr = "invented";
    expect(first(restoreWorkspace(JSON.stringify(invalid))!).result).toBeNull();
  });
  it("invalidates persisted plans when source evidence changes", () => {
    const state = apply(workspace(), start, resolve);
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
    let state = apply(workspace(), start, resolve, newChat("second"));
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
  it("restores the last message on stop without erasing a subsequent draft", () => {
    let state = apply(workspace(), start, { type: "cancel", id: "first" });
    expect(first(state).composer).toBe(start.message);
    state = apply(workspace(), start, draft("New draft"), {
      type: "cancel",
      id: "first",
    });
    expect(first(state).composer).toBe("New draft");
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
    const state = apply(workspace(), start, resolve);
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
    const next = apply(workspace(), start);
    saver.schedule(next);
    vi.advanceTimersByTime(300);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(next);
  });
});
