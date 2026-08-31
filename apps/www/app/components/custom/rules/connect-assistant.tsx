import { CommandBlock } from "~/components/custom/command-block";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";

/**
 * The setup guide behind /connect-assistant, entered from the Connected
 * assistants info hint. Two worked examples, one per client shape the flow
 * was proven with: Claude Code (a terminal client on the teacher's machine)
 * and the Claude app (a remote connector at claude.ai). Any MCP client works
 * the same way, because open registration is the design (decision #6).
 *
 * The MCP address is derived from the page's own origin, so the same words
 * are true on demo and in production without a config value.
 */
export function ConnectAssistant() {
  const origin =
    typeof window === "undefined" ? "https://roster" : window.location.origin;
  const mcpUrl = `${origin}/mcp`;

  return (
    <Stack gap="lg" className="w-full">
      <Stack gap="none">
        <Text variant="heading">Connect an AI assistant</Text>
        <Text variant="subtitle">
          Give an assistant its own, limited key to your classes — it never sees
          your password or your session.
        </Text>
      </Stack>

      <Text variant="body1">
        roster speaks MCP, the protocol AI assistants use to reach tools. An
        assistant you connect can answer questions like{" "}
        <em>“how is group formation going for Lab 2?”</em> by reading your
        classes with a key you grant — and can revoke — yourself. Whatever the
        client, the middle of the flow is the same: your browser opens, you sign
        in with edu-ID as usual, read what the assistant would be allowed to do,
        and press Connect. The grant lasts 7 days and nothing renews it behind
        your back; reconnecting is the same steps again.
      </Text>

      <Stack gap="sm">
        <Text variant="heading">In the terminal: Claude Code</Text>
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
          <strong>roster</strong>, and choose Authenticate — then sign in and
          consent in the browser window that opens.
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

      <Stack gap="sm">
        <Text variant="heading">On the web or desktop: the Claude app</Text>
        <Text variant="label" className="font-medium">
          1 · Add roster as a connector
        </Text>
        <Text variant="body2">
          In claude.ai (or the Claude desktop app): Settings → Connectors → Add
          custom connector. Name it <strong>roster</strong> and give it this
          address:
        </Text>
        <CommandBlock commands={mcpUrl} label="Copy the address" />
        <Text variant="label" className="font-medium">
          2 · Connect it to your account
        </Text>
        <Text variant="body2">
          Press Connect on the new connector — the same edu-ID sign-in and
          consent screen as above.
        </Text>
        <Text variant="label" className="font-medium">
          3 · Ask it something
        </Text>
        <Text variant="body2">
          In a chat, enable roster in the tools menu, then ask the same kinds of
          questions. Any other MCP-compatible assistant connects with the same
          address — these two are just the worked examples.
        </Text>
      </Stack>
    </Stack>
  );
}
