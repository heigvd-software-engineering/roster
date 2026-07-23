import { GitBranch, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  isDeadlineUrgent,
  relativeLabel,
} from "~/components/custom/classes/labs/deadline-text";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import type { HubLabItem } from "~/lib/api";
import {
  formatDay,
  formatDeadline,
  labModeLabel,
  labStarted,
} from "~/lib/format";
import { cn } from "~/lib/utils";

/**
 * The class card's labs as a RANGE CHART (design 2026-07-23): every lab is a
 * bar from its effective start (`startAt ?? createdAt`) to its deadline on a
 * shared month axis, so overlapping labs look overlapping and the teal
 * now-line answers "where are we in the course" at a glance. Rows read
 * CHRONOLOGICALLY (top = first lab) — on a timeline, reading order is time
 * order — a deliberate flip of the hub's newest-first sort.
 *
 * Three states, derived per render from the clock alone:
 *   done     deadline passed — dimmed, muted bar, ✓;
 *   running  started and not due — teal bar, elapsed fill, SONAR on the
 *            deadline end (the thing approaching you);
 *   locked   before startAt — amber hatch; for students the row is not a
 *            link and the starter-code pill/seed are hidden, exactly the
 *            locked-row semantics the old LabRow carried.
 *
 * NO GitHub calls behind any of this: bars and statuses are clock math, and
 * the teacher's "x/y repos" tally is a DB aggregate riding on the classes
 * response. Push-based standing (late, last push) stays on the lab pages.
 */

/** A lab's place on the axis starts when students can act on it. */
const effectiveStart = (lab: HubLabItem) =>
  new Date(lab.startAt ?? lab.createdAt).getTime();

const monthStart = (year: number, month: number) => new Date(year, month, 1);

/** The chart's span is an INPUT — the semester, or the labs' own dates:
 *  the caller decides (see `timelineSpan` in lib/semester.ts). */
export type TimelineSpan = { start: Date; end: Date };

/** The axis: the span padded to month edges, plus every month boundary in
 *  between (the gridlines and their labels). An end already sitting on a
 *  month boundary stays put — no phantom empty month. */
function buildAxis(span: TimelineSpan) {
  const start = monthStart(span.start.getFullYear(), span.start.getMonth());
  const endFloor = monthStart(span.end.getFullYear(), span.end.getMonth());
  const end =
    endFloor.getTime() === span.end.getTime()
      ? endFloor
      : monthStart(span.end.getFullYear(), span.end.getMonth() + 1);
  const months: Date[] = [];
  for (
    let m = start;
    m < end;
    m = monthStart(m.getFullYear(), m.getMonth() + 1)
  ) {
    months.push(m);
  }
  return { start: start.getTime(), end: end.getTime(), months };
}

type Axis = ReturnType<typeof buildAxis>;

const pct = (axis: Axis, t: number) =>
  Math.min(
    100,
    Math.max(0, ((t - axis.start) / (axis.end - axis.start)) * 100),
  );

type LabState = "done" | "running" | "locked";

const stateOf = (lab: HubLabItem): LabState =>
  !labStarted(lab)
    ? "locked"
    : Date.parse(lab.deadline) < Date.now()
      ? "done"
      : "running";

/** Label column width — the one number the axis overlay and every row share. */
const LABEL_W = "280px";

export function LabsTimeline({
  labs,
  span,
  manage = false,
  action,
}: {
  labs: HubLabItem[];
  /** The chart's date span — computed by the CALLER (semester vs the labs'
   *  own dates); bars outside it clamp to the edges. */
  span: TimelineSpan;
  /** Teacher framing: rows link to /manage, locked rows stay clickable,
   *  starter pills survive the lock, and the repo tally shows. */
  manage?: boolean;
  /** Per-row trailing control (the teacher's edit pencil). */
  action?: (lab: HubLabItem) => ReactNode;
}) {
  const rows = [...labs].sort((a, b) => effectiveStart(a) - effectiveStart(b));
  const axis = buildAxis(span);
  // A "now" outside the axis (an archived class, a not-yet-started term)
  // would clamp to an edge and point at the wrong month — drop it instead.
  const now = Date.now();
  const nowPct = now >= axis.start && now <= axis.end ? pct(axis, now) : null;
  const trackRight = action ? "40px" : "0px";

  return (
    <div className="px-7 pt-[30px] pb-[18px]">
      {/* Month labels above the chart, aligned to the track column. */}
      <div
        className="relative mb-2.5 h-[18px]"
        style={{ marginLeft: LABEL_W, marginRight: trackRight }}
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

      <div className="relative">
        {/* One continuous grid behind every row: strong month lines, faint
            mid-month lines. */}
        <div
          aria-hidden
          className="absolute inset-y-0"
          style={{ left: LABEL_W, right: trackRight }}
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
                <i
                  className="absolute inset-y-0 w-px bg-foreground/5"
                  style={{ left: `${pct(axis, mid)}%` }}
                />
              </span>
            );
          })}
          <i className="absolute inset-y-0 right-0 w-px bg-foreground/10" />
        </div>

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

        {/* Today, cutting through every row. */}
        {/* The visible "now · date" text inside labels this for everyone. */}
        {nowPct !== null ? (
          <div
            className="absolute top-[22px] bottom-2 z-10 w-[1.5px] bg-role-enrolled"
            style={{
              left: `calc(${LABEL_W} + (100% - ${LABEL_W} - ${trackRight}) * ${nowPct / 100})`,
            }}
          >
            <span className="-top-[5px] -translate-x-1/2 absolute left-1/2 size-2 rounded-full bg-role-enrolled" />
            <span className="-top-[26px] -translate-x-1/2 absolute left-1/2 whitespace-nowrap font-mono font-bold text-[10px] text-role-enrolled uppercase tracking-[0.12em]">
              now · {formatDay(new Date())}
            </span>
          </div>
        ) : null}
      </div>
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
  const state = stateOf(lab);
  // The bar's left edge is the TRUTH: an explicit start when declared,
  // else the moment the lab appeared (it could not be worked on earlier).
  // A missing start shows as a FADED edge — crisp cap = a chosen start —
  // and both ends explain themselves on hover.
  const start = effectiveStart(lab);
  const deadline = Date.parse(lab.deadline);
  const startPct = pct(axis, start);
  const endPct = pct(axis, deadline);
  const width = Math.max(endPct - startPct, 1.5);
  const urgent = isDeadlineUrgent(new Date(lab.deadline));
  // The seed/pill hide from students while locked: the template's NAME
  // (e.g. lab1-solution) is the leak the start gate exists to prevent.
  const showStarter =
    lab.templateRepoFullName !== null && (state !== "locked" || manage);

  const cells = (
    <>
      {/* ---- label column ---- */}
      <div className="min-w-0 pr-5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "truncate font-medium text-sm",
              state === "done" && "opacity-55",
              state === "locked" && "text-muted-foreground",
            )}
          >
            {lab.title}
          </span>
          {showStarter ? (
            <span
              title={lab.templateRepoFullName ?? undefined}
              className="inline-flex shrink-0 items-center rounded-full bg-foreground/6 px-2 py-0.5 font-mono text-[9.5px] text-muted-foreground uppercase tracking-[0.12em]"
            >
              starter code
            </span>
          ) : null}
          {state === "locked" && lab.startAt ? (
            <span className="inline-flex shrink-0 items-center rounded-full bg-warning/10 px-2 py-0.5 font-mono text-[9.5px] text-warning uppercase tracking-[0.12em]">
              starts {formatDay(new Date(lab.startAt))}
            </span>
          ) : null}
        </div>
        <div
          className={cn(
            "mt-0.5 font-mono text-[11px] text-muted-foreground tabular-nums",
            state === "done" && "opacity-55",
            state === "locked" && "text-warning",
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
          {manage && lab.groupsCount > 0 ? (
            <span>
              {" "}
              · {lab.reposCount}/{lab.groupsCount} repos
            </span>
          ) : null}
          {state === "locked" ? (
            <span>
              {" "}
              ·{" "}
              {manage
                ? "hidden from students"
                : `opens ${relativeLabel(new Date(start))}`}
            </span>
          ) : null}
        </div>
      </div>

      {/* ---- track ---- */}
      <div className="relative h-16">
        <div
          className={cn(
            "-translate-y-1/2 absolute top-1/2 flex h-5 items-center rounded-full",
            state === "done" && "bg-muted ring-1 ring-border ring-inset",
            state === "running" &&
              "bg-role-enrolled/15 ring-[1.5px] ring-role-enrolled ring-inset",
            state === "locked" && "ring-[1.5px] ring-warning ring-inset",
          )}
          style={{
            left: `${startPct}%`,
            width: `${width}%`,
            ...(state === "locked"
              ? {
                  backgroundImage:
                    "repeating-linear-gradient(-45deg, color-mix(in oklab, var(--warning) 16%, transparent) 0 5px, transparent 5px 10px)",
                }
              : {}),
            ...(lab.startAt === null
              ? {
                  maskImage:
                    "linear-gradient(to right, transparent, black 22px)",
                }
              : {}),
          }}
        >
          <EdgeTooltip
            side="left"
            text={
              lab.startAt
                ? `starts ${formatDeadline(new Date(lab.startAt))}`
                : `created ${formatDeadline(new Date(lab.createdAt))} — no start date set`
            }
          />
          <EdgeTooltip
            side="right"
            text={`due ${formatDeadline(new Date(lab.deadline))}`}
          />
          {showStarter ? (
            <span
              aria-hidden
              className={cn(
                "-left-[5px] -translate-y-1/2 absolute top-1/2 grid size-3 place-items-center rounded-full bg-card ring-[1.5px]",
                state === "locked"
                  ? "text-warning ring-warning"
                  : "text-muted-foreground ring-muted-foreground",
              )}
            >
              <GitBranch className="size-2" />
            </span>
          ) : null}
          {state === "running" ? (
            <span
              aria-hidden
              className="absolute inset-0 origin-left rounded-full bg-role-enrolled opacity-20"
              style={{
                width: `${Math.min(100, Math.max(0, ((Date.now() - start) / (deadline - start)) * 100))}%`,
              }}
            />
          ) : null}
          {state === "done" ? (
            <span className="mr-2 ml-auto text-[10px] text-muted-foreground">
              ✓
            </span>
          ) : null}
          {state === "locked" ? (
            <Lock className="-translate-y-1/2 absolute top-1/2 left-2 size-2.5 text-warning" />
          ) : null}
          {state === "running" ? <SonarCap /> : null}
        </div>
        {state === "running" && endPct < 74 ? (
          <span
            className={cn(
              "-translate-y-1/2 absolute top-1/2 whitespace-nowrap font-mono text-[10px] tabular-nums",
              urgent ? "font-semibold text-brand" : "text-muted-foreground",
            )}
            style={{ left: `calc(${endPct}% + 10px)` }}
          >
            due {formatDay(new Date(deadline))} ·{" "}
            {relativeLabel(new Date(deadline))}
          </span>
        ) : null}
      </div>
    </>
  );

  const rowClass = cn(
    "grid items-center",
    action
      ? "grid-cols-[280px_minmax(0,1fr)_40px]"
      : "grid-cols-[280px_minmax(0,1fr)]",
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

/** The pulse on a running bar's deadline end — two staggered rings, calm
 *  cadence; a static halo when the user prefers reduced motion. */
function SonarCap() {
  return (
    <span className="-right-1 -translate-y-1/2 absolute top-1/2 size-[9px] rounded-full bg-role-enrolled">
      <span
        aria-hidden
        className="motion-reduce:!animate-none absolute inset-[-1px] animate-ping rounded-full border-[1.5px] border-role-enrolled [animation-duration:2.6s] motion-reduce:scale-[1.9] motion-reduce:opacity-30"
      />
      <span
        aria-hidden
        className="absolute inset-[-1px] animate-ping rounded-full border-[1.5px] border-role-enrolled [animation-delay:1.3s] [animation-duration:2.6s] motion-reduce:hidden"
      />
    </span>
  );
}

/** An invisible hover zone on one end of a bar that tells the exact truth
 *  about that edge — "starts …" / "created … — no start date set" on the
 *  left, "due …" on the right. A span, not a button: the row around it is
 *  already the link. */
function EdgeTooltip({ side, text }: { side: "left" | "right"; text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "absolute inset-y-0 w-5 cursor-help",
              side === "left" ? "left-0" : "right-0",
            )}
          />
        }
      />
      <TooltipContent side="top">
        <span className="font-mono">{text}</span>
      </TooltipContent>
    </Tooltip>
  );
}
