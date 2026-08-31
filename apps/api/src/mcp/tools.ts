import type { ZodRawShape } from "zod";
import { z } from "zod";

/**
 * The tool table: names, descriptions, input schemas, and which endpoint each
 * projects. No logic — the MCP equivalent of `routes/`. A tool that is not
 * declared here does not exist, including every endpoint added later; and a
 * tool never imports a handler or a `lib/` operation (R9) — it names an
 * endpoint, and the lane (`lib/mcp/`) calls it the way any client would.
 *
 * The descriptions are written by hand and they matter: they are the text a
 * model reasons over when choosing a tool.
 */
export type McpToolSpec = {
  /** snake_case tool name, what an MCP client shows and a model picks. */
  name: string;
  /** Hand-written; carries the tool choice. */
  description: string;
  /** The scope the consent must still grant for this tool to run. */
  scope: "roster:read" | "roster:write";
  /** Field → zod type; the lane wraps it in `z.object()` and the endpoint
   *  only ever sees validated strings. */
  inputSchema: ZodRawShape;
  method: "GET";
  /** The endpoint this tool projects, built from validated input. */
  path: (input: Record<string, string>) => string;
};

/** Phase 1, decision #4: two read tools, both pure projections. */
export const mcpTools: readonly McpToolSpec[] = [
  {
    name: "list_classes",
    description:
      "The classes the signed-in teacher teaches, each with its assignments " +
      "nested, plus the classes they attend as a student. Start here: every " +
      "classId and assignmentId another tool needs comes from this answer.",
    scope: "roster:read",
    inputSchema: {},
    method: "GET",
    path: () => "/api/classes",
  },
  {
    name: "list_assignment_groups",
    description:
      "One assignment's whole group-formation picture in one response: every " +
      "group with its members and the state of its work repository (created, " +
      "missing, or failed), the enrolled students, and the user profiles to " +
      "name them. Groups without a repository and students in no group are " +
      "the gaps worth reporting. Ids come from list_classes.",
    scope: "roster:read",
    inputSchema: {
      classId: z.string().describe("The class id, from list_classes."),
      assignmentId: z
        .string()
        .describe("The assignment id, nested in list_classes' answer."),
    },
    method: "GET",
    path: ({ classId = "", assignmentId = "" }) =>
      `/api/classes/${encodeURIComponent(classId)}` +
      `/assignments/${encodeURIComponent(assignmentId)}/groups`,
  },
];
