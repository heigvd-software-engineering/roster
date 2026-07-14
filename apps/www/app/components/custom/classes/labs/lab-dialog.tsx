import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
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
import { api, type LabItem, useApi } from "~/lib/api";

const NO_TEMPLATE = "No template — empty repository";

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" in LOCAL time. */
function toDatetimeLocal(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The lab dialog (F6): title + deadline + mode (group reveals min/max).
 * CREATE mode (no `lab`) triggers from the class toolbar; EDIT mode (`lab`
 * given) triggers from the pencil on the lab's row and prefills from it —
 * same form, same validation, PUT instead of POST. On success the classes
 * list revalidates and the dialog closes.
 */
export function LabDialog({
  classId,
  lab,
  onSaved,
}: {
  classId: string;
  lab?: LabItem;
  /** The OWNER of the classes data revalidates — the dialog never guesses
   *  cache keys (the hub's key carries its semester window). */
  onSaved: () => unknown;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
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
      // (Re-)seed the form on every open: from the lab when editing, fresh
      // otherwise — so a cancelled edit doesn't leak into the next one.
      setTitle(lab?.title ?? "");
      setDeadline(lab ? toDatetimeLocal(lab.deadline) : "");
      setGroupMode(lab?.groupMode ?? "individual");
      setMinMembers(String(lab?.minMembers ?? 2));
      setMaxMembers(String(lab?.maxMembers ?? 3));
      setTemplate(
        lab?.templateRepoId && lab.templateRepoFullName
          ? { id: lab.templateRepoId, fullName: lab.templateRepoFullName }
          : null,
      );
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
      ...(template
        ? {
            templateRepoId: template.id,
            templateRepoFullName: template.fullName,
          }
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
        // A duplicate title is the one failure the teacher can act on: the lab
        // title decides the group repo names, so it must be unique in the class.
        setError(
          res.status === 409
            ? "A lab with that title already exists in this class."
            : lab
              ? "Couldn't save the lab — check the fields and try again."
              : "Couldn't create the lab — check the fields and try again.",
        );
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
        <DialogTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              type="button"
              title="Create a new lab in this class"
            />
          }
        >
          <Plus className="text-muted-foreground" />
          New lab
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
      <Label htmlFor="lab-template">Starter code</Label>
      {/* Design-system Select (not a native <select>): the OS paints native
          option popups by its own scheme — unstylable, broken in dark mode. */}
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
          id="lab-template"
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
