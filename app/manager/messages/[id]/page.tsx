import Link from "next/link";
import { notFound } from "next/navigation";
import { discardMessage, retryMessage, sendToCustomer, simulateReply } from "../../messaging-actions";
import MessagingStatus from "@/components/MessagingStatus";
import { Badge, Empty, Notice, PageHead } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { q } from "@/lib/db";
import { isUuid } from "@/lib/ids";
import { canSend, quietUntil } from "@/lib/messaging/compliance";
import { messagingStatus, smsProvider } from "@/lib/messaging/providers";
import { getRecipient } from "@/lib/messaging/send";
import { requireManager } from "@/lib/session";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> };
type Msg = {
  id: string; channel: string; direction: string; purpose: string; subject: string; body: string; status: string; block_reason: string; error: string;
  created_at: string; sent_at: string | null; send_after: string | null; created_by: string; from_addr: string; provider: string;
};

const STATUS_TEXT: Record<string, string> = {
  pending_approval: "Waiting for your approval", queued: "Scheduled", sending: "Sending", sent: "Sent", delivered: "Delivered",
  failed: "Failed", blocked: "Blocked", cancelled: "Cancelled", received: "",
};

// One person's conversation: every text and email in both directions, with a box to reply.
export default async function Conversation({ params, searchParams }: Props) {
  await requireManager();
  const { id } = await params;
  const sp = await searchParams;
  const unknown = id === "unknown";
  if (!unknown && !isUuid(id)) notFound();
  const c = unknown ? null : await getRecipient(id);
  if (!unknown && !c) notFound();
  const back = `/manager/messages/${id}`;
  // Opening the conversation marks incoming messages as read.
  await q(`update messages set read_at = now() where ${unknown ? "customer_id is null" : "customer_id = $1"} and direction = 'in' and read_at is null`, unknown ? [] : [id]);
  const msgs = await q<Msg>(
    `select id, channel, direction, purpose, subject, body, status, block_reason, error, created_at, sent_at, send_after, created_by, from_addr, provider
     from messages where ${unknown ? "customer_id is null" : "customer_id = $1"} order by created_at desc limit 200`,
    unknown ? [] : [id],
  );
  msgs.reverse();
  const status = messagingStatus();
  const [sms, promo, email, templates] = c
    ? await Promise.all([
        canSend(c, "sms", "service", { manual: true }),
        canSend(c, "sms", "marketing", { manual: true }),
        canSend(c, "email", "service", { manual: true }),
        q<{ id: string; name: string; purpose: string; has_sms: boolean; has_email: boolean }>(
          "select id, name, purpose, sms_body <> '' as has_sms, email_body <> '' as has_email from message_templates where active and key is distinct from 'opt_in' and key not like 'reminder_%' order by sort, name",
        ),
      ])
    : [null, null, null, []];
  const quiet = quietUntil();
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;

  return (
    <>
      <PageHead title={c ? c.name : "Unknown senders"} sub={c ? <>{c.phone || "No phone"} · {c.email || "No email"} · prefers {c.contact_pref === "none" ? "no messages" : c.contact_pref}</> : "Texts from numbers that match no customer or prospect"}>
        {c && <Link className="btn small-btn" href={`/manager/customers/${c.id}`}>Customer page</Link>}
        <Link className="btn small-btn" href="/manager/messages">All conversations</Link>
      </PageHead>
      <Notice ok={sp.ok} error={sp.error} />
      <MessagingStatus />

      <section className="thread">
        {msgs.length === 0 && <Empty>No messages yet.</Empty>}
        {msgs.map((m) => (
          <div key={m.id} className={`bubble ${m.direction} ${m.status}`}>
            {unknown && m.direction === "in" && <div className="small muted">From {m.from_addr}</div>}
            {m.channel === "email" && m.subject && <div className="small"><strong>{m.subject}</strong></div>}
            <div className="bubble-body">{m.body}</div>
            <div className="bubble-meta">
              {m.channel === "sms" ? "Text" : "Email"} · {fmtDateTime(m.sent_at ?? m.created_at)}
              {m.direction === "out" && <> · {m.status === "queued" && m.send_after ? `Sends ${fmtDateTime(m.send_after)}` : STATUS_TEXT[m.status]}{m.provider === "test" && ["sent", "delivered"].includes(m.status) ? " (test mode, not delivered)" : ""}</>}
              {m.direction === "out" && m.created_by.startsWith("auto:") && " · automatic"}
              {m.purpose === "marketing" && " · marketing"}
            </div>
            {(m.block_reason || m.error) && <div className="small warn-text">{m.block_reason || m.error}</div>}
            {["failed", "blocked", "queued"].includes(m.status) && m.direction === "out" && (
              <form action={retryMessage} className="btn-row tight">
                {hidden("id", m.id)}
                {hidden("back", back)}
                {m.status !== "queued" && <button className="linkish">Try again</button>}
                <button className="linkish" formAction={discardMessage}>{m.status === "queued" ? "Cancel" : "Dismiss"}</button>
              </form>
            )}
          </div>
        ))}
      </section>

      {c && (
        <section className="card stack" id="reply">
          <h2>Send a message</h2>
          <div className="small stack tight">
            <div>Texts about their service: {sms!.ok ? <Badge tone="good">allowed</Badge> : <><Badge tone="warn">not allowed</Badge> <span className="muted">{sms!.reason}</span></>}</div>
            <div>Marketing texts: {promo!.ok ? <Badge tone="good">allowed</Badge> : <><Badge tone="warn">not allowed</Badge> <span className="muted">{promo!.reason}</span></>}</div>
            <div>Email: {email!.ok ? <Badge tone="good">allowed</Badge> : <><Badge tone="warn">not allowed</Badge> <span className="muted">{email!.reason}</span></>}{c.email_opted_out_at ? <span className="muted"> Unsubscribed from marketing email.</span> : null}</div>
            {quiet && <div className="muted">It is outside texting hours (8 am to 9 pm Pacific). Texts typed now go out at 8 am unless the customer texted you in the last hour.</div>}
          </div>
          <form action={sendToCustomer} className="stack">
            {hidden("customer_id", c.id)}
            {hidden("back", back)}
            <div className="row wrap">
              <label className="field">
                <span>Send by</span>
                <select name="channel" defaultValue={c.contact_pref === "email" || !sms!.ok ? "email" : "sms"}>
                  <option value="sms">Text</option>
                  <option value="email">Email</option>
                </select>
              </label>
              <label className="field grow">
                <span>Use a template (optional; replaces what you type)</span>
                <select name="template_id" defaultValue="">
                  <option value="">Type my own message</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}{t.purpose === "marketing" ? " (marketing)" : ""}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field"><span>Subject (email only)</span><input name="subject" maxLength={150} /></label>
            <label className="field"><span>Message</span><textarea name="body" rows={3} maxLength={5000} placeholder="Type your message" /></label>
            <label className="check small"><input type="checkbox" name="marketing" /> <span>This is a promotion or offer (marketing rules apply)</span></label>
            <button className="btn primary">Send</button>
          </form>
        </section>
      )}

      {c && !smsProvider().live && (
        <details className="card">
          <summary>Test mode: simulate a text from this customer</summary>
          <form action={simulateReply} className="row wrap">
            {hidden("customer_id", c.id)}
            {hidden("back", back)}
            <label className="field grow"><span>What the customer texts (try YES, NO, STOP, HELP or any sentence)</span><input name="body" /></label>
            <button className="btn small-btn">Record reply</button>
          </form>
          <p className="muted small">Available only while no text provider is connected ({status.sms.name}).</p>
        </details>
      )}
    </>
  );
}
