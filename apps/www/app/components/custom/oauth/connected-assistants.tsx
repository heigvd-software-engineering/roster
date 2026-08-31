import { ShieldOff } from "lucide-react";
import { Fragment } from "react";
import { useSWRConfig } from "swr";
import { ConfirmDialog } from "~/components/custom/confirm-dialog";
import { Hint } from "~/components/custom/hint";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import {
  ConsentScope,
  scopeSummary,
} from "~/components/custom/oauth/consent-scope";
import { Text } from "~/components/custom/typography/text";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { api, useApi } from "~/lib/api";
import { oauth2 } from "~/lib/auth";
import { formatDate } from "~/lib/format";

/** What the revoke dialog needs to name its target. */
export type RevokeTarget = { id: string; name: string | null };

/**
 * The account menu's standing grants (Connected assistants): every assistant
 * the teacher has connected, and the one button behind "access can be
 * withdrawn at any time". Mirrors the Linked GitHub group's exact shape — an
 * info block, then a destructive action.
 *
 * The name is the client's self-asserted registration name (open DCR verifies
 * nothing), so a nameless client renders as "An assistant" — the consent
 * screen's own fallback. Revoking deletes the consent row and the assistant
 * is refused from its very next request (decision #12).
 *
 * Data comes from GET /api/assistants — one fetch with the client name
 * joined in — because the stock pair can't feed this list (get-consents has
 * no name, public-client no batch). The menu content only mounts while open,
 * so the hook fetches exactly when the teacher looks.
 *
 * Revoke is confirmed, not immediate: a real misclick on demo (2026-08-31)
 * retired the act-directly choice. The menu item only names a target — the
 * ConfirmDialog lives OUTSIDE the menu (RevokeAssistantDialog below, state
 * held by the menu's owner), because clicking an item closes the menu and
 * unmounts everything in it; ConfirmDialog's controlled mode exists for
 * exactly this, the group card's kebab being the precedent.
 */
export function ConnectedAssistants({
  onRevoke,
}: {
  onRevoke: (target: RevokeTarget) => void;
}) {
  const { data, error, isLoading } = useApi(api.api.assistants);

  return (
    <DropdownMenuGroup>
      <Row gap="xs" align="center">
        <DropdownMenuLabel className="pr-0">
          Connected assistants
        </DropdownMenuLabel>
        {/* The section explains itself where it is; the full setup guide
            lives on the rules page, one link away. */}
        <Hint label="About connected assistants" title="AI assistants">
          <Stack gap="sm">
            <span>
              Programs you've allowed to read your classes with a limited key of
              their own — they never see your password or your session, and you
              can revoke each one here at any time.
            </span>
            <span>
              To connect one (Claude Code, for example), follow{" "}
              <a href="/connect-assistant" className="underline">
                the setup guide
              </a>
              .
            </span>
          </Stack>
        </Hint>
      </Row>
      {isLoading ? (
        // The house loading pattern in miniature: words, not an animation.
        <Note>Loading assistants…</Note>
      ) : error ? (
        // Quiet failure in place; the rest of the menu stays usable.
        <Note>Couldn't load assistants. Close the menu and try again.</Note>
      ) : !data || data.assistants.length === 0 ? (
        <Note>None connected</Note>
      ) : (
        data.assistants.map((assistant, index) => {
          const { unknown } = scopeSummary(assistant.scopes);
          const known = assistant.scopes.filter(
            (scope) => !unknown.includes(scope),
          );
          const name = assistant.name ?? "An assistant";
          return (
            <Fragment key={assistant.id}>
              {index > 0 && <DropdownMenuSeparator className="mx-1.5" />}
              <div className="px-2 pb-1.5">
                <Row gap="xs" align="center">
                  <Text variant="label" className="font-medium">
                    {name}
                  </Text>
                  {/* The grant, one sentence per scope — the consent screen's
                      own vocabulary, in a popover because the list must stay
                      one line however many actions phase 2 and beyond add. */}
                  {known.length > 0 && (
                    <Hint
                      label={`What ${name} may do`}
                      title="It may currently:"
                    >
                      <Stack gap="md">
                        {known.map((scope) => (
                          <ConsentScope key={scope} scope={scope} />
                        ))}
                      </Stack>
                    </Hint>
                  )}
                </Row>
                <Text variant="caption">
                  since {formatDate(new Date(assistant.createdAt))}
                </Text>
                {unknown.length > 0 && (
                  // Shown, never dropped — understating a standing grant is
                  // the one failure this list must not have (ConsentScope's
                  // rule, in miniature).
                  <Text variant="caption" className="text-destructive">
                    Includes a permission roster doesn't recognise:{" "}
                    <span className="font-mono">{unknown.join(", ")}</span>
                  </Text>
                )}
              </div>
              <DropdownMenuItem
                variant="destructive"
                onClick={() =>
                  onRevoke({ id: assistant.id, name: assistant.name })
                }
              >
                <ShieldOff />
                Revoke access
              </DropdownMenuItem>
            </Fragment>
          );
        })
      )}
    </DropdownMenuGroup>
  );
}

/** The group's word-sized states, in the Linked GitHub block's own clothes. */
function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-1.5">
      <Text variant="body2">{children}</Text>
    </div>
  );
}

/**
 * The confirm gate in front of revoking (the Reset-link dialog's shape).
 * Rendered by the menu's owner, outside the menu, so it survives the menu
 * closing. On confirm the consent row is deleted and the assistant is
 * refused from its very next request; the list's cache is refreshed by key,
 * since the group that rendered it has unmounted with the menu.
 */
export function RevokeAssistantDialog({
  target,
  onClose,
}: {
  target: RevokeTarget | null;
  onClose: () => void;
}) {
  const { mutate } = useSWRConfig();
  const name = target?.name ?? "this assistant";
  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Revoke access for ${name}?`}
      description="It is refused from its very next request. Nothing else changes, and connecting it again is just running its connect flow from scratch."
      confirmLabel="Revoke access"
      onConfirm={async () => {
        if (!target) return;
        await oauth2.deleteConsent({ id: target.id });
        await mutate("/api/assistants");
      }}
    />
  );
}
