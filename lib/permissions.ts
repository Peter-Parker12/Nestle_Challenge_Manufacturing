/** Shared by server (enforcement) and browser (hiding buttons). The server always re-checks. */
export type Role = "rd_engineer" | "process_engineer" | "qa" | "category_owner" | "supply_chain" | "plant_admin" | "viewer";

export const PERMISSIONS = {
  createLaunch: ["rd_engineer", "process_engineer", "plant_admin"],
  setRecipeWeights: ["rd_engineer", "process_engineer"],
  recommend: ["rd_engineer", "process_engineer"],
  decide: ["rd_engineer", "process_engineer"],
  startRun: ["process_engineer"],
  enterResults: ["process_engineer", "qa"],
  reviewRun: ["process_engineer", "qa"],
  recordTA: ["qa"],
  cancelLaunch: ["rd_engineer", "process_engineer", "plant_admin"],
  categoryWeights: ["category_owner"],
  extraction: ["process_engineer", "rd_engineer"],
  ruleDecision: ["category_owner"],
  importHistory: ["plant_admin", "category_owner", "process_engineer"],
  viewAudit: ["plant_admin", "category_owner", "qa"],
  useAi: ["rd_engineer", "process_engineer", "qa", "category_owner", "supply_chain", "plant_admin", "viewer"],
} satisfies Record<string, Role[]>;

export type Action = keyof typeof PERMISSIONS;
export const can = (role: Role | undefined, action: Action) => !!role && (PERMISSIONS[action] as Role[]).includes(role);
