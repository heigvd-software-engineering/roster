import { Pencil } from "lucide-react";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { Row } from "~/components/custom/layout/row";
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
import { Label } from "~/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { api, type LabItem } from "~/lib/api";

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" in LOCAL time. */
function toDatetimeLocal(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The lab dialog (F6): title + deadline + mode (group reveals min/max).
 * CREATE mode (no `lab`) triggers from the ghost row at the labs table's
 * foot; EDIT mode (`lab` given) triggers from the pencil on the lab's row
 * and prefills from it — same form, same validation, PUT instead of POST.
 * On success the classes list revalidates and the dialog closes.
 */
export function LabDialog({
  classId,
  lab,
}: {
  classId: string;
  lab?: LabItem;
}) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [groupMode, setGroupMode] = useState<"individual" | "group">(
    "individual",
  );
  const [minMembers, setMinMembers] = useState("2");
  const [maxMembers, setMaxMembers] = useState("3");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openChange(next: boolean) {
    setOpen(next);
    if (next) {
      // (Re-)seed the form on every open: from the lab when editing, fresh
      // otherwise — so a cancelled edit doesn't leak into the next one.
      setTitle(lab?.title ?? "");
      setDeadline(lab ? toDatetimeLocal(lab.deadline) : "");
      setGroupMode(lab?.groupMode ?? "individual");
      setMinMembers(String(lab?.minMembers ?? 2));
      setMaxMembers(String(lab?.maxMembers ?? 3));
      setError(null);
    }
  }

  const valid =
    title.trim().length > 0 &&
    deadline !== "" &&
    (groupMode === "individual" ||
      (Number(minMembers) >= 1 && Number(minMembers) <= Number(maxMembers)));

  async function submit() {
    setSubmitting(true);
    setError(null);
    const json = {
      title: title.trim(),
      deadline: new Date(deadline).toISOString(),
      groupMode,
      ...(groupMode === "group"
        ? { minMembers: Number(minMembers), maxMembers: Number(maxMembers) }
        : {}),
    };
    try {
      const res = lab
        ? await api.api.classes[":id"].labs[":labId"].$put({
            param: { id: classId, labId: lab.id },
            json,
          })
        : await api.api.classes[":id"].labs.$post({
            param: { id: classId },
            json,
          });
      if (!res.ok) {
        setError(
          lab
            ? "Couldn't save the lab — check the fields and try again."
            : "Couldn't create the lab — check the fields and try again.",
        );
        return;
      }
      await mutate("/api/classes");
      setOpen(false);
    } catch {
      setError("Something went wrong — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={openChange}>
      {lab ? (
        <DialogTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              aria-label={`Edit ${lab.title}`}
              title="Edit lab"
            />
          }
        >
          <Pencil className="size-3.5 text-muted-foreground" />
        </DialogTrigger>
      ) : (
        // Notion-style ghost row at the table's foot: the add action lives
        // where the added lab will appear.
        <DialogTrigger
          render={
            <button
              type="button"
              title="Create a new lab in this class"
              className="flex w-full cursor-pointer items-center gap-2 px-5 py-2.5 text-left text-muted-foreground text-sm transition-colors hover:bg-muted/60 hover:text-foreground"
            />
          }
        >
          <span className="font-mono">+</span> New lab
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{lab ? "Edit lab" : "New lab"}</DialogTitle>
          <DialogDescription>
            {lab
              ? "Changes are visible to students immediately."
              : "The lab is visible to students as soon as it is created; the deadline controls timing."}
          </DialogDescription>
        </DialogHeader>
        <Stack gap="md">
          <Stack gap="sm">
            <Label htmlFor="lab-title">Title</Label>
            <Input
              id="lab-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Lab 1 — TCP sockets"
            />
          </Stack>
          <Stack gap="sm">
            <Label htmlFor="lab-deadline">Deadline</Label>
            <Input
              id="lab-deadline"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </Stack>
          <Stack gap="sm">
            <Label>Mode</Label>
            <ToggleGroup
              value={[groupMode]}
              onValueChange={(v: string[]) => {
                const next = v[0];
                if (next === "individual" || next === "group") {
                  setGroupMode(next);
                }
              }}
            >
              <ToggleGroupItem value="individual">Individual</ToggleGroupItem>
              <ToggleGroupItem value="group">Group</ToggleGroupItem>
            </ToggleGroup>
          </Stack>
          {groupMode === "group" ? (
            <Row gap="md">
              <Stack gap="sm">
                <Label htmlFor="lab-min">Min members</Label>
                <Input
                  id="lab-min"
                  type="number"
                  min={1}
                  value={minMembers}
                  onChange={(e) => setMinMembers(e.target.value)}
                />
              </Stack>
              <Stack gap="sm">
                <Label htmlFor="lab-max">Max members</Label>
                <Input
                  id="lab-max"
                  type="number"
                  min={1}
                  value={maxMembers}
                  onChange={(e) => setMaxMembers(e.target.value)}
                />
              </Stack>
            </Row>
          ) : null}
          {error ? <Text variant="error">{error}</Text> : null}
        </Stack>
        <DialogFooter>
          <Button
            variant="outline"
            title="Close without saving"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={!valid || submitting}
            title={
              lab
                ? "Save — changes are visible to students immediately"
                : "Create — the lab is visible to students right away"
            }
            onClick={submit}
          >
            {lab ? "Save changes" : "Create lab"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
