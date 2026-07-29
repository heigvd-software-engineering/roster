import type { ReactNode } from "react";
import { Row } from "~/components/custom/layout/row";
import { CAPS_LABEL, Text } from "~/components/custom/typography/text";
import { cn } from "~/lib/utils";

/** Who a rule binds — colored with the app's ROLE hues (role-marker.tsx uses
 *  the same recipe on class cards): teaching violet for the teacher, enrolled
 *  teal for students, plain outline for everyone. The badge is the scanning
 *  aid: a teacher finds their powers by color, a student their boundaries. */
const WHO = {
  students: {
    label: "students",
    chip: "border-role-enrolled/40 bg-role-enrolled/10 text-role-enrolled",
  },
  teacher: {
    label: "teacher",
    chip: "border-role-teaching/40 bg-role-teaching/10 text-role-teaching",
  },
  everyone: { label: "everyone", chip: "border-border text-muted-foreground" },
} as const;

type RuleItemProps = {
  who: keyof typeof WHO;
  children: ReactNode;
};

/** One rule: a fixed-width audience chip and the rule itself, so the rule
 *  texts align into a single readable column. */
export function RuleItem({ who, children }: RuleItemProps) {
  const w = WHO[who];
  return (
    <Row gap="md" align="start">
      <span
        className={cn(
          CAPS_LABEL,
          "mt-0.5 w-[5.25rem] shrink-0 rounded-full border py-1 text-center",
          w.chip,
        )}
      >
        {w.label}
      </span>
      <Text variant="body1" className="flex-1 text-[0.95rem]">
        {children}
      </Text>
    </Row>
  );
}
