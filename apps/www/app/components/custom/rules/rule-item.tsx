import type { ReactNode } from "react";
import { Row } from "~/components/custom/layout/row";
import { Text } from "~/components/custom/typography/text";
import { Badge } from "~/components/ui/badge";

type RuleItemProps = {
  who: "students" | "teacher" | "everyone";
  children: ReactNode;
};

/** One rule: a fixed-width audience badge and the rule itself, so the rule
 *  texts align into a single readable column. */
export function RuleItem({ who, children }: RuleItemProps) {
  return (
    <Row gap="md" align="start">
      <Badge variant="outline" className="mt-0.5 w-24 shrink-0">
        {who}
      </Badge>
      <Text variant="body2" className="flex-1 text-foreground">
        {children}
      </Text>
    </Row>
  );
}
