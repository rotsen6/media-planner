import { z } from "zod";
import { briefFieldSchema, briefSchema, type Brief } from "../planning/brief";
import {
  pendingFieldsSchema,
  turnResponseSchema,
  turnStageSchema,
  type TurnResponse,
  type TurnStage,
} from "./protocol";

export const HISTORY_KEY = "kargo.media-planner.v1";
const FIELDS = briefFieldSchema.options;
// Read earlier form-based saves once; every subsequent save uses the typed brief.
const restoreBrief = (value: unknown) => {
  const chat = value as { brief?: Brief; form?: Record<string, string> } | null;
  if (!chat?.form || chat.brief) return value;
  return {
    ...chat,
    brief: Object.fromEntries(FIELDS.map((key) => {
      const value = chat.form![key]?.trim();
      const field = !value ? null : key === "budget" || key === "impressionGoal" ? Number(value) : value;
      return [key, briefSchema.shape[key].safeParse(field).data ?? null];
    })),
  };
};

const storedChatSchema = z.preprocess(restoreBrief, z.object({
  id: z.string().min(1),
  updatedAt: z.number(),
  brief: briefSchema,
  composer: z.string().max(4000),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(["user", "assistant"]),
      text: z.string(),
      basedOnRevision: z.number().int().nonnegative().optional(),
    }),
  ),
  pending: pendingFieldsSchema,
  result: z.unknown(), // Validated per chat, so one bad plan never loses the chat.
  dirty: z.boolean(),
  revision: z.number().int().nonnegative(),
  request: z
    .object({
      id: z.string(),
      message: z.string(),
      stage: turnStageSchema.optional(),
    })
    .nullable(),
  error: z.string(),
  planOpen: z.boolean(),
}));
const workspaceSchema = z.object({
  version: z.literal(1),
  chats: z.array(storedChatSchema),
  activeId: z.string().nullable(),
  sidebarOpen: z.boolean(),
});
export type Conversation = Omit<z.infer<typeof storedChatSchema>, "result"> & {
  result: TurnResponse | null;
};
export type WorkspaceState = Omit<z.infer<typeof workspaceSchema>, "chats"> & {
  chats: Conversation[];
};
export const emptyWorkspace: WorkspaceState = {
  version: 1,
  chats: [],
  activeId: null,
  sidebarOpen: true,
};

export const newConversation = (id: string, now: number): Conversation => ({
  id,
  updatedAt: now,
  brief: {},
  composer: "",
  messages: [],
  pending: [],
  result: null,
  dirty: false,
  revision: 0,
  request: null,
  error: "",
  planOpen: false,
});
const hasContent = (chat: Conversation) =>
  !!chat.messages.length ||
  !!chat.composer.trim() ||
  Object.values(chat.brief).some((value) => value != null);
export function chatTitle(chat: Conversation) {
  const title =
    chat.brief.clientName ||
    chat.messages.find((m) => m.role === "user")?.text ||
    chat.composer.trim();
  if (title) return title.length > 60 ? `${title.slice(0, 57)}…` : title;
  return chat.brief.vertical ? `${chat.brief.vertical} campaign` : "New chat";
}
export function chatSubtitle(chat: Conversation) {
  if (chat.request) return "Working…";
  if (chat.dirty && chat.revision > 0) return "Brief updated";
  if (chat.result?.status === "ready") return "Plan ready";
  if (chat.result?.status === "infeasible") return "Needs adjustment";
  const place = [chat.brief.vertical, chat.brief.geo].filter(Boolean);
  return place.join(" · ") || "Draft";
}
export const historyChats = (state: WorkspaceState) =>
  state.chats.filter(hasContent).sort((a, b) => b.updatedAt - a.updatedAt);
export const replyText = (response: TurnResponse) =>
  response.status === "ready"
    ? (response.explanation[0] ?? "")
    : response.explanation.join("\n\n");
const sameBrief = (brief: Brief, response: TurnResponse) =>
  FIELDS.every((key) => (brief[key] ?? null) === (response.brief[key] ?? null));
/** A corrupt store is reported, never silently overwritten by a new workspace. */
export function restoreWorkspace(raw: string | null): WorkspaceState | null {
  if (raw === null) return null;
  const saved = workspaceSchema.parse(JSON.parse(raw));
  if (new Set(saved.chats.map((c) => c.id)).size !== saved.chats.length)
    throw new Error("Duplicate chat IDs");
  const chats = saved.chats.map((stored): Conversation => {
    if (stored.request)
      return {
        ...stored,
        result: null,
        request: null,
        dirty: true,
        composer: recoverDraft(stored),
        error:
          "The last response was interrupted. Send again to continue.",
      };
    // A saved plan is trusted only while it is valid, clean, and matches its brief.
    const parsed = turnResponseSchema.safeParse(stored.result).data;
    const result =
      parsed && !stored.dirty && sameBrief(stored.brief, parsed) ? parsed : null;
    const dirty = stored.dirty || (stored.result != null && !result);
    return { ...stored, result, dirty };
  });
  const active = chats.some((c) => c.id === saved.activeId);
  return {
    ...saved,
    chats,
    activeId: active ? saved.activeId : (chats[0]?.id ?? null),
  };
}

/** Debounced writes: only the latest state is written, 300 ms after the last change. */
export function createWorkspaceSaver(write: (state: WorkspaceState) => void) {
  let pending: WorkspaceState | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    if (!pending) return;
    const state = pending;
    pending = undefined;
    write(state);
  };
  return {
    schedule(state: WorkspaceState) {
      pending = state;
      clearTimeout(timer);
      timer = setTimeout(flush, 300);
    },
    flush,
  };
}

type ChatAction =
  | { type: "plan"; id: string; open: boolean }
  | { type: "draft"; id: string; value: string; now: number }
  | {
      type: "start";
      id: string;
      requestId: string;
      message: string;
      now: number;
    }
  | {
      type: "progress";
      id: string;
      requestId: string;
      stage: TurnStage;
    }
  | {
      type: "resolve";
      id: string;
      requestId: string;
      response: TurnResponse;
      now: number;
    }
  | { type: "fail"; id: string; requestId: string; error: string; now: number }
  | { type: "cancel"; id: string };
export type WorkspaceAction =
  | ChatAction
  | { type: "restore"; state: WorkspaceState }
  | { type: "new"; chat: Conversation }
  | { type: "switch"; id: string }
  | { type: "remove"; id: string; replacement: Conversation }
  | { type: "sidebar"; open: boolean }
  | { type: "evidence"; version: string };

// A stopped or failed turn hands its message back unless a new draft was typed.
const recoverDraft = (chat: Pick<Conversation, "composer" | "request">) =>
  chat.composer || chat.request?.message || "";
// New evidence drops the saved plan and marks older answers stale.
const invalidate = (chat: Conversation): Conversation => ({
  ...chat,
  result: null,
  dirty: true,
  revision: chat.revision + 1,
});

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "restore":
      return action.state;
    case "sidebar":
      return { ...state, sidebarOpen: action.open };
    case "new": {
      const active = state.chats.find((c) => c.id === state.activeId);
      if (active && !hasContent(active)) return state;
      const chats = [...state.chats.filter(hasContent), action.chat];
      return { ...state, activeId: action.chat.id, chats };
    }
    case "switch":
      return state.chats.some((c) => c.id === action.id)
        ? { ...state, activeId: action.id }
        : state;
    case "remove": {
      const chats = state.chats.filter((c) => c.id !== action.id);
      const activeId =
        state.activeId === action.id
          ? (historyChats({ ...state, chats })[0]?.id ??
            chats[0]?.id ??
            action.replacement.id)
          : state.activeId;
      if (!chats.some((c) => c.id === activeId)) chats.push(action.replacement);
      return { ...state, chats, activeId };
    }
    case "evidence":
      return {
        ...state,
        chats: state.chats.map((chat) =>
          chat.result?.recommendation &&
          chat.result.recommendation.datasetVersion !== action.version
            ? {
                ...invalidate(chat),
                error:
                  "The source data has changed. Update this plan to use the current evidence.",
              }
            : chat,
        ),
      };
    default:
      return {
        ...state,
        chats: state.chats.map((chat) =>
          chat.id === action.id ? updateChat(chat, action) : chat,
        ),
      };
  }
}

function updateChat(chat: Conversation, action: ChatAction): Conversation {
  switch (action.type) {
    case "plan":
      return { ...chat, planOpen: action.open };
    case "draft":
      return { ...chat, composer: action.value, updatedAt: action.now };
    case "start":
      return {
        ...chat,
        result: null,
        planOpen: false,
        dirty: false,
        error: "",
        updatedAt: action.now,
        composer: "",
        request: {
          id: action.requestId,
          message: action.message,
          stage: "extract",
        },
        messages: [
          ...chat.messages,
          {
            id: `${action.requestId}:user`,
            role: "user",
            text: action.message,
          },
        ],
      };
    case "progress":
      return chat.request?.id === action.requestId &&
        chat.request.stage !== action.stage
        ? { ...chat, request: { ...chat.request, stage: action.stage } }
        : chat;
    case "resolve": {
      // Late answers to a stopped or replaced request are ignored.
      if (chat.request?.id !== action.requestId) return chat;
      const next = action.response;
      // Only a changed brief makes earlier plan messages stale.
      const revision = chat.revision + (sameBrief(chat.brief, next) ? 0 : 1);
      return {
        ...chat,
        brief: next.brief,
        pending: next.pending,
        result: next,
        revision,
        request: null,
        planOpen: !!next.recommendation || chat.planOpen,
        updatedAt: action.now,
        dirty: false,
        error: "",
        composer: next.status === "error" ? recoverDraft(chat) : chat.composer,
        messages: [
          ...chat.messages,
          {
            id: `${action.requestId}:assistant`,
            role: "assistant",
            text: replyText(next),
            ...(next.recommendation ? { basedOnRevision: revision } : {}),
          },
        ],
      };
    }
    case "fail":
    case "cancel":
      if (action.type === "fail" && chat.request?.id !== action.requestId)
        return chat;
      return {
        ...chat,
        request: null,
        dirty: true,
        composer: recoverDraft(chat),
        updatedAt: action.type === "fail" ? action.now : chat.updatedAt,
        error:
          action.type === "fail"
            ? action.error
            : "Response stopped. You can revise the brief or send again.",
      };
  }
}
