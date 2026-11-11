// Where a person stands with the business. Safe to import anywhere (no database access).
//
// Borrowed from how CRMs separate "where in the funnel" from everything else: one short, ordered list that
// moves forward (prospect -> active lead -> customer), plus "do not contact", which is a hard stop, not a stage.

export const LEAD_STAGES = ["prospect", "lead", "dnc"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const LEAD_SQL = "('prospect', 'lead', 'dnc')";

export const isLeadStage = (s: string | null | undefined): s is LeadStage => (LEAD_STAGES as readonly string[]).includes(s ?? "");

export const STAGE_LABEL: Record<string, string> = {
  prospect: "Prospect",
  lead: "Active lead",
  dnc: "Do not contact",
  pending: "Sign-up to review",
  active: "Customer",
  paused: "Customer (paused)",
  inactive: "Former customer",
  declined: "Declined",
};

export const STAGE_HELP: Record<string, string> = {
  prospect: "We have their details. No conversation yet.",
  lead: "We are talking with them or they asked for something.",
  customer: "They are buying. The manager adds their boat plan.",
  dnc: "They asked not to be contacted. No texts, email or mailings.",
};

export const STAGE_TONE: Record<string, string> = { prospect: "idle", lead: "warn", dnc: "bad", active: "good" };

// Choices offered when moving someone. "customer" stores as the status "active".
export const MOVE_TARGETS: [string, string][] = [
  ["prospect", "Prospect"],
  ["lead", "Active lead"],
  ["customer", "Customer"],
  ["dnc", "Do not contact"],
];
