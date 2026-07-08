import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/**
 * A shell snippet the reader copies in ONE go: the commands as a <pre>, a copy
 * button pinned to the top-right that flips to a check for two seconds. Long
 * snippets scroll inside the block (the button stays put). Copying can be
 * refused — insecure origin, denied permission — and then the flip never
 * happens; the <pre> stays selectable, which was the fallback all along.
 */
export function CommandBlock({
  commands,
  label = "Copy the commands",
  className,
}: {
  commands: string;
  /** The copy button's accessible name (before it flips to "Copied"). */
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copyResetTimer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(commands);
    } catch {
      return; // refused — leave the block as-is, the text is selectable
    }
    setCopied(true);
    clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    // min-w-0: as a grid/flex item this box's automatic minimum size is its
    // min-content — the longest (unwrappable) command line — which would push
    // the whole dialog past its max-width. Zero it, and the <pre> below gets
    // to be the scroller instead.
    <div
      className={cn("relative w-full min-w-0 rounded-md bg-muted", className)}
    >
      <pre className="max-h-80 overflow-auto p-3 pr-10 font-mono text-foreground text-xs leading-relaxed">
        {commands}
      </pre>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        className="absolute top-1 right-1"
        aria-label={copied ? "Copied" : label}
        title={copied ? "Copied" : label}
        onClick={copy}
      >
        {copied ? (
          <Check className="size-4 text-brand" />
        ) : (
          <Copy className="size-4 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
}
