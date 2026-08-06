import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";

/**
 * A confirm gate in front of a consequential action: the `trigger` element
 * opens a small dialog, and the action runs only on explicit confirmation.
 *
 * Controlled mode (`open`/`onOpenChange`, no `trigger`) serves callers whose
 * trigger unmounts on click, like the group card's kebab menu item: the
 * dialog must outlive its opener.
 *
 * `requireText` raises the gate for the rare action that destroys something
 * unrecoverable: the words must be typed out, so no muscle-memory Enter can
 * carry it, and the confirm button turns destructive. Reach for it only where a
 * second click genuinely isn't enough — in practice, through `DeleteDialog`.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
  open: controlledOpen,
  onOpenChange,
  requireText,
  children,
}: {
  /** The button that opens the dialog. Omitted in controlled mode. */
  trigger?: ReactElement | undefined;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** Exact words the caller must type before confirming is possible. Asking
   *  for them is also what makes the confirm button destructive: no gated
   *  action is harmless, and no harmless one is worth the typing. */
  requireText?: string | undefined;
  /** What is at stake, between the description and the confirm phrase. */
  children?: ReactNode;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [running, setRunning] = useState(false);
  const [typed, setTyped] = useState("");

  // On close, not on open: a controlled caller can flip `open` without going
  // through `setOpen`, so a half-typed phrase would otherwise survive into the
  // next thing the same dialog is asked to confirm.
  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const armed = requireText === undefined || typed.trim() === requireText;

  async function confirm() {
    setRunning(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger !== undefined ? <DialogTrigger render={trigger} /> : null}
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        {requireText !== undefined ? (
          <ConfirmPhrase
            phrase={requireText}
            value={typed}
            onChange={setTyped}
          />
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            title="Close without doing anything"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            variant={requireText === undefined ? "default" : "destructive"}
            disabled={running || !armed}
            title={title}
            onClick={confirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The typed-phrase gate: the words to copy, shown verbatim, over the field
 *  that must match them. */
function ConfirmPhrase({
  phrase,
  value,
  onChange,
}: {
  phrase: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <Stack gap="sm">
      <Text variant="body2">
        Type <PhraseToCopy text={phrase} /> to confirm.
      </Text>
      <Input
        aria-label={`Type ${phrase} to confirm`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
    </Stack>
  );
}

/** The exact words, selectable and monospaced so they can be copied rather
 *  than retyped (a title may hold an em dash nobody wants to hunt for). */
function PhraseToCopy({ text }: { text: string }) {
  return (
    <code className="select-all rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
      {text}
    </code>
  );
}
