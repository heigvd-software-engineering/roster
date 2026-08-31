import { CommandBlock } from "~/components/custom/command-block";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";

/**
 * The teacher's guide to connecting an AI assistant, on the rules page —
 * where teachers already read what the app permits. Claude Code is the
 * worked example; the last rule says the address works for any MCP client,
 * because it does: open registration is the design (decision #6).
 *
 * The MCP address is derived from the page's own origin, so the same words
 * are true on demo and in production without a config value.
 */
export function ConnectAssistant() {
  const origin =
    typeof window === "undefined" ? "https://roster" : window.location.origin;
  const mcpUrl = `${origin}/mcp`;

  return (
    <Stack gap="md" className="w-full">
      <Stack gap="none">
        <Text variant="heading">Connect an AI assistant (teachers)</Text>
        <Text variant="subtitle">
          Give an assistant its own, limited key to your classes — it never sees
          your password or your session.
        </Text>
      </Stack>

      <Text variant="body1">
        roster speaks MCP, the protocol AI assistants use to reach tools. An
        assistant you connect can answer questions like{" "}
        <em>“how is group formation going for Lab 2?”</em> by reading your
        classes with a key you grant — and can revoke — yourself. With Claude
        Code as the example:
      </Text>

      <Stack gap="sm">
        <Text variant="label" className="font-medium">
          1 · Tell it where roster is
        </Text>
        <CommandBlock
          commands={`claude mcp add --transport http roster ${mcpUrl}`}
          label="Copy the command"
        />
        <Text variant="label" className="font-medium">
          2 · Connect it to your account
        </Text>
        <Text variant="body2">
          In a Claude Code session, run <code>/mcp</code>, pick{" "}
          <strong>roster</strong>, and choose Authenticate. Your browser opens:
          sign in with edu-ID as usual, read what the assistant would be allowed
          to do, and press Connect. The grant is yours, not the assistant’s — it
          lasts 7 days and nothing renews it behind your back.
        </Text>
        <Text variant="label" className="font-medium">
          3 · Ask it something
        </Text>
        <Text variant="body2">
          “How is group formation going for Lab 2 — who has a work repository,
          and is anyone not in a group yet?” The assistant reads exactly what
          you could read yourself, as you, and nothing more.
        </Text>
      </Stack>
    </Stack>
  );
}
