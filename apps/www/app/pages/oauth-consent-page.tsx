import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import useSWR from "swr";
import { Page } from "~/components/custom/layout/page";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Loading } from "~/components/custom/loading";
import { ConsentOrigin } from "~/components/custom/oauth/consent-origin";
import { ConsentScope } from "~/components/custom/oauth/consent-scope";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { useAuth } from "~/contexts/auth-context";
import { oauth2 } from "~/lib/auth";

/** The signed authorization query is short-lived (`codeExpiresIn`, 10 minutes).
 *  Reading `exp` here turns a request that is already dead into the honest
 *  screen immediately, instead of a failed POST after the teacher decides. */
function isExpired(exp: string | null): boolean {
  const seconds = Number(exp);
  return Number.isFinite(seconds) && seconds > 0 && seconds * 1000 < Date.now();
}

/** Every way this screen ends without a decision to make. */
function DeadEnd({ title, detail }: { title: string; detail: string }) {
  return (
    <Page>
      <Stack gap="lg" className="w-full max-w-2xl">
        <Stack gap="xs">
          <Text variant="title">{title}</Text>
          <Text variant="subtitle">Nothing was connected.</Text>
        </Stack>
        <Card className="w-full gap-1 p-4">
          <Text variant="label" className="font-medium">
            Start it again from the assistant
          </Text>
          <Text variant="body2">{detail}</Text>
        </Card>
        <Button variant="outline" render={<Link to="/classes" />}>
          Back to classes
        </Button>
      </Stack>
    </Page>
  );
}

/**
 * /oauth/consent — where the OAuth provider parks an authorization until the
 * teacher decides. The path is `consentPage` in the API's auth config; the two
 * must stay equal.
 *
 * The provider redirects here with the whole authorization query plus `exp` and
 * `sig`. This page never parses or re-signs that: the auth client's fetch
 * plugin (lib/auth.ts) attaches `window.location.search` to the POST, and the
 * server verifies its own signature. What the page reads from the query is only
 * what it has to SHOW — which client, which scopes, and where the grant would
 * go.
 */
export function OAuthConsentPage() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri") ?? "";
  const scopes = (params.get("scope") ?? "").split(" ").filter(Boolean);

  const { data, error, isLoading } = useSWR(
    clientId ? (["oauth-client", clientId] as const) : null,
    async ([, id]) => {
      const res = await oauth2.publicClient({ query: { client_id: id } });
      if (res.error) throw res.error;
      return res.data;
    },
  );

  if (isExpired(params.get("exp"))) {
    return (
      <DeadEnd
        title="This connection request expired"
        detail="Approval requests are good for ten minutes, and this one is older. Run the connect command in the assistant again — it will send you back here with a fresh request."
      />
    );
  }
  if (!clientId || !redirectUri) {
    return (
      <DeadEnd
        title="This connection request is incomplete"
        detail="The address you arrived on is missing part of the request, so there is nothing to approve. Start the connection again from the assistant."
      />
    );
  }
  if (isLoading) {
    return <Loading loading className="flex-1" />;
  }
  if (error || !data) {
    return (
      <DeadEnd
        title="roster doesn't recognise this assistant"
        detail="Registrations that are never approved are cleared after a day. If this one sat that long, connecting again from the assistant will register a fresh one."
      />
    );
  }

  const name = data.client_name ?? "An assistant";
  const writes = scopes.includes("roster:write");

  async function decide(accept: boolean) {
    setBusy(true);
    setFailed(false);
    // `oauth_query` rides along from window.location.search (lib/auth.ts).
    const res = await oauth2.consent({ accept });
    if (res.error || !res.data?.url) {
      setFailed(true);
      setBusy(false);
      return;
    }
    // Leaving the SPA on purpose: the next hop is the client's own callback,
    // which is not a roster URL and must not go through the router.
    window.location.assign(res.data.url);
  }

  return (
    <Page>
      <Stack gap="lg" className="w-full max-w-2xl">
        <Stack gap="xs">
          <Text variant="title">Connect {name} to roster?</Text>
          <Text variant="subtitle">
            It will {writes ? "act" : "read your classes"} as you, and only
            {writes ? " within" : ""} what you allow here. You can disconnect it
            at any time from your account.
          </Text>
        </Stack>

        <Card className="w-full gap-0 p-0">
          <Stack gap="sm" className="p-4">
            <Text variant="label" className="font-medium">
              {name}
            </Text>
            <ConsentOrigin redirectUri={redirectUri} />
          </Stack>
          <div className="h-px w-full bg-border" />
          <Stack gap="md" className="p-4">
            {scopes.map((scope) => (
              <ConsentScope key={scope} scope={scope} />
            ))}
          </Stack>
        </Card>

        <Text variant="caption">
          Connecting as {user?.name} · {user?.email}
        </Text>

        {failed ? (
          <Text variant="error">
            That didn't go through. Try again, or start the connection again
            from the assistant.
          </Text>
        ) : null}

        <Row gap="sm">
          <Button disabled={busy} onClick={() => decide(true)}>
            Connect
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => decide(false)}
          >
            Deny
          </Button>
        </Row>
      </Stack>
    </Page>
  );
}
