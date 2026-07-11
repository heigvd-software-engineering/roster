import type { InferResponseType } from "hono/client";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { ReconcileGuideDialog } from "~/components/custom/classes/reconcile/reconcile-guide-dialog";
import { Page } from "~/components/custom/layout/page";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Loading } from "~/components/custom/loading";
import { StateChange } from "~/components/custom/state-change";
import { BrandHeader } from "~/components/custom/typography/brand-header";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { api, useApi } from "~/lib/api";
import { cn } from "~/lib/utils";

/** INFERRED from the audit endpoint (the server's `lib/reconcile/types.ts` is
 *  the one source) — hand-modeling this shape would sever the compile-time
 *  link the type spine exists to keep. */
type Finding = InferResponseType<
  (typeof api.api.classes)[":id"]["audit"]["$get"],
  200
>["findings"][number];
type Severity = Finding["severity"];

/** The reconcilers, in the order a teacher should read them: what the class IS,
 *  then who is in it, then what they work in, then who can see what. */
const SECTIONS: { name: string; reconcilers: string[] }[] = [
  { name: "Class", reconcilers: ["installation", "identity"] },
  { name: "Roster", reconcilers: ["roster"] },
  {
    name: "Groups",
    reconcilers: ["group-teams", "group-members", "work-repos"],
  },
  { name: "Security", reconcilers: ["base-permission"] },
];

/** A finding's severity, as a left spine. Scanning the column, a teacher must
 *  tell "this is broken" from "this merely drifted" without reading a word. */
const SPINE: Record<Severity, string> = {
  broken: "border-l-destructive",
  drift: "border-l-warning",
  info: "border-l-border",
};

/**
 * Group the findings into the sections above, and sweep everything else into a
 * final one. Adding a reconciler is meant to be a file and one line on the
 * server — if its name is missing here, its findings must still reach the
 * teacher rather than silently vanishing from the page that exists to surface
 * them.
 */
function sections(findings: Finding[]) {
  const known = new Set(SECTIONS.flatMap((s) => s.reconcilers));
  const rest = findings.filter((f) => !known.has(f.reconciler));
  return [
    ...SECTIONS.map((s) => ({
      name: s.name,
      rows: findings.filter((f) => s.reconcilers.includes(f.reconciler)),
    })),
    { name: "Other", rows: rest },
  ].filter((s) => s.rows.length > 0);
}

/** Everything a fix could do, on first load. A finding we can see but cannot
 *  fix (`fix === null`) has no checkbox at all. */
const initialSelection = (findings: Finding[]) =>
  new Set(findings.filter((f) => f.fix).map((f) => f.key));

const fixable = (findings: Finding[]) => findings.filter((f) => f.fix);

/**
 * /classes/:id/reconcile — audit the class against GitHub, then apply only what
 * the teacher accepts. The audit is a pure read; nothing here repairs anything
 * until Apply is pressed.
 */
export function ReconcilePage() {
  const { id = "" } = useParams();
  const { data, isLoading, error, mutate } = useApi(
    api.api.classes[":id"].audit,
    { param: { id } },
  );
  const cls = data?.class;

  const findings = data?.findings ?? [];
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Seed the selection from the first audit that arrives, then leave it alone —
  // re-seeding on every render would fight the teacher's clicks.
  const checked = selected ?? initialSelection(findings);

  function toggle(key: string) {
    const next = new Set(checked);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setSelected(next);
  }

  async function apply() {
    setApplying(true);
    setResult(null);
    try {
      const res = await api.api.classes[":id"].reconcile.$post({
        param: { id },
        json: { keys: [...checked] },
      });
      if (!res.ok) {
        setResult("Couldn't apply those fixes — refresh and try again.");
        return;
      }
      const body = await res.json();
      setResult(
        body.failed.length === 0
          ? `${body.applied.length} applied.`
          : `${body.applied.length} applied · ${body.failed.length} failed.`,
      );
      setSelected(null); // the next audit decides what's checked
      await mutate();
    } finally {
      setApplying(false);
    }
  }

  if (error) {
    return (
      <Page>
        <Text variant="error">
          Couldn't audit this class — you may not teach it, or the GitHub App
          may have been removed from its organization.
        </Text>
        <Link to="/classes" className="text-sm underline">
          ‹ Back to classes
        </Link>
      </Page>
    );
  }
  if (isLoading) {
    return (
      <Page>
        <Loading loading label="Auditing this class against GitHub…" />
      </Page>
    );
  }

  return (
    <Page>
      <Link to="/classes" className="text-sm underline">
        ‹ Back to classes
      </Link>
      <BrandHeader
        title={`Reconcile ${cls?.name ?? cls?.login ?? "this class"}`}
      />
      <Text variant="subtitle" className="max-w-2xl">
        GitHub is the authority. Anything below has drifted from it. Nothing is
        repaired until you apply it.
      </Text>
      <ReconcileGuideDialog />

      {findings.length === 0 ? (
        <Text variant="body1">This class is in sync with GitHub.</Text>
      ) : (
        <Stack gap="lg" className="w-full max-w-3xl">
          <Row gap="sm" className="w-full">
            <Text variant="body2" className="text-muted-foreground">
              {findings.length} {findings.length === 1 ? "issue" : "issues"} ·{" "}
              {checked.size} selected
            </Text>
            <span className="flex-1" />
            {/* "Select all" never selects a finding with no fix — there is
                nothing to apply. */}
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() =>
                setSelected(new Set(fixable(findings).map((f) => f.key)))
              }
            >
              Select all
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => setSelected(new Set())}
            >
              Deselect all
            </Button>
          </Row>

          {/* One card per section, rows divided inside it — a card per finding
              turned a long audit into a wall of boxes. No section heading: the
              finding titles already say what they are about, and the reading
              ORDER (what the class is → who is in it → what they work in) is
              what the grouping is for. */}
          {sections(findings).map((section) => (
            <Card
              key={section.name}
              className="w-full gap-0 overflow-hidden p-0"
            >
              <Stack gap="none" className="w-full divide-y">
                {section.rows.map((f) => (
                  <FindingRow
                    key={f.key}
                    finding={f}
                    checked={checked.has(f.key)}
                    onToggle={() => toggle(f.key)}
                  />
                ))}
              </Stack>
            </Card>
          ))}

          {/* The bar follows the teacher down a long audit — Apply must never be
              a scroll away from the boxes it acts on. */}
          <Row
            gap="md"
            align="center"
            className="sticky bottom-4 w-full rounded-lg border bg-background/95 px-4 py-3 shadow-lg backdrop-blur"
          >
            {result ? (
              <Text variant="body2" className="min-w-0">
                {result}
              </Text>
            ) : null}
            <span className="flex-1" />
            <Button
              size="lg"
              type="button"
              disabled={applying || checked.size === 0}
              onClick={apply}
            >
              {applying ? "Applying…" : `Apply ${checked.size} selected`}
            </Button>
          </Row>
        </Stack>
      )}
    </Page>
  );
}

/** One finding. Unfixable ones (`fix === null`) are reported, not offered —
 *  they get no checkbox, because there is nothing to consent to. */
function FindingRow({
  finding,
  checked,
  onToggle,
}: {
  finding: Finding;
  checked: boolean;
  onToggle: () => void;
}) {
  const { title, detail, fix, change, severity } = finding;
  const spine = cn("border-l-2 px-4 py-3", SPINE[severity]);

  if (!fix) {
    return (
      <Row gap="sm" align="start" className={cn(spine, "w-full")}>
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        <Stack gap="none" className="min-w-0">
          <Text variant="caption" className="font-medium text-foreground">
            {title}
          </Text>
          <Text variant="caption">{detail}</Text>
          <Text variant="caption" className="mt-1 text-muted-foreground italic">
            Nothing to apply — this one needs you.
          </Text>
        </Stack>
      </Row>
    );
  }

  return (
    <label
      className={cn(
        spine,
        "flex w-full cursor-pointer items-start gap-3 transition-colors hover:bg-muted/40",
        checked && "bg-muted/25",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={title}
        className="mt-0.5 size-4 shrink-0 accent-brand"
      />
      <Stack gap="none" className="min-w-0 flex-1">
        <Text variant="caption" className="font-medium text-foreground">
          {title}
        </Text>
        <Text variant="caption">{detail}</Text>
        {/* What Apply will DO, visually distinct from what we OBSERVED above:
            the state that stands → the state Apply produces. Findings without
            a two-state reading fall back to the fix sentence. */}
        <div className="mt-1.5" title={fix}>
          {change ? (
            <StateChange from={change.from} to={change.to} />
          ) : (
            <Row gap="xs" align="center" className="min-w-0">
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
              <Text
                variant="caption"
                className="font-medium text-muted-foreground"
              >
                {fix}
              </Text>
            </Row>
          )}
        </div>
      </Stack>
    </label>
  );
}
