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
import { api } from "~/lib/api";

/**
 * The New-lab Dialog (F6): title + deadline + mode (group reveals min/max).
 * Single published state — the lab is visible to students on create. On
 * success the classes list revalidates and the dialog closes.
 */
export function NewLabDialog({ classId }: { classId: string }) {
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

  const valid =
    title.trim().length > 0 &&
    deadline !== "" &&
    (groupMode === "individual" ||
      (Number(minMembers) >= 1 && Number(minMembers) <= Number(maxMembers)));

  async function create() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.api.classes[":id"].labs.$post({
        param: { id: classId },
        json: {
          title: title.trim(),
          deadline: new Date(deadline).toISOString(),
          groupMode,
          ...(groupMode === "group"
            ? { minMembers: Number(minMembers), maxMembers: Number(maxMembers) }
            : {}),
        },
      });
      if (!res.ok) {
        setError("Couldn't create the lab — check the fields and try again.");
        return;
      }
      await mutate("/api/classes");
      setOpen(false);
      setTitle("");
      setDeadline("");
      setGroupMode("individual");
    } catch {
      setError("Something went wrong — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        + Add a lab
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New lab</DialogTitle>
          <DialogDescription>
            The lab is visible to students as soon as it is created; the
            deadline controls timing.
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
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!valid || submitting} onClick={create}>
            Create lab
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
