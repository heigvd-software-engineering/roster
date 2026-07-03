import type * as React from "react";
import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";

/**
 * Panel — THE standard content holder: a solid, slightly-darker-than-white
 * surface (the class-card look; no opacity tints, which read as "charged").
 * Nested lists sit on white `bg-background` insets inside it.
 */
export function Panel({
  className,
  ...props
}: React.ComponentProps<typeof Card>) {
  return (
    <Card className={cn("w-full gap-4 bg-muted p-5", className)} {...props} />
  );
}
