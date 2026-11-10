// Message templates: the built-in set and the merge-field renderer. No database access here.

export type TemplateSeed = {
  key: string;
  name: string;
  purpose: "service" | "marketing";
  sms: string;
  subject: string;
  email: string;
  autoSend: boolean;
  active: boolean;
  sort: number;
};

// Merge fields a manager can use in any template.
export const MERGE_FIELDS: [string, string][] = [
  ["{first_name}", "Customer's first name"],
  ["{name}", "Customer's full name"],
  ["{boat}", "Boat name"],
  ["{date}", "Visit date, for example Thursday, November 12"],
  ["{service}", "Service name"],
  ["{link}", "Link to the photos or the customer's boat page"],
  ["{message}", "The crew's note when finishing a visit"],
  ["{reason}", "Why a visit was skipped"],
  ["{business}", "Your business name"],
];

// System templates are tied to an event by key. A manager can edit the wording, turn one off,
// or switch it to "needs my approval". Keys must not change.
export const DEFAULT_TEMPLATES: TemplateSeed[] = [
  {
    key: "opt_in",
    name: "Text sign-up confirmation",
    purpose: "service",
    sms: "{business}: you're signed up for texts about your boat cleanings (reminders, confirmations, photo links). Message frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.",
    subject: "",
    email: "",
    autoSend: true,
    active: true,
    sort: 1,
  },
  {
    key: "visit_reminder",
    name: "Reminder the day before a visit",
    purpose: "service",
    sms: "{business}: {boat} is scheduled for cleaning tomorrow, {date}. Reply YES to confirm or NO if you need a different day.",
    subject: "{boat} is scheduled for cleaning tomorrow",
    email: "Hi {first_name},\n\n{boat} is scheduled for cleaning tomorrow, {date}.\n\nIf you need a different day, reply to this email or use your boat page: {link}",
    autoSend: true,
    active: true,
    sort: 2,
  },
  {
    key: "reminder_yes",
    name: "Reply when a customer confirms (YES)",
    purpose: "service",
    sms: "{business}: thanks, {boat} is confirmed for {date}.",
    subject: "",
    email: "",
    autoSend: true,
    active: true,
    sort: 3,
  },
  {
    key: "reminder_no",
    name: "Reply when a customer declines (NO)",
    purpose: "service",
    sms: "{business}: got it, we won't come {date}. We'll be in touch to pick a new day.",
    subject: "",
    email: "",
    autoSend: true,
    active: true,
    sort: 4,
  },
  {
    key: "photos_ready",
    name: "Visit finished, photos ready",
    purpose: "service",
    sms: "{business}: {boat} is done. {message} Before and after photos: {link}",
    subject: "{boat} is clean: before and after photos",
    email: "Hi {first_name},\n\nWe finished {boat} on {date}. {message}\n\nSee and share your before and after photos: {link}",
    autoSend: true,
    active: true,
    sort: 5,
  },
  {
    key: "visit_skipped",
    name: "Visit could not be done",
    purpose: "service",
    sms: "{business}: we couldn't clean {boat} today ({reason}). We'll be in touch to reschedule.",
    subject: "We couldn't clean {boat} today",
    email: "Hi {first_name},\n\nWe weren't able to clean {boat} today. Reason: {reason}.\n\nWe'll be in touch to reschedule.",
    autoSend: true,
    active: true,
    sort: 6,
  },
  {
    key: "request_approved",
    name: "Extra service booked",
    purpose: "service",
    sms: "{business}: your {service} for {boat} is booked for {date}.",
    subject: "Your {service} is booked for {date}",
    email: "Hi {first_name},\n\nYour {service} for {boat} is booked for {date}.\n\nYour boat page: {link}",
    autoSend: true,
    active: true,
    sort: 7,
  },
  {
    key: "seasonal_offer",
    name: "Example: seasonal offer",
    purpose: "marketing",
    sms: "{business}: spring detail slots are open. Reply to this text to book {boat}.",
    subject: "Spring detail slots are open",
    email: "Hi {first_name},\n\nSpring detail slots are open. Reply to this email to book {boat}.",
    autoSend: false,
    active: false,
    sort: 50,
  },
];

export type Vars = Record<string, string | null | undefined>;

// Replaces {field} with its value. Unknown or empty fields become nothing, then spacing is tidied.
export function render(text: string, vars: Vars): string {
  return text
    .replace(/\{([a-z_]+)\}/g, (_, k: string) => String(vars[k] ?? ""))
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Fields a template uses that the manager has no value for (shown as a warning before sending to a group).
export function fieldsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]))];
}

// One text message segment holds 160 plain characters, or 70 if the text has emoji or unusual characters.
export function smsSegments(body: string): number {
  const plain = /^[\x20-\x7E\n\r€£¥èéùìòÇØøÅåÆæßÉÄÖÑÜ§¿äöñüà]*$/.test(body);
  const [single, multi] = plain ? [160, 153] : [70, 67];
  return body.length <= single ? 1 : Math.ceil(body.length / multi);
}
