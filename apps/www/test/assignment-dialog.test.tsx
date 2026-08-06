import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssignmentDialog } from "~/components/custom/classes/assignments/assignment-dialog";

const assignmentsPost = vi.fn();

vi.mock("~/lib/api", () => ({
  api: {
    api: {
      classes: {
        ":id": {
          assignments: {
            $post: (...args: unknown[]) => assignmentsPost(...args),
          },
        },
      },
    },
  },
  // The template picker inside the dialog fetches the org's templates.
  useApi: () => ({ data: { templates: [] }, isLoading: false }),
}));

// The data owner's revalidate, handed in as a prop, so no cache-key guessing.
const onSaved = vi.fn();

beforeEach(() => {
  assignmentsPost.mockReset();
  onSaved.mockReset();
});

function openDialog() {
  render(<AssignmentDialog classId="c1" onSaved={onSaved} />);
  fireEvent.click(screen.getByRole("button", { name: "New assignment" }));
}

const existingAssignment = {
  id: "l1",
  classId: "c1",
  title: "Assignment 1",
  deadline: "2099-08-01T23:59:00.000Z",
  groupMode: "group",
  minMembers: 2,
  maxMembers: 3,
  templateRepoId: null,
  templateRepoFullName: null,
  createdByUserId: "u1",
  createdAt: "2026-03-10T00:00:00.000Z",
  updatedAt: "2026-03-10T00:00:00.000Z",
} as Parameters<typeof AssignmentDialog>[0]["assignment"];

describe("AssignmentDialog", () => {
  it("warns in edit mode that formed groups aren't reshaped", async () => {
    render(
      <AssignmentDialog
        classId="c1"
        assignment={existingAssignment}
        onSaved={onSaved}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit Assignment 1" }));

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Warning about editing a live assignment",
      }),
    );
    expect(
      screen.getByText(/strand formed groups below the new minimum/),
    ).toBeInTheDocument();
  });

  it("shows no edit warning when creating", async () => {
    openDialog();
    await screen.findByRole("button", { name: "Create assignment" });
    expect(
      screen.queryByRole("button", {
        name: "Warning about editing a live assignment",
      }),
    ).not.toBeInTheDocument();
  });

  it("disables Create until title and deadline are set", async () => {
    openDialog();
    const create = await screen.findByRole("button", {
      name: "Create assignment",
    });
    expect(create).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Assignment 1" },
    });
    fireEvent.change(screen.getByLabelText("Deadline"), {
      target: { value: "2099-08-01T23:59" },
    });
    expect(create).not.toBeDisabled();
  });

  it("reveals min/max for group mode and posts the full payload", async () => {
    assignmentsPost.mockResolvedValue({ ok: true, status: 200 });
    openDialog();
    fireEvent.change(await screen.findByLabelText("Title"), {
      target: { value: "Assignment 2" },
    });
    fireEvent.change(screen.getByLabelText("Deadline"), {
      target: { value: "2099-08-01T23:59" },
    });

    expect(screen.queryByLabelText("Min members")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    expect(screen.getByLabelText("Min members")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create assignment" }));
    await waitFor(() => expect(assignmentsPost).toHaveBeenCalled());

    const call = assignmentsPost.mock.calls[0]?.[0] as {
      param: { id: string };
      json: { deadline?: unknown } & Record<string, unknown>;
    };
    expect(call.param).toEqual({ id: "c1" });
    expect(call.json).toMatchObject({
      title: "Assignment 2",
      groupMode: "group",
      minMembers: 2,
      maxMembers: 3,
    });
    expect(typeof call.json.deadline).toBe("string");
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("posts the start date and explains what it gates", async () => {
    openDialog();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Assignment 2" },
    });
    fireEvent.change(screen.getByLabelText("Deadline"), {
      target: { value: "2099-08-01T23:59" },
    });
    fireEvent.change(screen.getByLabelText("Start (optional)"), {
      target: { value: "2099-07-01T08:00" },
    });
    expect(
      screen.getByText(/no access to the starter code/),
    ).toBeInTheDocument();
    assignmentsPost.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "Create assignment" }));
    await waitFor(() => expect(assignmentsPost).toHaveBeenCalled());
    const arg = assignmentsPost.mock.calls[0]?.[0] as {
      json: { startAt?: string };
    };
    expect(arg.json.startAt).toBe(new Date("2099-07-01T08:00").toISOString());
  });

  it("omits startAt entirely when the field stays empty", async () => {
    openDialog();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Assignment 2" },
    });
    fireEvent.change(screen.getByLabelText("Deadline"), {
      target: { value: "2099-08-01T23:59" },
    });
    assignmentsPost.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "Create assignment" }));
    await waitFor(() => expect(assignmentsPost).toHaveBeenCalled());
    const arg = assignmentsPost.mock.calls[0]?.[0] as {
      json: Record<string, unknown>;
    };
    expect("startAt" in arg.json).toBe(false);
  });

  it("disables Create when the start is not before the deadline", async () => {
    openDialog();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Assignment 2" },
    });
    fireEvent.change(screen.getByLabelText("Deadline"), {
      target: { value: "2099-08-01T23:59" },
    });
    fireEvent.change(screen.getByLabelText("Start (optional)"), {
      target: { value: "2099-09-01T08:00" },
    });
    expect(
      screen.getByRole("button", { name: "Create assignment" }),
    ).toBeDisabled();
  });

  it("shows an error when the API refuses", async () => {
    assignmentsPost.mockResolvedValue({ ok: false, status: 400 });
    openDialog();
    fireEvent.change(await screen.findByLabelText("Title"), {
      target: { value: "Assignment 3" },
    });
    fireEvent.change(screen.getByLabelText("Deadline"), {
      target: { value: "2099-08-01T23:59" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create assignment" }));

    expect(
      await screen.findByText(
        "Couldn't create the assignment — check the fields and try again.",
      ),
    ).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
