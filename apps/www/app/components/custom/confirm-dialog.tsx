import { type ReactElement, useState } from "react";
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

/**
 * A confirm gate in front of a consequential action: the `trigger` element
 * (with its own icon/label/tooltips) opens a small dialog; the action only
 * runs on explicit confirmation.
 *
 * Controlled mode — `open`/`onOpenChange`, no `trigger` — is for callers
 * whose trigger lives inside something that unmounts on click (the group
 * card's kebab menu item): the dialog must outlive its opener.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
  open: controlledOpen,
  onOpenChange,
}: {
  /** The button that asks for the action (rendered as the dialog trigger).
   *  Omitted in controlled mode. */
  trigger?: ReactElement;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [running, setRunning] = useState(false);

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
        <DialogFooter>
          <Button
            variant="outline"
            title="Close without doing anything"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button disabled={running} title={title} onClick={confirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
