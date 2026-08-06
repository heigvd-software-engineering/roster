import type { ReactNode } from "react";
import { Stack } from "~/components/custom/layout/stack";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

type RulePhaseProps = {
  /** Timeline index: "01" … "04", or "∞" for the timeless card. */
  step: string;
  title: string;
  /** One line saying what this moment of a lab's life is about. */
  tagline: string;
  children: ReactNode;
};

/** One moment of a lab's life: a numbered card holding its rules. The page
 *  reads in order because the cards are numbered and stacked. */
export function RulePhase({ step, title, tagline, children }: RulePhaseProps) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          {step} — {title}
        </CardTitle>
        <CardDescription>{tagline}</CardDescription>
      </CardHeader>
      <CardContent>
        <Stack gap="md">{children}</Stack>
      </CardContent>
    </Card>
  );
}
