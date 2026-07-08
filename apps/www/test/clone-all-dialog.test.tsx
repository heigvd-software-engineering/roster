import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloneAllDialog } from "~/components/custom/classes/groups/teacher/clone-all-dialog";

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

/** The snippet the teacher pastes — one <pre> in the dialog. */
const commands = () => document.querySelector("pre")?.textContent;

const noop = () => {};

describe("CloneAllDialog", () => {
  it("writes one clone command per repository", () => {
    render(
      <CloneAllDialog
        repos={["acme/lab1-alpha", "acme/lab1-beta"]}
        open
        onOpenChange={noop}
      />,
    );

    expect(commands()).toBe(
      "git clone https://github.com/acme/lab1-alpha.git\n" +
        "git clone https://github.com/acme/lab1-beta.git",
    );
  });

  it("copies every command as one block", async () => {
    render(
      <CloneAllDialog
        repos={["acme/lab1-alpha", "acme/lab1-beta"]}
        open
        onOpenChange={noop}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith(
      "git clone https://github.com/acme/lab1-alpha.git\n" +
        "git clone https://github.com/acme/lab1-beta.git",
    );
  });

  it("counts the repositories it covers", () => {
    render(
      <CloneAllDialog
        repos={["acme/lab1-alpha", "acme/lab1-beta"]}
        open
        onOpenChange={noop}
      />,
    );
    expect(screen.getByText(/2 repositories/)).toBeInTheDocument();
  });

  it("keeps a lone repository singular", () => {
    render(
      <CloneAllDialog repos={["acme/lab1-alpha"]} open onOpenChange={noop} />,
    );
    expect(screen.getByText(/1 repository[^s]/)).toBeInTheDocument();
  });
});
