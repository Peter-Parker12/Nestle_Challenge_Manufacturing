/** Shared by server (enforcement) and browser (hiding buttons). The server always re-checks. */
export type Role = "sales_lead" | "category_manager" | "field_rep" | "analyst" | "admin" | "viewer";

export const PERMISSIONS = {
  refresh: ["analyst", "sales_lead", "category_manager", "admin"],
  decide: ["sales_lead", "category_manager"],
  uploadPhoto: ["field_rep", "analyst", "sales_lead", "category_manager", "admin"],
  checkReading: ["field_rep", "analyst", "sales_lead", "category_manager"],
  manageSettings: ["category_manager", "admin"],
  importData: ["analyst", "admin"],
  viewAudit: ["admin", "sales_lead", "category_manager"],
  useAi: ["sales_lead", "category_manager", "field_rep", "analyst", "admin", "viewer"],
} satisfies Record<string, Role[]>;

export type Action = keyof typeof PERMISSIONS;
export const can = (role: Role | undefined, action: Action) => !!role && (PERMISSIONS[action] as Role[]).includes(role);
