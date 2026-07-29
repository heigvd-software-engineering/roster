import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { cn } from "~/lib/utils";

type RulePhaseProps = {
  icon: LucideIcon;
  /** Timeline index — "01" … "04", or "∞" for the timeless card. */
  step: string;
  /** The point of no return gets the page's ONE red accent. */
  pivotal?: boolean;
  title: string;
  /** One line saying what this moment of a lab's life is about. */
  tagline: string;
  children: ReactNode;
};

/** One moment of a lab's life on the timeline: an indexed marker on a rail
 *  (the rail hides on the last phase), and the phase card with its rules.
 *  The page reads as a timeline because the cards do. */
export function RulePhase({
  icon: Icon,
  step,
  pivotal = false,
  title,
  tagline,
  children,
}: RulePhaseProps) {
  return (
    <div className="group relative grid w-full grid-cols-[2.25rem_1fr] gap-x-5 pb-8 last:pb-0">
      <div className="absolute top-9 bottom-0 left-[1.0625rem] w-px bg-border group-last:hidden" />
      <div
        className={cn(
          "relative z-1 flex size-9 items-center justify-center rounded-md border font-mono text-xs",
          pivotal
            ? "border-brand bg-brand text-white"
            : "border-border bg-card text-muted-foreground",
        )}
      >
        {step}
      </div>
      <Card className={cn("w-full", pivotal && "border-brand/35")}>
        <CardHeader>
          <Row gap="md" align="start">
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-md bg-muted",
                pivotal ? "text-brand" : "text-muted-foreground",
              )}
            >
              <Icon className="size-4" />
            </div>
            <Stack gap="xs">
              <CardTitle>{title}</CardTitle>
              <CardDescription>{tagline}</CardDescription>
            </Stack>
          </Row>
        </CardHeader>
        <CardContent>
          <Stack gap="md">{children}</Stack>
        </CardContent>
      </Card>
    </div>
  );
}
