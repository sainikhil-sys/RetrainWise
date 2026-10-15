import { z } from "zod";

/** Profile collected at first sign-in (shared by the form and the API). */
export const TEAM_ROLES = [
  { id: "ml_engineer", label: "ML engineer" },
  { id: "data_scientist", label: "Data scientist" },
  { id: "mlops", label: "MLOps / platform" },
  { id: "engineering_lead", label: "Engineering lead" },
  { id: "risk_compliance", label: "Risk & compliance" },
  { id: "other", label: "Other" },
] as const;

export const USE_CASES = [
  "Fraud or risk scoring",
  "Recommendations or ranking",
  "Demand or time-series forecasting",
  "Pricing",
  "Churn or marketing",
  "Exploring / evaluating",
  "Other",
] as const;

export const MODEL_COUNTS = ["none", "1", "2-5", "6-20", "21+"] as const;

export const ProfileSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name.").max(80, "At most 80 characters."),
  jobTitle: z.string().trim().min(2, "Enter your job title.").max(80, "At most 80 characters."),
  company: z.string().trim().min(1, "Enter your company or organisation.").max(100, "At most 100 characters."),
  teamRole: z.enum(TEAM_ROLES.map((r) => r.id) as [string, ...string[]], { message: "Choose the role closest to yours." }),
  useCase: z.enum(USE_CASES, { message: "Choose what you plan to monitor." }),
  modelsInProduction: z.enum(MODEL_COUNTS, { message: "Choose how many models you run." }),
  emailApprovals: z.boolean(),
});
export type Profile = z.infer<typeof ProfileSchema>;
