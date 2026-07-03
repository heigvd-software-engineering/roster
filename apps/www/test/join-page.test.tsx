import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JoinPage } from "~/pages/join-page";

const joinGet = vi.fn();
const joinPost = vi.fn();

vi.mock("react-router", () => ({
  useParams: () => ({ token: "tok123" }),
}));

vi.mock("~/lib/api", () => ({
  api: {
    api: {
      join: {
        ":token": {
          $get: (...args: unknown[]) => joinGet(...args),
          $post: (...args: unknown[]) => joinPost(...args),
        },
      },
    },
  },
}));

const ready = (membership: string) => ({
  status: 200,
  ok: true,
  json: () =>
    Promise.resolve({
      class: { login: "acme", name: "Acme", avatarUrl: "http://a" },
      membership,
    }),
});

beforeEach(() => {
  joinGet.mockReset();
  joinPost.mockReset();
});

describe("JoinPage", () => {
  it("shows the class preview and a Join button for a non-member", async () => {
    joinGet.mockResolvedValue(ready("none"));
    render(<JoinPage />);
    expect(await screen.findByText("Join Acme")).toBeInTheDocument();
    expect(screen.getByText("@acme")).toBeInTheDocument();
    expect(joinGet).toHaveBeenCalledWith({ param: { token: "tok123" } });
    expect(
      screen.getByRole("button", { name: "Join class" }),
    ).toBeInTheDocument();
  });

  it("flips to the invited state after joining", async () => {
    joinGet.mockResolvedValue(ready("none"));
    joinPost.mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ membership: "pending" }),
    });
    render(<JoinPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Join class" }));

    expect(
      await screen.findByRole("link", {
        name: "Open the invitation on GitHub",
      }),
    ).toHaveAttribute("href", "https://github.com/orgs/acme/invitation");
    expect(joinPost).toHaveBeenCalledWith({ param: { token: "tok123" } });
  });

  it("Check my enrollment re-reads state and flips to enrolled", async () => {
    joinGet.mockResolvedValueOnce(ready("pending"));
    joinGet.mockResolvedValueOnce(ready("active"));
    render(<JoinPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Check my enrollment" }),
    );
    expect(
      await screen.findByText("You're enrolled in Acme."),
    ).toBeInTheDocument();
  });

  it("already-members land on the enrolled state directly", async () => {
    joinGet.mockResolvedValue(ready("active"));
    render(<JoinPage />);
    expect(
      await screen.findByText("You're enrolled in Acme."),
    ).toBeInTheDocument();
  });

  it("unknown token shows the invalid-link state", async () => {
    joinGet.mockResolvedValue({ status: 404, ok: false });
    render(<JoinPage />);
    expect(
      await screen.findByText(
        "This join link isn't valid — ask your teacher for a fresh one.",
      ),
    ).toBeInTheDocument();
  });

  it("a failed load shows the error state with retry", async () => {
    joinGet.mockRejectedValueOnce(new Error("network"));
    joinGet.mockResolvedValueOnce(ready("none"));
    render(<JoinPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Join Acme")).toBeInTheDocument();
  });
});
