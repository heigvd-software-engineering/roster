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
  // The template picker inside the dialog fetches the org's templates.
  useApi: () => ({ data: { templates: [] }, isLoading: false }),
}));

// The data owner's revalidate, handed in as a prop — no cache-key guessing.
const onSaved = vi.fn();

beforeEach(() => {
  labsPost.mockReset();
  onSaved.mockReset();
});

function openDialog() {
  render(<LabDialog classId="c1" onSaved={onSaved} />);
  fireEvent.click(screen.getByRole("button", { name: "New lab" }));
}

const existingLab = {
  id: "l1",
  classId: "c1",
  title: "Lab 1",
  deadline: "2099-08-01T23:59:00.000Z",
  groupMode: "group",
  minMembers: 2,
  maxMembers: 3,
  templateRepoId: null,
  templateRepoFullName: null,
  createdByUserId: "u1",
  createdAt: "2026-03-10T00:00:00.000Z",
  updatedAt: "2026-03-10T00:00:00.000Z",
} as Parameters<typeof LabDialog>[0]["lab"];

describe("LabDialog", () => {
  it("warns in edit mode that formed groups aren't reshaped", async () => {
    render(<LabDialog classId="c1" lab={existingLab} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Lab 1" }));

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Warning about editing a live lab",
      }),
    );
    expect(
      screen.getByText(/strand formed groups below the new minimum/),
    ).toBeInTheDocument();
  });

  it("shows no edit warning when creating", async () => {
    openDialog();
    await screen.findByRole("button", { name: "Create lab" });
    expect(
      screen.queryByRole("button", {
        name: "Warning about editing a live lab",
      }),
    ).not.toBeInTheDocument();
  });

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
      json: { deadline?: unknown } & Record<string, unknown>;
    };
    expect(call.param).toEqual({ id: "c1" });
    expect(call.json).toMatchObject({
      title: "Lab 2",
      groupMode: "group",
      minMembers: 2,
      maxMembers: 3,
    });
    expect(typeof call.json.deadline).toBe("string");
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
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
    expect(onSaved).not.toHaveBeenCalled();
  });
});
