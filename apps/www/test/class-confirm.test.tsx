import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ClassConfirmPage } from "~/pages/class-confirm-page";

const confirmPost = vi.fn();
const navigate = vi.fn();

vi.mock("react-router", () => ({
  useParams: () => ({ id: "c1" }),
  useNavigate: () => navigate,
}));

vi.mock("~/lib/api", () => ({
  api: {
    api: {
      classes: {
        ":id": {
          confirm: { $post: (...args: unknown[]) => confirmPost(...args) },
        },
      },
    },
  },
  useApi: () => ({
    data: {
      classes: [{ id: "c1", orgId: 1, login: "acme", name: "Acme" }],
    },
  }),
}));

describe("ClassConfirmPage", () => {
  it("shows the org name from the classes list", () => {
    render(<ClassConfirmPage />);
    expect(screen.getByText("Connect Acme")).toBeInTheDocument();
  });

  it("navigates to the classes hub when the confirm call succeeds", async () => {
    confirmPost.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ ok: true, org: { login: "acme" } }),
    });
    render(<ClassConfirmPage />);
    fireEvent.click(screen.getByText("Set up & continue"));

    expect(confirmPost).toHaveBeenCalledWith({ param: { id: "c1" } });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/classes"));
  });

  it("shows an error when the confirm call reports ok:false", async () => {
    confirmPost.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ ok: false, org: { login: "acme" } }),
    });
    render(<ClassConfirmPage />);
    fireEvent.click(screen.getByText("Set up & continue"));

    expect(
      await screen.findByText(
        "Couldn't apply the organization settings — check the App has Administration access.",
      ),
    ).toBeInTheDocument();
  });

  it("shows an error and re-enables the button when the confirm call rejects", async () => {
    confirmPost.mockRejectedValue(new Error("network down"));
    render(<ClassConfirmPage />);
    const button = screen.getByText("Set up & continue");
    fireEvent.click(button);

    expect(
      await screen.findByText(
        "Something went wrong — check your connection and try again.",
      ),
    ).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });
});
