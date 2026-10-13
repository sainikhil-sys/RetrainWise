/** Roles and permissions (shared by server and client; the server is the enforcer). */

export const ROLES = ["viewer", "operator", "approver", "admin"] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { viewer: 0, operator: 1, approver: 2, admin: 3 };

export const ROLE_LABELS: Record<Role, string> = { viewer: "Viewer", operator: "Operator", approver: "Approver", admin: "Admin" };

export const ROLE_HELP: Record<Role, string> = {
  viewer: "Inspects monitoring, decisions, models, reports and experiments.",
  operator: "Runs streams, processes batches, evaluates options, trains candidates, runs benchmarks and requests actions.",
  approver: "Everything an operator can do, plus approving or rejecting updates, promotions and rollbacks.",
  admin: "Everything, plus team and role management, cost settings, budgets, autonomy limits and workspace settings.",
};

/** Minimum role for each capability. */
export const PERMISSIONS = {
  view: "viewer",
  "stream.operate": "operator", // start runs, process batches, evaluate options, download datasets
  "stream.configure": "operator", // batch size, label delay, seed and other stream settings
  "action.request": "operator", // request keep / partial / full, request promotion of a candidate
  "model.train": "operator", // create training jobs (candidates only)
  "experiments.run": "operator",
  "agent.run": "operator",
  "action.approve": "approver", // approve or reject update requests and decisions
  "model.promote": "approver", // approve and promote validated candidates, reject candidates
  "model.rollback": "approver",
  "jobs.delete": "admin", // delete failed / cancelled jobs
  "settings.engine": "admin", // costs, budgets, guardrails, autonomy, agent
  "team.manage": "admin",
  "workspace.manage": "admin",
} as const satisfies Record<string, Role>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[PERMISSIONS[permission]];
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Settings an operator may change; everything else needs an admin. */
export const OPERATOR_SETTINGS = new Set([
  "seed",
  "batch_size",
  "initial_size",
  "label_delay_batches",
  "label_fraction",
]);
