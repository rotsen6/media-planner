import { z } from "zod";
import {
  briefFieldSchema,
  briefSchema,
  KPI_LABELS,
  type Brief,
  type Kpi,
} from "./brief";
import { number } from "./evidence";
import {
  pendingFieldsSchema,
  turnResponseSchema,
  type TurnResponse,
} from "./contract";

export const HISTORY_KEY = "kargo.media-planner.v1";
const FIELDS = briefFieldSchema.options;
const formSchema = z.record(briefFieldSchema, z.string());
export type FormBrief = z.infer<typeof formSchema>;
const emptyForm = Object.fromEntries(
  FIELDS.map((key) => [key, ""]),
) as FormBrief;
export const formFromBrief = (brief: Brief) =>
  Object.fromEntries(
    FIELDS.map((key) => [key, brief[key]?.toString() ?? ""]),
  ) as FormBrief;
/** Blank fields are null and numeric fields are numbers; undefined when invalid. */
export const briefFromForm = (form: FormBrief): Brief | undefined =>
  briefSchema.safeParse(
    Object.fromEntries(
      FIELDS.map((key) => [
        key,
        !form[key].trim()
          ? null
          : key === "budget" || key === "impressionGoal"
            ? Number(form[key])
            : form[key],
      ]),
    ),
  ).data;

const storedChatSchema = z.object({
  id: z.string().min(1),
  updatedAt: z.number(),
  form: formSchema,
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
      mode: z.enum(["chat", "brief"]),
      message: z.string(),
    })
    .nullable(),
  error: z.string(),
  planOpen: z.boolean(),
});
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
});
const hasContent = (chat: Conversation) =>
  !!chat.messages.length ||
  !!chat.composer.trim() ||
  Object.values(chat.form).some((value) => value.trim());
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
  const place = [chat.form.vertical, chat.form.geo].filter(Boolean);
  return place.join(" · ") || "Draft";
}
export const historyChats = (state: WorkspaceState) =>
  state.chats.filter(hasContent).sort((a, b) => b.updatedAt - a.updatedAt);
/** The transcript line for a calculation started from the brief editor. */
export const briefMessage = (f: FormBrief) =>
  [
    "Campaign brief",
    f.clientName,
    f.vertical,
    f.geo,
    f.kpi && KPI_LABELS[f.kpi as Kpi],
    f.budget && `$${Number(f.budget).toLocaleString("en-US")} budget`,
    f.impressionGoal && `${number(+f.impressionGoal)} minimum impressions`,
  ]
    .filter(Boolean)
    .join(" · ");

const sameBrief = (form: FormBrief, response: TurnResponse) => {
  const brief = briefFromForm(form);
  return (
    !!brief &&
    FIELDS.every(
      (key) => (brief[key] ?? null) === (response.brief[key] ?? null),
    )
  );
};
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
          "The last response was interrupted. Send again or update the plan to continue.",
      };
    // A saved plan is trusted only while it is valid, clean, and matches its brief.
    const parsed = turnResponseSchema.safeParse(stored.result).data;
    const result =
      parsed && !stored.dirty && sameBrief(stored.form, parsed) ? parsed : null;
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
  chat.composer || (chat.request?.mode === "chat" ? chat.request.message : "");
// A brief change drops the plan at once; the new revision marks older answers stale.
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
    case "error":
      return { ...chat, error: action.error };
    case "edit":
      return {
        ...invalidate(chat),
        form: { ...chat.form, [action.field]: action.value },
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
      // Late answers to a stopped, edited, or replaced request are ignored.
      if (chat.request?.id !== action.requestId) return chat;
      const next = action.response;
      // Only a changed brief makes earlier plan messages stale.
      const revision = chat.revision + (sameBrief(chat.form, next) ? 0 : 1);
      const text =
        next.status === "ready"
          ? next.explanation[0]
          : next.explanation.join("\n\n");
      return {
        ...chat,
        form: formFromBrief(next.brief),
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
            text,
            ...(next.recommendation ? { basedOnRevision: revision } : {}),
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
        composer: recoverDraft(chat),
      };
    case "cancel":
      return {
        ...chat,
        request: null,
        dirty: true,
        composer: recoverDraft(chat),
        error: "Response stopped. You can revise the brief or send again.",
      };
  }
}
