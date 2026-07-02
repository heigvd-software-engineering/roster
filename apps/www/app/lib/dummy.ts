/**
 * PLACEHOLDER data so the classes hub renders at full fidelity before the
 * backend exists. Replace as features land:
 *   - member counts  → F5 (live org members)
 *   - labs           → F6 (labs table + New-lab)
 *   - progress       → F8 (accepted repos / groups)
 */

type LabMode =
  | { kind: "individual" }
  | { kind: "group"; min: number; max: number };

export type DummyLab = {
  id: string;
  title: string;
  mode: LabMode;
  deadline: Date;
  /** e.g. "12 / 24 accepted" (individual) or "3 groups" (group). */
  progress: string;
};

type ClassMeta = {
  students: number;
  teachers: number;
  labs: DummyLab[];
};

const DAY = 86_400_000;

/** Dummy per-class metadata, keyed loosely on the org login. */
export function dummyClassMeta(login: string): ClassMeta {
  return {
    students: 24,
    teachers: 2,
    labs: [
      {
        id: `${login}-l1`,
        title: "Lab 1 — TCP sockets",
        mode: { kind: "individual" },
        deadline: new Date(Date.now() + 5 * DAY),
        progress: "12 / 24 accepted",
      },
      {
        id: `${login}-l2`,
        title: "Lab 2 — HTTP server",
        mode: { kind: "group", min: 2, max: 3 },
        deadline: new Date(Date.now() + 19 * DAY),
        progress: "3 groups",
      },
    ],
  };
}
