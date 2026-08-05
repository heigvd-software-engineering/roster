import type { ReactNode } from "react";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Card } from "~/components/ui/card";

/** The principles band, the overview the phases below spell out in detail.
 *  A plain card, since the graph-paper ground is app-wide on <body>. */
export function Axioms({ children }: { children: ReactNode }) {
  return (
    <Card className="w-full gap-0 px-6">
      <Text variant="overline" className="mb-4">
        The four principles
      </Text>
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

type AxiomProps = {
  /** "A1" …, the mono marker, in brand red like the mockup. */
  marker: string;
  name: string;
  children: ReactNode;
};

/** One principle: mono marker, bold name, one-line body. */
export function Axiom({ marker, name, children }: AxiomProps) {
  return (
    <Stack gap="xs">
      <span className="font-mono text-[11px] tracking-[0.18em] text-brand">
        {marker}
      </span>
      <Text variant="label" className="font-semibold">
        {name}
      </Text>
      <Text variant="body2">{children}</Text>
    </Stack>
  );
}
