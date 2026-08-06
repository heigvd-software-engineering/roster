import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Hint } from "~/components/custom/hint";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { type AssignmentItem, api, useApi } from "~/lib/api";

const NO_TEMPLATE = "No template — empty repository";

/** The words for a failed save. The 409s the teacher can act on get specific
 *  messages: a start that doesn't precede the deadline, or a duplicate title
 *  (the title decides group repo names, so it must be unique in the class).
 *  Everything else gets the per-mode generic. */
function saveErrorMessage(
  status: number,
  code: string | undefined,
  editing: boolean,
) {
  if (code === "start_after_deadline") {
    return "The start must be before the deadline.";
  }
  if (status === 409) {
    return "An assignment with that title already exists in this class.";
  }
  return editing
    ? "Couldn't save the assignment — check the fields and try again."
    : "Couldn't create the assignment — check the fields and try again.";
}

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" in LOCAL time. */
function toDatetimeLocal(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The assignment dialog (F6): title + deadline + mode (group reveals min/max).
 * CREATE mode (no `assignment`) triggers from the class toolbar. EDIT mode
 * (`assignment` given) triggers from the pencil on the assignment's row and
 * prefills from it: same form, same validation, PUT instead of POST. On success
 * the classes list revalidates and the dialog closes.
 */
export function AssignmentDialog({
  classId,
  assignment,
  onSaved,
}: {
  classId: string;
  assignment?: AssignmentItem | undefined;
  /** The OWNER of the classes data revalidates, so the dialog never guesses
   *  cache keys (the hub's key carries its semester window). */
  onSaved: () => unknown;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [startAt, setStartAt] = useState("");
  const [groupMode, setGroupMode] = useState<"individual" | "group">(
    "individual",
  );
  const [minMembers, setMinMembers] = useState("2");
  const [maxMembers, setMaxMembers] = useState("3");
  const [template, setTemplate] = useState<{
    id: number;
    fullName: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openChange(next: boolean) {
    setOpen(next);
    if (next) {
      // (Re-)seed the form on every open, from the assignment when editing and
      // fresh otherwise, so a cancelled edit doesn't leak into the next one.
      setTitle(assignment?.title ?? "");
      setDeadline(assignment ? toDatetimeLocal(assignment.deadline) : "");
      setStartAt(
        assignment?.startAt ? toDatetimeLocal(assignment.startAt) : "",
      );
      setGroupMode(assignment?.groupMode ?? "individual");
      setMinMembers(String(assignment?.minMembers ?? 2));
      setMaxMembers(String(assignment?.maxMembers ?? 3));
      setTemplate(
        assignment?.templateRepoId && assignment.templateRepoFullName
          ? {
              id: assignment.templateRepoId,
              fullName: assignment.templateRepoFullName,
            }
          : null,
      );
      setError(null);
    }
  }

  const valid =
    title.trim().length > 0 &&
    deadline !== "" &&
    (startAt === "" ||
      deadline === "" ||
      new Date(startAt) < new Date(deadline)) &&
    (groupMode === "individual" ||
      (Number(minMembers) >= 1 && Number(minMembers) <= Number(maxMembers)));

  async function submit() {
    setSubmitting(true);
    setError(null);
    const json = {
      title: title.trim(),
      deadline: new Date(deadline).toISOString(),
      ...(startAt !== "" ? { startAt: new Date(startAt).toISOString() } : {}),
      groupMode,
      ...(groupMode === "group"
        ? { minMembers: Number(minMembers), maxMembers: Number(maxMembers) }
        : {}),
      ...(template
        ? {
            templateRepoId: template.id,
            templateRepoFullName: template.fullName,
          }
        : {}),
    };
    try {
      const res = assignment
        ? await api.api.classes[":id"].assignments[":assignmentId"].$put({
            param: { id: classId, assignmentId: assignment.id },
            json,
          })
        : await api.api.classes[":id"].assignments.$post({
            param: { id: classId },
            json,
          });
      if (!res.ok) {
        const code =
          res.status === 409
            ? ((await res.json().catch(() => ({}))) as { error?: string }).error
            : undefined;
        setError(saveErrorMessage(res.status, code, assignment !== undefined));
        return;
      }
      await onSaved();
      setOpen(false);
    } catch {
      setError("Something went wrong — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // NOT dismissible by outside press: date pickers invite clicking away to
    // unfocus a field, and that must not eat a half-filled form. Cancel, the
    // X, and Escape remain the deliberate ways out.
    <Dialog open={open} onOpenChange={openChange} disablePointerDismissal>
      {assignment ? (
        <DialogTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              aria-label={`Edit ${assignment.title}`}
              title="Edit assignment"
            />
          }
        >
          <Pencil className="size-3.5 text-muted-foreground" />
        </DialogTrigger>
      ) : (
        <DialogTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              type="button"
              title="Create a new assignment in this class"
            />
          }
        >
          <Plus className="text-muted-foreground" />
          New assignment
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1">
            {assignment ? "Edit assignment" : "New assignment"}
            {assignment ? (
              // Edits never reshape what already exists, so say so up front
              // instead of confirm-gating every save.
              <Hint
                variant="warning"
                label="Warning about editing a live assignment"
                title="Groups already formed aren't reshaped"
              >
                Shrinking the size range can strand formed groups below the new
                minimum, a different starter template only seeds repositories
                created after the change, and a deadline change re-grades what
                counts as late.
              </Hint>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            {assignment
              ? "Changes are visible to students immediately."
              : "The assignment is visible to students as soon as it is created; a start date keeps them from beginning — and from the starter code — before it."}
          </DialogDescription>
        </DialogHeader>
        <Stack gap="md">
          <Stack gap="sm">
            <Label htmlFor="assignment-title">Title</Label>
            <Input
              id="assignment-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Lab 1 — TCP sockets"
            />
          </Stack>
          <Stack gap="sm">
            <Label htmlFor="assignment-start">Start (optional)</Label>
            <Input
              id="assignment-start"
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
            />
            <Text variant="caption">
              Students see the assignment but cannot start it — no groups, no
              repositories, and no access to the starter code — until this time.
              Leave empty to open the assignment immediately.
            </Text>
          </Stack>
          <Stack gap="sm">
            <Label htmlFor="assignment-deadline">Deadline</Label>
            <Input
              id="assignment-deadline"
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
                <Label htmlFor="assignment-min">Min members</Label>
                <Input
                  id="assignment-min"
                  type="number"
                  min={1}
                  value={minMembers}
                  onChange={(e) => setMinMembers(e.target.value)}
                />
              </Stack>
              <Stack gap="sm">
                <Label htmlFor="assignment-max">Max members</Label>
                <Input
                  id="assignment-max"
                  type="number"
                  min={1}
                  value={maxMembers}
                  onChange={(e) => setMaxMembers(e.target.value)}
                />
              </Stack>
            </Row>
          ) : null}
          <TemplatePicker
            classId={classId}
            value={template}
            onChange={setTemplate}
          />
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
              assignment
                ? "Save — changes are visible to students immediately"
                : "Create — the assignment is visible to students right away"
            }
            onClick={submit}
          >
            {assignment ? "Save changes" : "Create assignment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Starter-code choice: the org's TEMPLATE repos (only repos flagged
 * `is_template` on GitHub can seed new ones). Mounts with the dialog
 * content, so the list is only fetched when the dialog opens (SWR-cached
 * per class after that). "No template" = an empty auto-init repo.
 */
function TemplatePicker({
  classId,
  value,
  onChange,
}: {
  classId: string;
  value: { id: number; fullName: string } | null;
  onChange: (template: { id: number; fullName: string } | null) => void;
}) {
  const { data, isLoading, error } = useApi(api.api.classes[":id"].templates, {
    param: { id: classId },
  });
  const templates = data?.templates ?? [];

  return (
    <Stack gap="sm">
      <Label htmlFor="assignment-template">Starter code</Label>
      {/* Design-system Select, not a native <select>: the OS paints native
          option popups by its own scheme, unstylable and broken in dark mode. */}
      <Select
        items={{
          "": NO_TEMPLATE,
          ...Object.fromEntries(
            templates.map((t) => [String(t.id), t.fullName]),
          ),
        }}
        value={value ? String(value.id) : ""}
        onValueChange={(picked: string | null) => {
          const template = templates.find((t) => String(t.id) === picked);
          onChange(
            template ? { id: template.id, fullName: template.fullName } : null,
          );
        }}
      >
        <SelectTrigger
          id="assignment-template"
          className="h-9 w-full"
          title="The template repository new work repos are generated from"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">{NO_TEMPLATE}</SelectItem>
          {templates.map((t) => (
            <SelectItem key={t.id} value={String(t.id)}>
              {t.fullName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <Text variant="caption">Couldn't load the org's templates.</Text>
      ) : isLoading ? (
        <Text variant="caption">Loading templates…</Text>
      ) : (
        <Text variant="caption">
          {templates.length === 0
            ? "No templates found yet. Starter code must be a repository in this class's organization, marked as a template on GitHub (repo Settings → Template repository) — it can stay private."
            : "Starter code comes from this class's organization: any repository marked as a template on GitHub (repo Settings → Template repository) — private ones work too."}
        </Text>
      )}
    </Stack>
  );
}
