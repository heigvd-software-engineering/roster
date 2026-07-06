import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LabDialog } from "~/components/custom/classes/labs/lab-dialog";

const labsPost = vi.fn();

vi.mock("~/lib/api", () => ({
  api: {
    api: {
      classes: {
        ":id": { labs: { $post: (...args: unknown[]) => labsPost(...args) } },
      },
    },
  },
}));

const mutate = vi.fn();
vi.mock("swr", () => ({
  useSWRConfig: () => ({ mutate }),
}));

beforeEach(() => {
  labsPost.mockReset();
  mutate.mockReset();
});

function openDialog() {
  render(<LabDialog classId="c1" />);
  fireEvent.click(screen.getByRole("button", { name: "+ New lab" }));
}

describe("LabDialog", () => {
  it("disables Create until title and deadline are set", async () => {
    openDialog();
    const create = await screen.findByRole("button", { name: "Create lab" });
    expect(create).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Lab 1" },
    });
    fireEvent.change(screen.getByLabelText("Deadline"), {
      target: { value: "2099-08-01T23:59" },
    });
    expect(create).not.toBeDisabled();
  });

  it("reveals min/max for group mode and posts the full payload", async () => {
    labsPost.mockResolvedValue({ ok: true, status: 200 });
    openDialog();
    fireEvent.change(await screen.findByLabelText("Title"), {
      target: { value: "Lab 2" },
    });
    fireEvent.change(screen.getByLabelText("Deadline"), {
      target: { value: "2099-08-01T23:59" },
    });

    expect(screen.queryByLabelText("Min members")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    expect(screen.getByLabelText("Min members")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create lab" }));
    await waitFor(() => expect(labsPost).toHaveBeenCalled());

    const call = labsPost.mock.calls[0]?.[0] as {
      param: { id: string };
      json: Record<string, unknown>;
    };
    expect(call.param).toEqual({ id: "c1" });
    expect(call.json).toMatchObject({
      title: "Lab 2",
      groupMode: "group",
      minMembers: 2,
      maxMembers: 3,
    });
    expect(typeof call.json.deadline).toBe("string");
    await waitFor(() => expect(mutate).toHaveBeenCalledWith("/api/classes"));
  });

  it("shows an error when the API refuses", async () => {
    labsPost.mockResolvedValue({ ok: false, status: 400 });
    openDialog();
    fireEvent.change(await screen.findByLabelText("Title"), {
      target: { value: "Lab 3" },
    });
    fireEvent.change(screen.getByLabelText("Deadline"), {
      target: { value: "2099-08-01T23:59" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create lab" }));

    expect(
      await screen.findByText(
        "Couldn't create the lab — check the fields and try again.",
      ),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });
});
