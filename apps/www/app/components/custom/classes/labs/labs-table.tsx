import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  type LabState,
  LabStatus,
  labState,
} from "~/components/custom/classes/labs/lab-status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import type { HubLabItem } from "~/lib/api";
import { formatDay, labModeLabel } from "~/lib/format";

/**
 * The class card's labs, as a plain table: one row per lab, chronological
 * (top = the first lab worked on), with the lab's own fields — title, mode,
 * dates, derived status — and the teacher's edit control at the end.
 *
 * The status is clock math, no GitHub calls: a lab is locked before its
 * start, running until its deadline, done after it. Push-based standing
 * (late, last push) stays on the lab pages.
 */

/** A lab's row order starts when students can act on it. */
const effectiveStart = (lab: HubLabItem) =>
  new Date(lab.startAt ?? lab.createdAt).getTime();

/** The one date statement. Only an EXPLICIT start earns a range: with a null
 *  startAt the earlier date is merely the creation date, and printing it
 *  would read as a chosen start the teacher never set. */
function dates(lab: HubLabItem) {
  const deadline = formatDay(new Date(lab.deadline));
  return lab.startAt
    ? `${formatDay(new Date(lab.startAt))} → ${deadline}`
    : `due ${deadline}`;
}

export function LabsTable({
  labs,
  manage = false,
  action,
}: {
  labs: HubLabItem[];
  /** Teacher framing: rows link to /manage, locked rows stay clickable, and
   *  the starter-code marker survives the lock. */
  manage?: boolean;
  /** Per-row trailing control (the teacher's edit dialog). */
  action?: (lab: HubLabItem) => ReactNode;
}) {
  // Course order: chronological by effective start, deadline breaking ties.
  // The API already serves this order; sorting here keeps it a component
  // INVARIANT rather than a hope about the caller.
  const rows = [...labs].sort(
    (a, b) =>
      effectiveStart(a) - effectiveStart(b) ||
      Date.parse(a.deadline) - Date.parse(b.deadline),
  );

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Lab</TableHead>
          <TableHead>Mode</TableHead>
          <TableHead>Dates</TableHead>
          <TableHead>Status</TableHead>
          {action ? <TableHead className="w-10" /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((lab) => (
          <LabRow key={lab.id} lab={lab} manage={manage} action={action} />
        ))}
      </TableBody>
    </Table>
  );
}

function LabRow({
  lab,
  manage,
  action,
}: {
  lab: HubLabItem;
  manage: boolean;
  action?: ((lab: HubLabItem) => ReactNode) | undefined;
}) {
  const state = labState(lab);
  return (
    <TableRow>
      <TableCell className="font-medium">
        <LabTitle lab={lab} state={state} manage={manage} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        {labModeLabel(lab)}
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums">
        {dates(lab)}
      </TableCell>
      <TableCell>
        <LabStatus state={state} />
      </TableCell>
      {action ? (
        <TableCell className="text-right">{action(lab)}</TableCell>
      ) : null}
    </TableRow>
  );
}

/**
 * The lab's name, a link to its page unless the reader is a student and the
 * lab hasn't started — then there is nothing behind it they may act on.
 * The starter-code note hides from students while locked: the template's NAME
 * (e.g. lab1-solution) is the leak the start gate exists to prevent.
 */
function LabTitle({
  lab,
  state,
  manage,
}: {
  lab: HubLabItem;
  state: LabState;
  manage: boolean;
}) {
  const starter =
    lab.templateRepoFullName !== null && (state !== "locked" || manage) ? (
      <span
        className="ml-2 font-normal text-muted-foreground text-xs"
        title={lab.templateRepoFullName}
      >
        starter code
      </span>
    ) : null;

  if (state === "locked" && !manage) {
    return (
      <span
        aria-disabled="true"
        title="This lab hasn't started yet"
        className="text-muted-foreground"
      >
        {lab.title}
        {starter}
      </span>
    );
  }
  return (
    <>
      <Link
        to={`/classes/${lab.classId}/labs/${lab.id}${manage ? "/manage" : ""}`}
        className="hover:underline"
      >
        {lab.title}
      </Link>
      {starter}
    </>
  );
}
