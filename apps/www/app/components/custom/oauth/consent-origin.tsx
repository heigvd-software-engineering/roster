import { Hint } from "~/components/custom/hint";
import { Row } from "~/components/custom/layout/row";
import { Text } from "~/components/custom/typography/text";

/** The three hosts that mean "this machine" (RFC 8252 §7.3). An assistant that
 *  redirects to one of them is a program the teacher is running locally. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostOf(redirectUri: string): string | null {
  try {
    return new URL(redirectUri).hostname;
  } catch {
    return null;
  }
}

/**
 * Who is asking — as much of it as roster can actually stand behind.
 *
 * Client registration is open (a CLI has no session to present), so the name
 * above this line is self-asserted and **nothing verifies it**. This component
 * exists so the screen never implies otherwise, and it has two shapes because
 * the redirect URI carries different amounts of information:
 *
 * - **Loopback.** The host is always `127.0.0.1`. Printing it would dress a
 *   constant up as something a teacher could check, so the line says the true
 *   thing instead — a program on this computer, unverified — and the caveat
 *   points at the only real signal there is: whether they started it just now.
 * - **Remote.** Here the host discriminates, because the grant genuinely
 *   travels there. It gets shown, in mono, as the fact worth reading.
 *
 * The third shape — a *verified* vendor host — is what CIMD would add
 * (board decision #6, re-opened 2026-08-28 and deferred).
 */
export function ConsentOrigin({ redirectUri }: { redirectUri: string }) {
  const host = hostOf(redirectUri);
  const local = host !== null && LOOPBACK.has(host);

  if (local || host === null) {
    return (
      <Row gap="xs" wrap>
        <Text variant="body2">A program on this computer · unverified</Text>
        <Hint label="What roster knows about this assistant">
          roster can't check that name. Any program on this computer can
          register itself under any name, and this approval goes to whichever
          one asked. Connect only if you started this yourself, just now, from
          an assistant you trust.
        </Hint>
      </Row>
    );
  }

  return (
    <Row gap="xs" wrap>
      <Text variant="body2">Sends you back to</Text>
      <Text variant="label" as="span" className="font-mono">
        {host}
      </Text>
      <Hint label="What roster knows about this assistant">
        roster can't check that name — anyone can register under any name. The
        address is the part that is real: your approval, and everything it
        opens, goes to that host. If you don't recognise it, deny it.
      </Hint>
    </Row>
  );
}
