import { CircleAlert, Eye, PenLine } from "lucide-react";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Badge } from "~/components/ui/badge";

/**
 * What each scope means, in a teacher's words.
 *
 * The map is the point: a scope with no entry here cannot render a sentence, so
 * a new scope cannot reach a consent screen without someone writing what it
 * lets an assistant do. `roster:read` / `roster:write` mirror the phase
 * boundary — read is phase 1, write is phase 2, and because the scope is new
 * then, teachers meet a second consent screen rather than riding the grant they
 * already gave (decision #13).
 */
const SCOPES = {
  "roster:read": {
    icon: Eye,
    title: "Read your classes",
    // The standing-grant list's compressed form of `title` (third person,
    // lowercase so summaries join into one sentence).
    summary: "reads your classes",
    detail:
      "Class and assignment names, the groups in them and who's in each one, their work repositories, and recent pushes. Nothing is changed.",
    changes: false,
  },
  "roster:write": {
    icon: PenLine,
    title: "Create missing work repositories",
    summary: "creates missing work repositories",
    detail:
      "For an assignment you name, create the work repositories its groups don't have yet. It creates nothing else, and deletes nothing.",
    changes: true,
  },
} as const;

/**
 * A granted scope set compressed to one sentence for the Connected assistants
 * list: "Reads your classes · creates missing work repositories". The same
 * rule as the consent screen, in miniature: a scope this map doesn't know is
 * returned in `unknown` to be SHOWN in destructive form, never dropped —
 * omitting it would understate a standing grant.
 */
export function scopeSummary(scopes: string[]): {
  sentence: string | null;
  unknown: string[];
} {
  const known = scopes.filter(isKnown).map((scope) => SCOPES[scope].summary);
  const joined = known.join(" · ");
  return {
    sentence: joined ? joined.charAt(0).toUpperCase() + joined.slice(1) : null,
    unknown: scopes.filter((scope) => !isKnown(scope)),
  };
}

type KnownScope = keyof typeof SCOPES;

const isKnown = (scope: string): scope is KnownScope => scope in SCOPES;

export function ConsentScope({ scope }: { scope: string }) {
  // An unknown scope is SHOWN, never dropped. Omitting it would understate
  // what is being granted, which is the one thing this screen must not do.
  if (!isKnown(scope)) {
    return (
      <Row gap="sm" align="start">
        <CircleAlert aria-hidden className="mt-0.5 size-4.5 text-destructive" />
        <Stack gap="xs">
          <Text variant="label" className="font-medium">
            A permission roster doesn't recognise
          </Text>
          <Text variant="error" as="span" className="font-mono">
            {scope}
          </Text>
        </Stack>
      </Row>
    );
  }

  const { icon: Icon, title, detail, changes } = SCOPES[scope];
  return (
    <Row gap="sm" align="start">
      <Icon aria-hidden className="mt-0.5 size-4.5 text-muted-foreground" />
      <Stack gap="xs">
        <Row gap="sm" wrap>
          <Text variant="label" className="font-medium">
            {title}
          </Text>
          {/* Outline, not destructive: nothing is destroyed, but this one does
              more than look. The design language has no third status hue. */}
          {changes ? <Badge variant="outline">changes things</Badge> : null}
        </Row>
        <Text variant="body2">{detail}</Text>
      </Stack>
    </Row>
  );
}
