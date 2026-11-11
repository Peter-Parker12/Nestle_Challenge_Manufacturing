/** Shared by server (enforcement) and browser (hiding buttons). The server always re-checks. */
export type Role = "rd_engineer" | "process_engineer" | "qa" | "category_owner" | "supply_chain" | "plant_admin" | "viewer" | "maintenance";

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
  manageFields: ["category_owner"],
  manageProcess: ["category_owner", "plant_admin"],
  backfillFields: ["category_owner", "plant_admin"],
  extraction: ["process_engineer", "rd_engineer"],
  ruleDecision: ["category_owner"],
  importHistory: ["plant_admin", "category_owner", "process_engineer"],
  viewAudit: ["plant_admin", "category_owner", "qa"],
  manageAssets: ["plant_admin", "maintenance"],
  recordSealWork: ["maintenance", "process_engineer", "plant_admin"],
  recordInspection: ["maintenance", "qa", "process_engineer", "plant_admin"],
  recordIncident: ["maintenance", "qa", "process_engineer", "plant_admin"],
  manageStops: ["plant_admin", "process_engineer", "maintenance"],
  importAssets: ["plant_admin", "maintenance"],
  useAi: ["maintenance", "rd_engineer", "process_engineer", "qa", "category_owner", "supply_chain", "plant_admin", "viewer"],
} satisfies Record<string, Role[]>;

export type Action = keyof typeof PERMISSIONS;
export const can = (role: Role | undefined, action: Action) => !!role && (PERMISSIONS[action] as Role[]).includes(role);
