export type GithubProfile = {
  login: string;
  id: number;
  name: string | null;
  avatarUrl: string;
};

/**
 * Fetch the linked user's live GitHub profile with their stored token. Returns
 * null on ANY failure (expired token, rate limit, outage) — a null profile is
 * NOT the same as being unlinked; the link status is tracked separately.
 */
export async function fetchGithubProfile(
  token: string,
): Promise<GithubProfile | null> {
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "labs",
      },
    });
    if (!res.ok) {
      return null;
    }
    const gh = (await res.json()) as {
      login: string;
      id: number;
      name: string | null;
      avatar_url: string;
    };
    return {
      login: gh.login,
      id: gh.id,
      name: gh.name,
      avatarUrl: gh.avatar_url,
    };
  } catch {
    // Network error, GitHub outage, malformed JSON, etc. — same contract as
    // an HTTP error response: null, not a thrown exception into /api/me.
    return null;
  }
}
