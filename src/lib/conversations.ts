import { z } from "zod";
import { briefSchema, type Brief } from "./brief";
import {
  pendingFieldsSchema,
  turnResponseSchema,
  type TurnResponse,
} from "./workflow-types";

export const HISTORY_KEY = "kargo.media-planner.v1";
export const formSchema = z
  .object({
    clientName: z.string().max(120),
    vertical: z.string(),
    kpi: z.string(),
    geo: z.string(),
    budget: z.string(),
    impressionGoal: z.string(),
  })
  .strict();
export type FormBrief = z.infer<typeof formSchema>;
export const emptyForm: FormBrief = {
  clientName: "",
  vertical: "",
  kpi: "",
  geo: "",
  budget: "",
  impressionGoal: "",
};
export const formFromBrief = (brief: Brief): FormBrief =>
  Object.fromEntries(
    Object.keys(emptyForm).map((key) => [
      key,
      brief[key as keyof Brief]?.toString() ?? "",
    ]),
  ) as FormBrief;
export const briefFromForm = (form: FormBrief): Brief =>
  briefSchema.parse(
    Object.fromEntries(
      Object.entries(form).map(([key, value]) => [
        key,
        !value.trim()
          ? null
          : ["budget", "impressionGoal"].includes(key)
            ? Number(value)
            : value,
      ]),
    ),
  );

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  basedOnRevision: z.number().int().nonnegative().optional(),
});
const requestSchema = z.object({
  id: z.string(),
  mode: z.enum(["chat", "brief"]),
  message: z.string(),
});
const storedChatSchema = z.object({
  id: z.string().min(1),
  createdAt: z.number(),
  updatedAt: z.number(),
  form: formSchema,
  composer: z.string().max(4000),
  messages: z.array(messageSchema),
  pending: pendingFieldsSchema,
  result: z.unknown(),
  dirty: z.boolean(),
  revision: z.number().int().nonnegative(),
  request: requestSchema.nullable(),
  error: z.string(),
  planOpen: z.boolean(),
});
export type Message = z.infer<typeof messageSchema>;
export type Conversation = Omit<z.infer<typeof storedChatSchema>, "result"> & {
  result: TurnResponse | null;
};
export type WorkspaceState = {
  version: 1;
  chats: Conversation[];
  activeId: string | null;
  sidebarOpen: boolean;
};
export const emptyWorkspace: WorkspaceState = {
  version: 1,
  chats: [],
  activeId: null,
  sidebarOpen: true,
};

export function newConversation(id: string, now: number): Conversation {
  return {
    id,
    createdAt: now,
    updatedAt: now,
    form: { ...emptyForm },
    composer: "",
    messages: [],
    pending: [],
    result: null,
    dirty: false,
    revision: 0,
    request: null,
    error: "",
    planOpen: false,
  };
}
export function hasContent(chat: Conversation) {
  return !!(
    chat.messages.length ||
    chat.composer.trim() ||
    Object.values(chat.form).some((v) => v.trim())
  );
}
export function chatTitle(chat: Conversation) {
  const title =
    chat.form.clientName.trim() ||
    chat.messages.find((m) => m.role === "user")?.text ||
    chat.composer.trim();
  if (title) return title.length > 60 ? `${title.slice(0, 57)}…` : title;
  return chat.form.vertical ? `${chat.form.vertical} campaign` : "New chat";
}
export function chatSubtitle(chat: Conversation) {
  if (chat.request) return "Working…";
  if (chat.dirty && chat.revision > 0) return "Brief updated";
  if (chat.result?.status === "ready") return "Plan ready";
  if (chat.result?.status === "infeasible") return "Needs adjustment";
  return (
    [chat.form.vertical, chat.form.geo].filter(Boolean).join(" · ") || "Draft"
  );
}
export function historyChats(state: WorkspaceState) {
  return state.chats
    .filter(hasContent)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
function sameBrief(form: FormBrief, response: TurnResponse) {
  const current = briefFromForm(form);
  return Object.keys(emptyForm).every(
    (key) =>
      (current[key as keyof Brief] ?? null) ===
      (response.brief[key as keyof Brief] ?? null),
  );
}
/** A corrupt store is reported, never silently overwritten by a new workspace. */
export function restoreWorkspace(raw: string | null): WorkspaceState | null {
  if (raw === null) return null;
  const saved = z
    .object({
      version: z.literal(1),
      chats: z.array(storedChatSchema),
      activeId: z.string().nullable(),
      sidebarOpen: z.boolean(),
    })
    .parse(JSON.parse(raw));
  if (new Set(saved.chats.map((c) => c.id)).size !== saved.chats.length)
    throw new Error("Duplicate chat IDs");
  const chats = saved.chats.map((stored): Conversation => {
    const parsed = turnResponseSchema.safeParse(stored.result);
    let result = parsed.success ? parsed.data : null;
    let dirty = stored.dirty;
    try {
      if (result && (dirty || !sameBrief(stored.form, result))) {
        result = null;
        dirty = true;
      }
    } catch {
      result = null;
      dirty = true;
    }
    if (stored.result && !parsed.success) dirty = true;
    if (stored.request)
      return {
        ...stored,
        result: null,
        request: null,
        dirty: true,
        composer:
          stored.composer ||
          (stored.request.mode === "chat" ? stored.request.message : ""),
        error:
          "The last response was interrupted. Send again or update the plan to continue.",
      };
    return { ...stored, result, dirty };
  });
  return {
    ...saved,
    chats,
    activeId: chats.some((c) => c.id === saved.activeId)
      ? saved.activeId
      : (chats[0]?.id ?? null),
  };
}
export function serializeWorkspace(state: WorkspaceState) {
  return JSON.stringify(state);
}

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

export type WorkspaceAction =
  | { type: "restore"; state: WorkspaceState }
  | { type: "new"; chat: Conversation }
  | { type: "switch"; id: string }
  | { type: "remove"; id: string; replacement: Conversation }
  | { type: "sidebar"; open: boolean }
  | { type: "plan"; id: string; open: boolean }
  | { type: "draft"; id: string; value: string; now: number }
  | {
      type: "edit";
      id: string;
      field: keyof FormBrief;
      value: string;
      now: number;
    }
  | { type: "error"; id: string; error: string }
  | {
      type: "start";
      id: string;
      requestId: string;
      mode: "chat" | "brief";
      message: string;
      now: number;
    }
  | {
      type: "resolve";
      id: string;
      requestId: string;
      response: TurnResponse;
      now: number;
    }
  | { type: "fail"; id: string; requestId: string; error: string; now: number }
  | { type: "cancel"; id: string }
  | { type: "evidence"; version: string };

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  if (action.type === "restore") return action.state;
  if (action.type === "sidebar") return { ...state, sidebarOpen: action.open };
  if (action.type === "new") {
    const active = state.chats.find((c) => c.id === state.activeId);
    if (active && !hasContent(active)) return state;
    return {
      ...state,
      activeId: action.chat.id,
      chats: [...state.chats.filter(hasContent), action.chat],
    };
  }
  if (action.type === "switch")
    return state.chats.some((c) => c.id === action.id)
      ? { ...state, activeId: action.id }
      : state;
  if (action.type === "remove") {
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
  return {
    ...state,
    chats: state.chats.map((chat) => {
      if (action.type === "evidence") {
        if (
          chat.result?.recommendation &&
          chat.result.recommendation.datasetVersion !== action.version
        )
          return {
            ...chat,
            result: null,
            dirty: true,
            revision: chat.revision + 1,
            error:
              "The source data has changed. Update this plan to use the current evidence.",
          };
        return chat;
      }
      if (chat.id !== action.id) return chat;
      switch (action.type) {
        case "plan":
          return { ...chat, planOpen: action.open };
        case "draft":
          return { ...chat, composer: action.value, updatedAt: action.now };
        case "error":
          return { ...chat, error: action.error };
        case "edit":
          return {
            ...chat,
            form: { ...chat.form, [action.field]: action.value },
            result: null,
            dirty: true,
            revision: chat.revision + 1,
            request: null,
            error: "",
            updatedAt: action.now,
            pending: chat.pending.filter((field) => field !== action.field),
          };
        case "start":
          return {
            ...chat,
            result: null,
            dirty: false,
            revision: chat.revision + 1,
            error: "",
            updatedAt: action.now,
            composer: action.mode === "chat" ? "" : chat.composer,
            request: {
              id: action.requestId,
              mode: action.mode,
              message: action.message,
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
        case "resolve": {
          if (chat.request?.id !== action.requestId) return chat;
          const next = action.response;
          return {
            ...chat,
            form: formFromBrief(next.brief),
            pending: next.pending,
            result: next,
            request: null,
            planOpen: next.recommendation ? true : chat.planOpen,
            updatedAt: action.now,
            dirty: false,
            error: "",
            composer:
              next.status === "error" &&
              !chat.composer &&
              chat.request.mode === "chat"
                ? chat.request.message
                : chat.composer,
            messages: [
              ...chat.messages,
              {
                id: `${action.requestId}:assistant`,
                role: "assistant",
                text:
                  next.status === "ready"
                    ? next.explanation[0]
                    : next.explanation.join("\n\n"),
                ...(next.recommendation
                  ? { basedOnRevision: chat.revision }
                  : {}),
              },
            ],
          };
        }
        case "fail":
          if (chat.request?.id !== action.requestId) return chat;
          return {
            ...chat,
            request: null,
            dirty: true,
            error: action.error,
            updatedAt: action.now,
            composer:
              chat.composer ||
              (chat.request.mode === "chat" ? chat.request.message : ""),
          };
        case "cancel":
          return {
            ...chat,
            request: null,
            dirty: true,
            composer:
              chat.composer ||
              (chat.request?.mode === "chat" ? chat.request.message : ""),
            error: "Response stopped. You can revise the brief or send again.",
          };
      }
    }),
  };
}
