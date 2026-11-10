import Link from "next/link";
import { approveBatch, approveMessage, discardMessage, retryMessage } from "../messaging-actions";
import MessagingStatus from "@/components/MessagingStatus";
import { Badge, Empty, Notice, PageHead } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { q } from "@/lib/db";
import { smsSegments } from "@/lib/messaging/templates";
import { requireManager } from "@/lib/session";

type SP = Promise<{ ok?: string; error?: string; tab?: string }>;

type Thread = { customer_id: string | null; name: string | null; status: string | null; last_at: string; last_body: string; last_dir: string; last_channel: string; unread: number };
type Row = {
  id: string; customer_id: string | null; name: string | null; channel: string; purpose: string; to_addr: string; subject: string; body: string;
  status: string; block_reason: string; error: string; created_at: string; batch_id: string | null; template: string | null; send_after: string | null;
};

const ROW = `select m.id, m.customer_id, c.name, m.channel, m.purpose, m.to_addr, m.subject, m.body, m.status, m.block_reason, m.error, m.created_at,
  m.batch_id, t.name as template, m.send_after
  from messages m left join customers c on c.id = m.customer_id left join message_templates t on t.id = m.template_id`;

export default async function Messages({ searchParams }: { searchParams: SP }) {
  await requireManager();
  const sp = await searchParams;
  const tab = ["approval", "problems", "waiting"].includes(sp.tab ?? "") ? sp.tab! : "inbox";
  const back = `/manager/messages${tab === "inbox" ? "" : `?tab=${tab}`}`;
  const [counts] = await q<{ unread: number; approval: number; problems: number; waiting: number }>(
    `select (select count(*)::int from messages where direction = 'in' and read_at is null) as unread,
            (select count(*)::int from messages where status = 'pending_approval') as approval,
            (select count(*)::int from messages where status in ('failed', 'blocked') and created_at > now() - interval '14 days') as problems,
            (select count(*)::int from messages where status in ('queued', 'sending')) as waiting`,
  );
  const tabs: [string, string][] = [
    ["inbox", `Conversations${counts.unread ? ` (${counts.unread} new)` : ""}`],
    ["approval", `Waiting for approval (${counts.approval})`],
    ["waiting", `Scheduled (${counts.waiting})`],
    ["problems", `Problems (${counts.problems})`],
  ];
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;

  const threads =
    tab === "inbox"
      ? await q<Thread>(
          `select x.customer_id, c.name, c.status, x.last_at, x.last_body, x.last_dir, x.last_channel, x.unread from (
             select customer_id, max(created_at) as last_at,
               (array_agg(body order by created_at desc))[1] as last_body,
               (array_agg(direction order by created_at desc))[1] as last_dir,
               (array_agg(channel order by created_at desc))[1] as last_channel,
               count(*) filter (where direction = 'in' and read_at is null)::int as unread
             from messages where status not in ('blocked', 'cancelled', 'pending_approval') group by customer_id) x
           left join customers c on c.id = x.customer_id order by x.unread > 0 desc, x.last_at desc limit 100`,
        )
      : [];
  const rows =
    tab === "approval"
      ? await q<Row>(`${ROW} where m.status = 'pending_approval' order by m.batch_id nulls first, m.created_at limit 300`)
      : tab === "problems"
        ? await q<Row>(`${ROW} where m.status in ('failed', 'blocked') and m.created_at > now() - interval '14 days' order by m.created_at desc limit 200`)
        : tab === "waiting"
          ? await q<Row>(`${ROW} where m.status in ('queued', 'sending') order by coalesce(m.send_after, m.created_at) limit 200`)
          : [];
  const batches = [...new Set(rows.map((r) => r.batch_id).filter(Boolean))] as string[];

  return (
    <>
      <PageHead title="Messages" sub="Texts and emails with customers and prospects">
        <Link className="btn small-btn" href="/manager/templates">Templates</Link>
      </PageHead>
      <Notice ok={sp.ok} error={sp.error} />
      <MessagingStatus />
      <nav className="tabs">
        {tabs.map(([k, label]) => (
          <Link key={k} href={k === "inbox" ? "/manager/messages" : `/manager/messages?tab=${k}`} className={k === tab ? "on" : undefined}>{label}</Link>
        ))}
      </nav>

      {tab === "inbox" && (
        <section className="stack">
          {threads.length === 0 && <Empty>No messages yet. Open a customer and choose Message to start a conversation.</Empty>}
          {threads.map((t) => (
            <Link key={t.customer_id ?? "unknown"} href={`/manager/messages/${t.customer_id ?? "unknown"}`} className={`thread-row${t.unread ? " unread" : ""}`}>
              <div className="grow">
                <strong>{t.name ?? "Unknown senders"}</strong> {t.status === "prospect" && <Badge tone="idle">prospect</Badge>}
                <div className="muted small clip">{t.last_dir === "out" ? "You: " : ""}{t.last_body}</div>
              </div>
              <div className="thread-meta small muted">
                {t.unread > 0 && <Badge tone="warn">{t.unread} new</Badge>}
                <span>{t.last_channel === "sms" ? "Text" : "Email"} · {fmtDateTime(t.last_at)}</span>
              </div>
            </Link>
          ))}
        </section>
      )}

      {tab === "approval" && (
        <section className="stack">
          {rows.length === 0 && <Empty>Nothing is waiting for your approval.</Empty>}
          {batches.map((b) => {
            const n = rows.filter((r) => r.batch_id === b).length;
            return (
              <form key={b} action={approveBatch} className="card row wrap">
                {hidden("batch_id", b)}
                {hidden("back", back)}
                <div className="grow"><strong>Group send: {rows.find((r) => r.batch_id === b)?.template ?? "message"}</strong><div className="muted small">{n} message(s) below belong to this group.</div></div>
                <button className="btn primary small-btn" name="op" value="approve">Approve all {n}</button>
                <button className="btn danger small-btn" name="op" value="discard">Discard all</button>
              </form>
            );
          })}
          {rows.map((r) => (
            <form key={r.id} action={approveMessage} className="card stack msg-approve">
              {hidden("id", r.id)}
              {hidden("back", back)}
              <div className="job-head">
                <span><strong>{r.name ?? r.to_addr}</strong> <span className="muted small">· {r.channel === "sms" ? "Text" : "Email"} to {r.to_addr}{r.template ? ` · ${r.template}` : ""}</span></span>
                <Badge tone={r.purpose === "marketing" ? "warn" : "idle"}>{r.purpose}</Badge>
              </div>
              {r.channel === "email" && <label className="field"><span>Subject</span><input name="subject" defaultValue={r.subject} /></label>}
              <label className="field"><span>Message (edit before sending if needed)</span><textarea name="body" rows={r.channel === "sms" ? 3 : 7} defaultValue={r.body} /></label>
              {r.channel === "sms" && <div className="muted small">{r.body.length} characters, about {smsSegments(r.body)} text segment(s). Your business name and opt-out wording are added automatically where the rules require them.</div>}
              <div className="btn-row tight">
                <button className="btn primary small-btn">Approve and send</button>
                <button className="btn small-btn" formAction={discardMessage}>Discard</button>
              </div>
            </form>
          ))}
        </section>
      )}

      {(tab === "problems" || tab === "waiting") && (
        <section className="stack">
          {rows.length === 0 && <Empty>{tab === "problems" ? "No failed or blocked messages in the last 14 days." : "Nothing is scheduled."}</Empty>}
          {tab === "problems" && rows.length > 0 && (
            <p className="muted small">Blocked means the messaging rules did not allow it (no consent, opted out, missing details). Failed means the provider could not deliver it.</p>
          )}
          {rows.map((r) => (
            <form key={r.id} action={retryMessage} className="card stack tight">
              {hidden("id", r.id)}
              {hidden("back", back)}
              <div className="job-head">
                <span>
                  {r.customer_id ? <Link href={`/manager/messages/${r.customer_id}`}><strong>{r.name}</strong></Link> : <strong>{r.to_addr}</strong>}
                  <span className="muted small"> · {r.channel === "sms" ? "Text" : "Email"} · {fmtDateTime(r.created_at)}{r.template ? ` · ${r.template}` : ""}</span>
                </span>
                <Badge tone={r.status === "failed" ? "bad" : r.status === "blocked" ? "warn" : "idle"}>{r.status === "queued" && r.send_after ? `sends ${fmtDateTime(r.send_after)}` : r.status}</Badge>
              </div>
              <div className="small clip2">{r.body}</div>
              {(r.block_reason || r.error) && <div className="small warn-text">{r.block_reason || r.error}</div>}
              <div className="btn-row tight">
                {tab === "problems" && <button className="btn small-btn">Try again</button>}
                <button className="btn small-btn" formAction={discardMessage}>{tab === "problems" ? "Dismiss" : "Cancel"}</button>
              </div>
            </form>
          ))}
        </section>
      )}
    </>
  );
}
