import { baseUrl, smsProvider } from "@/lib/messaging/providers";
import { handleInbound, handleStatus } from "@/lib/messaging/send";

// Where the text or email service delivers customer replies and delivery receipts.
// The address names the provider; only the provider currently configured is accepted, and each request
// must pass that provider's own verification (a signature or a shared secret).
export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const p = smsProvider();
  if (p.name !== provider) return new Response("Not found", { status: 404 });
  const raw = await req.text();
  if (raw.length > 100_000) return new Response("Too large", { status: 413 });
  const parsed = await p.parse(req, raw, `${baseUrl()}/api/messaging/inbound/${p.name}`);
  if (!parsed) return new Response("Forbidden", { status: 403 });
  try {
    if (parsed.inbound) await handleInbound(parsed.inbound);
    if (parsed.status) await handleStatus(parsed.status);
  } catch (err) {
    console.error("inbound failed", err);
    return new Response("Try again", { status: 500 }); // the provider will retry
  }
  return p.reply();
}
