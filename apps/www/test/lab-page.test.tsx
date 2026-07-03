import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useApi } from "~/lib/api";
import { LabPage } from "~/pages/lab-page";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useParams: () => ({ classId: "c1", labId: "l1" }),
    Link: ({
      to,
      children,
      ...rest
    }: React.ComponentProps<"a"> & { to: string }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  };
});

vi.mock("~/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/api")>();
  return { ...actual, useApi: vi.fn() };
});

const lab = {
  id: "l1",
  classId: "c1",
  title: "Lab 1 — TCP sockets",
  deadline: "2099-08-01T23:59:00.000Z",
  groupMode: "individual",
  minMembers: null,
  maxMembers: null,
};

describe("LabPage", () => {
  it("shows the lab header and the F8 roster placeholder", () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        classes: [{ id: "c1", login: "acme", name: "Acme", labs: [lab] }],
      },
    } as unknown as ReturnType<typeof useApi>);

    render(<LabPage />);

    expect(screen.getByText("Lab 1 — TCP sockets")).toBeInTheDocument();
    expect(screen.getByText(/‹ Classes \/ Acme/)).toBeInTheDocument();
    expect(screen.getByText("individual")).toBeInTheDocument();
    expect(screen.getByText("Acceptance roster")).toBeInTheDocument();
  });

  it("shows a not-found message for an unknown lab", () => {
    vi.mocked(useApi).mockReturnValue({
      data: { classes: [] },
    } as unknown as ReturnType<typeof useApi>);

    render(<LabPage />);

    expect(screen.getByText(/This lab doesn't exist/)).toBeInTheDocument();
  });
});
