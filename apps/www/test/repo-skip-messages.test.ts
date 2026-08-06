import { describe, expect, it } from "vitest";
import { repoSkipMessages } from "~/components/custom/classes/groups/shared/use-assignment-groups";

/**
 * The batch repo-create's 200 can still skip groups, and these messages are
 * all that stands between a partial batch and a teacher believing every repo
 * exists. Names over ids, reason-worded like the single-create conflicts.
 */
describe("repoSkipMessages", () => {
  const groups = [
    { id: "g1", name: "Team Alpha" },
    { id: "g2", name: "Team Beta" },
  ];

  it("names each skipped group with its reason", () => {
    const messages = repoSkipMessages(
      [
        { groupId: "g1", reason: "repo_name_taken" },
        { groupId: "g2", reason: "group_incomplete" },
      ],
      groups,
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatch(/^Team Alpha was skipped: /);
    // The name collision is usually the group's own work waiting under its old
    // name, so the remedy named first is the sync that links it back, never a
    // rename (which would abandon it).
    expect(messages[0]).toMatch(/a repository already exists under its name/);
    expect(messages[0]).toMatch(/link it back from the class's GitHub sync/);
    expect(messages[1]).toMatch(/^Team Beta was skipped: /);
    expect(messages[1]).toMatch(/needs more members/);
  });

  it("explains a group whose GitHub team is gone", () => {
    const [message] = repoSkipMessages(
      [{ groupId: "g1", reason: "group_gone" }],
      groups,
    );
    expect(message).toMatch(/GitHub team no longer exists/);
  });

  it("falls back for unknown reasons and unknown groups", () => {
    const [message] = repoSkipMessages(
      [{ groupId: "nope", reason: "brand_new_reason" }],
      groups,
    );
    expect(message).toBe(
      "A group was skipped: That didn't go through — refresh and try again.",
    );
  });

  it("is silent when nothing was skipped", () => {
    expect(repoSkipMessages([], groups)).toEqual([]);
  });
});
