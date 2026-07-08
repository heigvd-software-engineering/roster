import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { Page } from "~/components/custom/layout/page";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Loading } from "~/components/custom/loading";
import { BrandHeader } from "~/components/custom/typography/brand-header";
import { CAPS_LABEL, Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { api, useApi } from "~/lib/api";
import { cn } from "~/lib/utils";

type Finding = {
  key: string;
  reconciler: string;
  severity: "broken" | "drift" | "info";
  title: string;
  detail: string;
  fix: string | null;
  destructive: boolean;
};

/** The reconcilers, in the order a teacher should read them: what the class IS,
 *  then who is in it, then what they work in, then who can see what. */
const SECTIONS: { name: string; reconcilers: string[] }[] = [
  { name: "Class", reconcilers: ["installation", "identity"] },
  { name: "Roster", reconcilers: ["roster"] },
  { name: "Groups", reconcilers: ["group-teams", "work-repos"] },
  { name: "Security", reconcilers: ["base-permission"] },
];

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

/** Everything a fix could do, on first load. Destructive findings are excluded:
 *  the teacher opts INTO deletion, never out of it. A finding we can see but
 *  cannot fix (`fix === null`) has no checkbox at all. */
const initialSelection = (findings: Finding[]) =>
  new Set(findings.filter((f) => f.fix && !f.destructive).map((f) => f.key));

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
  const classes = useApi(api.api.classes);
  const cls = classes.data?.classes.find((c) => c.id === id);

  const findings = (data?.findings ?? []) as Finding[];
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
      await classes.mutate();
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
      <BrandHeader
        title={`Reconcile ${cls?.name ?? cls?.login ?? "this class"}`}
      />
      <Text variant="subtitle" className="max-w-2xl">
        GitHub is the authority. Anything below has drifted from it. Nothing is
        repaired until you apply it.
      </Text>

      {findings.length === 0 ? (
        <Text variant="body1">This class is in sync with GitHub.</Text>
      ) : (
        <Stack gap="lg" className="w-full">
          {sections(findings).map((section) => (
            <Stack gap="sm" key={section.name} className="w-full">
              <Text
                variant="overline"
                as="span"
                className={cn(CAPS_LABEL, "text-muted-foreground")}
              >
                {section.name}
              </Text>
              {section.rows.map((f) => (
                <FindingRow
                  key={f.key}
                  finding={f}
                  checked={checked.has(f.key)}
                  onToggle={() => toggle(f.key)}
                />
              ))}
            </Stack>
          ))}

          <Row gap="md" className="w-full">
            {result ? <Text variant="body2">{result}</Text> : null}
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
  const { title, detail, fix, destructive } = finding;

  if (!fix) {
    return (
      <Card className="w-full gap-0 p-3">
        <Row gap="sm" align="start">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <Stack gap="none">
            <Text variant="caption" className="font-medium text-foreground">
              {title}
            </Text>
            <Text variant="caption">{detail}</Text>
          </Stack>
        </Row>
      </Card>
    );
  }

  return (
    <Card
      className={cn("w-full gap-0 p-3", destructive && "ring-destructive/40")}
    >
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={title}
          className="mt-1 size-4 shrink-0 accent-brand"
        />
        <Stack gap="none" className="min-w-0">
          <Text
            variant="caption"
            className={cn(
              "font-medium",
              destructive ? "text-destructive" : "text-foreground",
            )}
          >
            {title}
          </Text>
          <Text variant="caption">{detail}</Text>
          <Text variant="caption" className="font-mono">
            {fix}
          </Text>
        </Stack>
      </label>
    </Card>
  );
}
