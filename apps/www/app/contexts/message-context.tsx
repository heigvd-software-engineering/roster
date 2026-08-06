import { CircleX, Info, TriangleAlert, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "~/lib/utils";

type MessageVariant = "info" | "error" | "warning";

type Message = { id: number; text: string; variant: MessageVariant };

type MessageActions = {
  /** Show a transient message in the strip under the app header. */
  push: (
    text: string,
    opts?: { variant?: MessageVariant; durationMs?: number },
  ) => void;
  /** Remove a message by id; the viewport's dismiss button calls it. */
  dismiss: (id: number) => void;
};

const DEFAULT_DURATION_MS = 5_000;

// Two contexts on purpose: `push`/`dismiss` are stable, so writers (every
// action button, header, page via useMessages) subscribe to the actions
// context and never re-render on toast activity. The volatile `messages`
// array lives in its own context, consumed only by <MessageViewport>.
const MessageActionsContext = createContext<MessageActions | null>(null);
const MessageListContext = createContext<Message[] | null>(null);

/**
 * Global transient messages: pushed from anywhere via useMessages(), shown
 * by <MessageViewport> as an overlay just below the app header, so content
 * never shifts. Auto-dismissed (default 5s), dismissable, three variants.
 * Scope rule: page-level action feedback goes here; a modal form's
 * validation and submit errors stay inline in the dialog, next to their fix
 * (a message strip would sit behind the dialog overlay).
 */
export function MessageProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setMessages((current) => current.filter((m) => m.id !== id));
  }, []);

  const push = useCallback<MessageActions["push"]>(
    (text, opts) => {
      const id = nextId.current++;
      setMessages((current) => [
        ...current,
        { id, text, variant: opts?.variant ?? "info" },
      ]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), opts?.durationMs ?? DEFAULT_DURATION_MS),
      );
    },
    [dismiss],
  );

  // Pending timers must not outlive the provider.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }, []);

  // push/dismiss never change identity, so this value doesn't either.
  const actions = useMemo<MessageActions>(
    () => ({ push, dismiss }),
    [push, dismiss],
  );
  return (
    <MessageActionsContext.Provider value={actions}>
      <MessageListContext.Provider value={messages}>
        {children}
      </MessageListContext.Provider>
    </MessageActionsContext.Provider>
  );
}

function useMessageActions(): MessageActions {
  const value = useContext(MessageActionsContext);
  if (!value) {
    throw new Error("useMessages must be used inside <MessageProvider>");
  }
  return value;
}

/** Push global messages from anywhere: `useMessages().push("…", {variant})`. */
export function useMessages(): Pick<MessageActions, "push"> {
  const { push } = useMessageActions();
  return { push };
}

const VARIANT = {
  info: { Icon: Info, tone: "text-muted-foreground" },
  warning: { Icon: TriangleAlert, tone: "text-muted-foreground" },
  error: { Icon: CircleX, tone: "text-destructive" },
} as const;

/** The message strip: an absolute overlay AppLayout renders right under the
 *  header, so nothing below it moves. */
export function MessageViewport() {
  const messages = useContext(MessageListContext);
  const { dismiss } = useMessageActions();
  if (!messages || messages.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-50 flex flex-col items-center gap-2 px-4">
      {messages.map((message) => {
        const { Icon, tone } = VARIANT[message.variant];
        return (
          <div
            key={message.id}
            role={message.variant === "error" ? "alert" : "status"}
            className="pointer-events-auto flex max-w-xl items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <Icon className={cn("size-4 shrink-0", tone)} />
            <span>{message.text}</span>
            <button
              type="button"
              aria-label="Dismiss"
              title="Dismiss"
              onClick={() => dismiss(message.id)}
              className="ml-1 cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
