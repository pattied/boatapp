import { createHmac, timingSafeEqual } from "crypto";

// Delivery services sit behind two small interfaces, so the rest of the app never names a vendor.
// Choose with SMS_PROVIDER and EMAIL_PROVIDER. The default, "test", records messages and sends nothing.
//
// To add a vendor: write one object below that implements SmsProvider or EmailProvider and add it to the map.
// "http" is a vendor-free option: it posts JSON to an address you control (a small relay, Zapier, Make, n8n).

export type Outcome = { id: string };
export type Inbound = { channel: "sms" | "email"; from: string; to: string; subject?: string; body: string; providerId: string };
export type StatusUpdate = { providerId: string; status: "delivered" | "failed"; error?: string };
export type Parsed = { inbound?: Inbound; status?: StatusUpdate };

export type SmsProvider = {
  name: string;
  live: boolean;
  // True when the vendor itself answers STOP, START and HELP, so this app must not answer twice.
  answersKeywords: boolean;
  missing(): string[];
  send(m: { to: string; body: string; statusUrl: string }): Promise<Outcome>;
  // Verifies the request came from the vendor, then reads it. Returns null when verification fails.
  parse(req: Request, raw: string, publicUrl: string): Promise<Parsed | null>;
  reply(): Response;
};

export type EmailProvider = {
  name: string;
  live: boolean;
  missing(): string[];
  send(m: { to: string; subject: string; text: string; html: string; headers: Record<string, string> }): Promise<Outcome>;
};

const env = (k: string) => (process.env[k] ?? "").trim();
const need = (...keys: string[]) => keys.filter((k) => !env(k));

function sameSecret(a: string, b: string) {
  const x = createHmac("sha256", "cmp").update(a).digest();
  const y = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(x, y);
}

async function post(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Provider answered ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// Shared by the vendor-free "http" option for texts and email, in both directions.
function bearerOk(req: Request) {
  const secret = env("MESSAGING_INBOUND_SECRET");
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return Boolean(secret) && sameSecret(given, secret);
}

function parseHttpJson(raw: string): Parsed | null {
  try {
    const b = JSON.parse(raw) as Record<string, unknown>;
    const s = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
    if (s("status")) {
      return { status: { providerId: s("id"), status: s("status") === "delivered" ? "delivered" : "failed", error: s("error") } };
    }
    if (!s("from") || !s("body")) return {};
    return { inbound: { channel: s("channel") === "email" ? "email" : "sms", from: s("from"), to: s("to"), subject: s("subject"), body: s("body"), providerId: s("id") } };
  } catch {
    return null;
  }
}

const testSms: SmsProvider = {
  name: "test",
  live: false,
  answersKeywords: false,
  missing: () => [],
  send: async () => ({ id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }),
  // Test mode accepts simulated customer replies only with the shared secret (used by the automated tests).
  parse: async (req, raw) => (bearerOk(req) ? parseHttpJson(raw) : null),
  reply: () => Response.json({ ok: true }),
};

const httpSms: SmsProvider = {
  name: "http",
  live: true,
  answersKeywords: false,
  missing: () => need("SMS_HTTP_URL", "SMS_HTTP_TOKEN", "MESSAGING_INBOUND_SECRET"),
  async send(m) {
    const r = (await post(env("SMS_HTTP_URL"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env("SMS_HTTP_TOKEN")}` },
      body: JSON.stringify({ to: m.to, from: env("SMS_FROM"), body: m.body, statusUrl: m.statusUrl }),
    })) as { id?: string };
    return { id: String(r.id ?? "") };
  },
  parse: async (req, raw) => (bearerOk(req) ? parseHttpJson(raw) : null),
  reply: () => Response.json({ ok: true }),
};

const twilio: SmsProvider = {
  name: "twilio",
  live: true,
  answersKeywords: true,
  missing: () => [...need("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"), ...(env("TWILIO_MESSAGING_SERVICE_SID") || env("SMS_FROM") ? [] : ["SMS_FROM or TWILIO_MESSAGING_SERVICE_SID"])],
  async send(m) {
    const form = new URLSearchParams({ To: m.to, Body: m.body, StatusCallback: m.statusUrl });
    if (env("TWILIO_MESSAGING_SERVICE_SID")) form.set("MessagingServiceSid", env("TWILIO_MESSAGING_SERVICE_SID"));
    else form.set("From", env("SMS_FROM"));
    const auth = Buffer.from(`${env("TWILIO_ACCOUNT_SID")}:${env("TWILIO_AUTH_TOKEN")}`).toString("base64");
    const r = (await post(`https://api.twilio.com/2010-04-01/Accounts/${env("TWILIO_ACCOUNT_SID")}/Messages.json`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${auth}` },
      body: form.toString(),
    })) as { sid?: string };
    return { id: String(r.sid ?? "") };
  },
  async parse(req, raw, publicUrl) {
    const params = new URLSearchParams(raw);
    // Twilio signs the full address plus every field, sorted by name.
    const data = publicUrl + [...params.keys()].sort().map((k) => k + (params.get(k) ?? "")).join("");
    const expected = createHmac("sha1", env("TWILIO_AUTH_TOKEN")).update(data).digest("base64");
    if (!env("TWILIO_AUTH_TOKEN") || !sameSecret(req.headers.get("x-twilio-signature") ?? "", expected)) return null;
    const status = params.get("MessageStatus");
    const sid = params.get("MessageSid") ?? "";
    if (status && !params.get("Body")) {
      if (status === "delivered") return { status: { providerId: sid, status: "delivered" } };
      if (status === "failed" || status === "undelivered") {
        return { status: { providerId: sid, status: "failed", error: `Carrier error ${params.get("ErrorCode") ?? ""}`.trim() } };
      }
      return {};
    }
    return { inbound: { channel: "sms", from: params.get("From") ?? "", to: params.get("To") ?? "", body: params.get("Body") ?? "", providerId: sid } };
  },
  reply: () => new Response("<Response></Response>", { headers: { "content-type": "text/xml" } }),
};

const testEmail: EmailProvider = {
  name: "test",
  live: false,
  missing: () => [],
  send: async () => ({ id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }),
};

const httpEmail: EmailProvider = {
  name: "http",
  live: true,
  missing: () => need("EMAIL_HTTP_URL", "EMAIL_HTTP_TOKEN", "EMAIL_FROM"),
  async send(m) {
    const r = (await post(env("EMAIL_HTTP_URL"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env("EMAIL_HTTP_TOKEN")}` },
      body: JSON.stringify({ from: env("EMAIL_FROM"), replyTo: env("EMAIL_REPLY_TO"), ...m }),
    })) as { id?: string };
    return { id: String(r.id ?? "") };
  },
};

const resend: EmailProvider = {
  name: "resend",
  live: true,
  missing: () => need("RESEND_API_KEY", "EMAIL_FROM"),
  async send(m) {
    const r = (await post("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env("RESEND_API_KEY")}` },
      body: JSON.stringify({
        from: env("EMAIL_FROM"),
        to: [m.to],
        subject: m.subject,
        text: m.text,
        html: m.html,
        headers: m.headers,
        ...(env("EMAIL_REPLY_TO") ? { reply_to: env("EMAIL_REPLY_TO") } : {}),
      }),
    })) as { id?: string };
    return { id: String(r.id ?? "") };
  },
};

const SMS: Record<string, SmsProvider> = { test: testSms, http: httpSms, twilio };
const EMAIL: Record<string, EmailProvider> = { test: testEmail, http: httpEmail, resend };

export const SMS_PROVIDERS = Object.keys(SMS);
export const EMAIL_PROVIDERS = Object.keys(EMAIL);

// An unknown or half-configured provider never sends: the caller sees what is missing instead.
export function smsProvider(name = env("SMS_PROVIDER") || "test"): SmsProvider {
  return SMS[name.toLowerCase()] ?? { ...testSms, name, missing: () => [`SMS_PROVIDER "${name}" is not supported`] };
}
export function emailProvider(name = env("EMAIL_PROVIDER") || "test"): EmailProvider {
  return EMAIL[name.toLowerCase()] ?? { ...testEmail, name, missing: () => [`EMAIL_PROVIDER "${name}" is not supported`] };
}

export function messagingStatus() {
  const sms = smsProvider();
  const email = emailProvider();
  return {
    sms: { name: sms.name, live: sms.live, missing: sms.missing() },
    email: { name: email.name, live: email.live, missing: email.missing() },
    postalAddress: env("BUSINESS_ADDRESS"),
    helpContact: env("MANAGER_PHONE") || env("EMAIL_REPLY_TO"),
    baseUrl: baseUrl(),
  };
}

// The site's public address, used in links inside messages and for vendor callbacks.
export function baseUrl(): string {
  const explicit = env("APP_URL").replace(/\/$/, "");
  if (explicit) return explicit;
  const vercel = env("VERCEL_PROJECT_PRODUCTION_URL");
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}
