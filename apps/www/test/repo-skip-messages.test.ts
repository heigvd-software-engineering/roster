import { describe, expect, it } from "vitest";
import { repoSkipMessages } from "~/components/custom/classes/groups/shared/use-lab-groups";

/**
 * The batch repo-create's 200 can still skip groups — these messages are
 * the only thing standing between a partial batch and a teacher believing
 * every repo exists. Names over ids; reason-worded like the single-create
 * conflicts.
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
    expect(messages[0]).toMatch(/repository with that name already exists/);
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
