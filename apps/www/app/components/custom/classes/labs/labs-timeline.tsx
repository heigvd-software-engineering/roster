import { Lock } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";
import {
  isDeadlineUrgent,
  relativeLabel,
} from "~/components/custom/classes/labs/deadline-text";
import {
  type LabState,
  LabStatus,
  labState,
} from "~/components/custom/classes/labs/lab-status";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import type { HubLabItem } from "~/lib/api";
import { formatDay, formatDeadline, labModeLabel } from "~/lib/format";
import { cn } from "~/lib/utils";

/**
 * The class card's labs as a RANGE CHART (design 2026-07-23): every lab is a
 * bar from its effective start (`startAt ?? createdAt`) to its deadline on a
 * shared month axis, so overlapping labs look overlapping and the teal
 * now-line answers "where are we in the course" at a glance. Rows read
 * CHRONOLOGICALLY (top = the first lab worked on) — on a timeline, reading
 * order is time order, the same order the API serves.
 *
 * Three states, derived per render from the clock alone:
 *   done     deadline passed — dimmed, muted bar, ✓;
 *   running  started and not due — teal bar, elapsed fill; the label's
 *            status dot pulses (the chart's one animation);
 *   locked   before startAt — amber hatch; for students the row is not a
 *            link and the starter-code chip is hidden, exactly the
 *            locked-row semantics the old LabRow carried.
 *
 * NO GitHub calls behind any of this: bars and statuses are clock math.
 * Push-based standing (late, last push) stays on the lab pages.
 */

/** A lab's place on the axis starts when students can act on it. */
const effectiveStart = (lab: HubLabItem) =>
  new Date(lab.startAt ?? lab.createdAt).getTime();

const monthStart = (year: number, month: number) => new Date(year, month, 1);

/** The chart's span is an INPUT — the caller decides (see `timelineSpan`
 *  in lib/semester.ts: the labs' own dates). */
export type TimelineSpan = { start: Date; end: Date };

/** The axis: EXACTLY the span — the earliest effective start to the last
 *  deadline, no month padding on either side, so the first bar begins at
 *  the chart's left edge and the last ends at its right. `months` holds
 *  every month boundary that falls INSIDE the axis (the gridlines and
 *  their labels); the partial months at the edges have no boundary of
 *  their own, which is the point. */
function buildAxis(span: TimelineSpan) {
  const start = span.start.getTime();
  const end = span.end.getTime();
  let first = monthStart(span.start.getFullYear(), span.start.getMonth());
  if (first.getTime() < start) {
    first = monthStart(first.getFullYear(), first.getMonth() + 1);
  }
  const months: Date[] = [];
  for (
    let m = first;
    m.getTime() < end;
    m = monthStart(m.getFullYear(), m.getMonth() + 1)
  ) {
    months.push(m);
  }
  return { start, end, months };
}

type Axis = ReturnType<typeof buildAxis>;

const pct = (axis: Axis, t: number) =>
  Math.min(
    100,
    Math.max(0, ((t - axis.start) / (axis.end - axis.start)) * 100),
  );

/** Label column width — the one number the axis overlay and every row share. */
const LABEL_W = "320px";

export function LabsTimeline({
  labs,
  span,
  manage = false,
  action,
}: {
  labs: HubLabItem[];
  /** The chart's date span — computed by the CALLER (see `timelineSpan`);
   *  bars outside it clamp to the edges. */
  span: TimelineSpan;
  /** Teacher framing: rows link to /manage, locked rows stay clickable,
   *  and the starter-code chip survives the lock. */
  manage?: boolean;
  /** Per-row trailing control (the teacher's edit pencil). */
  action?: (lab: HubLabItem) => ReactNode;
}) {
  // Course order — chronological by effective start, deadline breaking
  // ties. The API already serves this order; sorting here keeps it a
  // component INVARIANT rather than a hope about the caller.
  const rows = [...labs].sort(
    (a, b) =>
      effectiveStart(a) - effectiveStart(b) ||
      Date.parse(a.deadline) - Date.parse(b.deadline),
  );
  const axis = buildAxis(span);
  // A "now" outside the axis (an archived class, a not-yet-started term)
  // would clamp to an edge and point at the wrong month — drop it instead.
  const now = Date.now();
  const nowPct = now >= axis.start && now <= axis.end ? pct(axis, now) : null;
  const trackRight = action ? "40px" : "0px";

  return (
    <div className="px-7 pt-[30px] pb-[18px]">
      <MonthLabels axis={axis} right={trackRight} />
      <div className="relative">
        <MonthGrid axis={axis} right={trackRight} />
        {rows.map((lab, i) => (
          <TimelineRow
            key={lab.id}
            lab={lab}
            axis={axis}
            manage={manage}
            first={i === 0}
            action={action}
          />
        ))}
        {nowPct !== null ? (
          <NowLine leftPct={nowPct} right={trackRight} />
        ) : null}
      </div>
    </div>
  );
}

/** The month names above the chart, aligned to the track column. */
function MonthLabels({ axis, right }: { axis: Axis; right: string }) {
  return (
    <div
      className="relative mb-2.5 h-[18px]"
      style={{ marginLeft: LABEL_W, marginRight: right }}
    >
      {axis.months.map((m) => (
        <i
          key={m.getTime()}
          className="-translate-x-1/2 absolute top-0 font-mono text-[10.5px] text-muted-foreground uppercase not-italic tracking-[0.12em]"
          style={{ left: `${pct(axis, m.getTime())}%` }}
        >
          {m.toLocaleString("en-GB", { month: "short" })}
        </i>
      ))}
    </div>
  );
}

/** One continuous grid behind every row: a strong line on each month
 *  boundary, a faint one mid-month, and the axis's right border. */
function MonthGrid({ axis, right }: { axis: Axis; right: string }) {
  return (
    <div
      aria-hidden
      className="absolute inset-y-0"
      style={{ left: LABEL_W, right }}
    >
      {axis.months.map((m) => {
        const next = monthStart(m.getFullYear(), m.getMonth() + 1);
        const mid = (m.getTime() + next.getTime()) / 2;
        return (
          <span key={m.getTime()}>
            <i
              className="absolute inset-y-0 w-px bg-foreground/10"
              style={{ left: `${pct(axis, m.getTime())}%` }}
            />
            {/* The last month may be PARTIAL (the axis ends at the last
                deadline) — a midpoint past the end would clamp onto the
                right border; skip it. */}
            {mid < axis.end ? (
              <i
                className="absolute inset-y-0 w-px bg-foreground/5"
                style={{ left: `${pct(axis, mid)}%` }}
              />
            ) : null}
          </span>
        );
      })}
      <i className="absolute inset-y-0 right-0 w-px bg-foreground/10" />
    </div>
  );
}

/** Today, cutting through every row — dot head, mono caps "now · date"
 *  (the label names the line for everyone; there is no tooltip). */
function NowLine({ leftPct, right }: { leftPct: number; right: string }) {
  return (
    <div
      className="absolute top-[22px] bottom-2 z-10 w-[1.5px] bg-role-enrolled"
      style={{
        left: `calc(${LABEL_W} + (100% - ${LABEL_W} - ${right}) * ${leftPct / 100})`,
      }}
    >
      <span className="-top-[5px] -translate-x-1/2 absolute left-1/2 size-2 rounded-full bg-role-enrolled" />
      <span className="-top-[26px] -translate-x-1/2 absolute left-1/2 whitespace-nowrap font-mono font-bold text-[10px] text-role-enrolled uppercase tracking-[0.12em]">
        now · {formatDay(new Date())}
      </span>
    </div>
  );
}

function TimelineRow({
  lab,
  axis,
  manage,
  first,
  action,
}: {
  lab: HubLabItem;
  axis: Axis;
  manage: boolean;
  first: boolean;
  action?: ((lab: HubLabItem) => ReactNode) | undefined;
}) {
  const state = labState(lab);
  // The bar's left edge is the TRUTH: an explicit start when declared,
  // else the moment the lab appeared (it could not be worked on earlier).
  // The bar's tooltip names which of the two it is.
  const startPct = pct(axis, effectiveStart(lab));
  const endPct = pct(axis, Date.parse(lab.deadline));
  const bar = {
    lab,
    leftPct: startPct,
    widthPct: Math.max(endPct - startPct, 1.5),
  };

  const cells = (
    <>
      <RowLabel lab={lab} state={state} manage={manage} />
      <div className="relative h-[92px]">
        {state === "done" ? (
          <DoneBar {...bar} />
        ) : state === "running" ? (
          <RunningBar {...bar} />
        ) : (
          <LockedBar {...bar} />
        )}
        {state === "running" ? (
          <DueAnnotation deadline={new Date(lab.deadline)} endPct={endPct} />
        ) : null}
      </div>
    </>
  );

  const rowClass = cn(
    "grid items-center",
    action
      ? "grid-cols-[320px_minmax(0,1fr)_40px]"
      : "grid-cols-[320px_minmax(0,1fr)]",
    !first && "border-foreground/5 border-t",
  );

  if (state === "locked" && !manage) {
    // Nothing behind the row a student may act on — not a link, dimmed
    // (the same contract the locked list row had).
    return (
      <div
        aria-disabled="true"
        title="This lab hasn't started yet"
        className={cn(rowClass, "opacity-70")}
      >
        {cells}
      </div>
    );
  }
  return (
    <div className={rowClass}>
      <Link
        to={`/classes/${lab.classId}/labs/${lab.id}${manage ? "/manage" : ""}`}
        className="col-span-2 grid grid-cols-subgrid items-center transition-colors hover:bg-muted/40"
      >
        {cells}
      </Link>
      {action ? (
        <div className="flex items-center justify-end">{action(lab)}</div>
      ) : null}
    </div>
  );
}

/**
 * Label column: title / meta / status (design 2026-07-24). The label
 * mirrors the edit form's fields — title, mode, the date range, the
 * template chip — plus ONE derived status word. The range is the only
 * date statement (no "starts" pill).
 */
function RowLabel({
  lab,
  state,
  manage,
}: {
  lab: HubLabItem;
  state: LabState;
  manage: boolean;
}) {
  const start = effectiveStart(lab);
  const deadline = Date.parse(lab.deadline);
  // The chip hides from students while locked: the template's NAME
  // (e.g. lab1-solution) is the leak the start gate exists to prevent.
  const showStarter =
    lab.templateRepoFullName !== null && (state !== "locked" || manage);
  return (
    <div className="min-w-0 pr-5">
      <div
        className={cn(
          "line-clamp-2 font-medium text-sm leading-snug",
          state === "done" && "opacity-55",
          state === "locked" && "text-muted-foreground",
        )}
      >
        {lab.title}
      </div>
      <div
        className={cn(
          "mt-0.5 font-mono text-[11px] text-muted-foreground tabular-nums",
          state === "done" && "opacity-55",
        )}
      >
        <span>{labModeLabel(lab)}</span>
        {/* Only an EXPLICIT start earns range text — a null startAt means
            the bar's left edge is merely the creation date, and printing
            it would read as a chosen start the teacher never set. */}
        <span>
          {" "}
          ·{" "}
          {lab.startAt
            ? `${formatDay(new Date(start))} → ${formatDay(new Date(deadline))}`
            : `due ${formatDay(new Date(deadline))}`}
        </span>
        {showStarter ? <StarterChip name={lab.templateRepoFullName} /> : null}
      </div>
      <LabStatus
        state={state}
        className={cn("mt-1", state === "done" && "opacity-55")}
      />
    </div>
  );
}

/** The template marker — full repo name on hover, never in the text. */
function StarterChip({ name }: { name: string | null }) {
  return (
    <span
      title={name ?? undefined}
      className="ml-1.5 inline-flex items-center rounded-full bg-foreground/6 px-2 py-0.5 font-mono text-[9.5px] text-muted-foreground uppercase tracking-[0.12em]"
    >
      starter code
    </span>
  );
}

type BarProps = { lab: HubLabItem; leftPct: number; widthPct: number };

/** The shared bar shell: the pill positioned on the axis, its tooltip as
 *  the LAST child (overlays painted before it can't eat the hover). The
 *  state components style and fill it. */
function Bar({
  lab,
  leftPct,
  widthPct,
  className,
  style,
  children,
}: BarProps & {
  className: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "-translate-y-1/2 absolute top-1/2 flex h-[26px] items-center rounded-full",
        className,
      )}
      style={{ left: `${leftPct}%`, width: `${widthPct}%`, ...style }}
    >
      {children}
      <BarTooltip lab={lab} />
    </div>
  );
}

/** Done: a quiet muted pill, ✓ at the deadline end. */
function DoneBar(props: BarProps) {
  return (
    <Bar {...props} className="bg-muted ring-1 ring-border ring-inset">
      <span className="mr-2 ml-auto text-[10px] text-muted-foreground">✓</span>
    </Bar>
  );
}

/** Running: teal pill with the elapsed share filled up to "now" — flat on
 *  its leading edge (only the bar's own caps are round). */
function RunningBar(props: BarProps) {
  const start = effectiveStart(props.lab);
  const deadline = Date.parse(props.lab.deadline);
  const elapsedPct = Math.min(
    100,
    Math.max(0, ((Date.now() - start) / (deadline - start)) * 100),
  );
  return (
    <Bar
      {...props}
      className="bg-role-enrolled/15 ring-[1.5px] ring-role-enrolled ring-inset"
    >
      <span
        aria-hidden
        className="absolute inset-0 origin-left rounded-l-full bg-role-enrolled opacity-20"
        style={{ width: `${elapsedPct}%` }}
      />
    </Bar>
  );
}

/** Locked: amber hatch + lock — visibly "not yet", never just dimmed. */
function LockedBar(props: BarProps) {
  return (
    <Bar
      {...props}
      className="ring-[1.5px] ring-warning ring-inset"
      style={{
        backgroundImage:
          "repeating-linear-gradient(-45deg, color-mix(in oklab, var(--warning) 16%, transparent) 0 5px, transparent 5px 10px)",
      }}
    >
      <Lock className="-translate-y-1/2 absolute top-1/2 left-2 size-3 text-warning" />
    </Bar>
  );
}

/** The floating "due … · in N d" right of a running bar — brand-red when
 *  urgent; suppressed when the bar ends too close to the chart's edge to
 *  fit it (the bar's tooltip still carries the date). */
function DueAnnotation({
  deadline,
  endPct,
}: {
  deadline: Date;
  endPct: number;
}) {
  if (endPct >= 74) return null;
  return (
    <span
      className={cn(
        "-translate-y-1/2 absolute top-1/2 whitespace-nowrap font-mono text-[10px] tabular-nums",
        isDeadlineUrgent(deadline)
          ? "font-semibold text-brand"
          : "text-muted-foreground",
      )}
      style={{ left: `calc(${endPct}% + 10px)` }}
    >
      due {formatDay(deadline)} · {relativeLabel(deadline)}
    </span>
  );
}

/** ONE hover surface over the whole bar telling the exact truth about its
 *  span: how it starts (a declared start, or merely its creation — called
 *  out as such) and when it's due. A span, not a button: the row around it
 *  is already the link. */
function BarTooltip({ lab }: { lab: HubLabItem }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="absolute inset-0 z-10 cursor-help" />}
      />
      <TooltipContent side="top">
        <span className="flex flex-col gap-0.5 font-mono">
          <span>
            {lab.startAt
              ? `starts ${formatDeadline(new Date(lab.startAt))}`
              : `created ${formatDeadline(new Date(lab.createdAt))} — no start date set`}
          </span>
          <span>due {formatDeadline(new Date(lab.deadline))}</span>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
