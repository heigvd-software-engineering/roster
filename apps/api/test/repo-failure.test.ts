import { describe, expect, it } from "vitest";
import { classifyRepoFailure } from "../src/lib/github/repo";
import { isSameRepo } from "../src/lib/groups";

/**
 * The REAL 422 GitHub returns when an org repo name is taken. The summary sits
 * in `response.data.message`; the reason is in `data.errors[]`. Octokit flattens
 * both into `message` (see @octokit/request's toErrorMessage) — which is exactly
 * the field the old classifier never reached, because `??` stopped at the
 * (always present) `data.message`.
 */
const nameTaken = {
  status: 422,
  message:
    'Repository creation failed.: {"resource":"Repository","code":"custom","field":"name","message":"name already exists on this account"} - https://docs.github.com/rest',
  response: {
    data: {
      message: "Repository creation failed.",
      errors: [
        {
          resource: "Repository",
          code: "custom",
          field: "name",
          message: "name already exists on this account",
        },
      ],
    },
  },
};

/** A /generate call against an EMPTY template repo: no per-field errors. */
const badTemplate = {
  status: 422,
  message: "Repository creation failed. - https://docs.github.com/rest",
  response: { data: { message: "Repository creation failed." } },
};

const forbidden = {
  status: 403,
  message: "Resource not accessible by integration",
  response: { data: { message: "Resource not accessible by integration" } },
};

describe("classifyRepoFailure", () => {
  it("reads the name collision out of errors[], not the generic summary", () => {
    // The bug: data.message is "Repository creation failed." — the words
    // "already exists" only ever appear in errors[].
    expect(classifyRepoFailure(nameTaken, false)).toBe("name_taken");
    expect(classifyRepoFailure(nameTaken, true)).toBe("name_taken");
  });

  it("blames the template only when a template was actually used", () => {
    expect(classifyRepoFailure(badTemplate, true)).toBe("template_error");
  });

  it("refuses to blame a template the lab doesn't have", () => {
    // A template-less lab calls POST /orgs/{org}/repos — a template error is
    // impossible by construction. We don't know what this is, so: rethrow.
    expect(classifyRepoFailure(badTemplate, false)).toBeNull();
  });

  it("names a permissions problem", () => {
    expect(classifyRepoFailure(forbidden, true)).toBe("app_permissions");
    expect(classifyRepoFailure(forbidden, false)).toBe("app_permissions");
  });

  it("does not classify what it doesn't recognize", () => {
    expect(classifyRepoFailure({ status: 500 }, true)).toBeNull();
    expect(classifyRepoFailure(new Error("network down"), false)).toBeNull();
  });
});

describe("isSameRepo", () => {
  it("compares full names case-insensitively (GitHub does)", () => {
    expect(isSameRepo("Acme/Starter", "acme/starter")).toBe(true);
    expect(isSameRepo("acme/starter", "acme/lab-1-alice")).toBe(false);
  });

  it("never matches a lab with no template", () => {
    expect(isSameRepo(null, "acme/lab-1-alice")).toBe(false);
  });
});
