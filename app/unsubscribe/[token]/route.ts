import { getConfig } from "@/lib/config";
import { one, tx } from "@/lib/db";
import { optOutEmail } from "@/lib/messaging/compliance";

// Email unsubscribe. Opening the link shows a one-button page (so mail scanners that open links do not
// unsubscribe anyone by accident). Mail apps' built-in "Unsubscribe" button posts here directly.
const page = (title: string, body: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{font-family:system-ui,Arial,sans-serif;background:#f3f6f9;color:#12202e;margin:0;padding:32px 16px}main{max-width:460px;margin:0 auto;background:#fff;border-radius:14px;padding:24px;border:1px solid #d8e0e8}h1{font-size:22px;margin:0 0 12px}button{font:inherit;font-weight:700;padding:12px 18px;border-radius:10px;border:0;background:#0f2a44;color:#fff;cursor:pointer}p{line-height:1.5}</style></head>
<body><main><h1>${title}</h1>${body}</main></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

const find = (token: string) =>
  /^[A-Za-z0-9_-]{16,40}$/.test(token) ? one<{ id: string; email_opted_out_at: string | null }>("select id, email_opted_out_at from customers where unsubscribe_token = $1", [token]) : null;

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { businessName } = getConfig();
  const c = await find((await ctx.params).token);
  if (!c) return page("Link not recognized", "<p>This unsubscribe link is not valid. Reply to any of our emails and we will remove you.</p>");
  if (c.email_opted_out_at) return page("You are unsubscribed", `<p>You will get no more marketing email from ${businessName}. We may still email you about cleanings you have booked.</p>`);
  return page("Unsubscribe from marketing email?", `<p>${businessName} will stop sending you offers and news. We may still email you about cleanings you have booked.</p><form method="post"><button>Unsubscribe</button></form>`);
}

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { businessName } = getConfig();
  const c = await find((await ctx.params).token);
  if (!c) return page("Link not recognized", "<p>This unsubscribe link is not valid.</p>");
  await tx((t) => optOutEmail(t, c.id, "Unsubscribe link", "customer"));
  return page("You are unsubscribed", `<p>You will get no more marketing email from ${businessName}.</p>`);
}
