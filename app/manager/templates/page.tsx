import Link from "next/link";
import { saveTemplate } from "../messaging-actions";
import MessagingStatus from "@/components/MessagingStatus";
import { Badge, Notice, PageHead } from "@/components/ui";
import { q } from "@/lib/db";
import { requireManager } from "@/lib/session";

type SP = Promise<{ ok?: string; error?: string }>;

export default async function Templates({ searchParams }: { searchParams: SP }) {
  await requireManager();
  const sp = await searchParams;
  const rows = await q<{ id: string; key: string | null; name: string; purpose: string; sms_body: string; email_body: string; auto_send: boolean; active: boolean }>(
    "select id, key, name, purpose, sms_body, email_body, auto_send, active from message_templates order by key is null, sort, name",
  );
  const system = rows.filter((r) => r.key);
  const own = rows.filter((r) => !r.key);
  const line = (r: (typeof rows)[number]) => (
    <Link key={r.id} href={`/manager/templates/${r.id}`} className="thread-row">
      <div className="grow">
        <strong>{r.name}</strong>
        <div className="muted small clip">{r.sms_body || r.email_body}</div>
      </div>
      <div className="thread-meta small">
        {!r.active && <Badge tone="idle">off</Badge>}
        {r.active && <Badge tone={r.auto_send ? "good" : "warn"}>{r.auto_send ? "sends automatically" : "needs your approval"}</Badge>}
        {r.purpose === "marketing" && <Badge tone="warn">marketing</Badge>}
      </div>
    </Link>
  );
  return (
    <>
      <PageHead title="Templates" sub="Wording for automatic messages and for messages you send yourself">
        <Link className="btn small-btn" href="/manager/messages">Messages</Link>
      </PageHead>
      <Notice ok={sp.ok} error={sp.error} />
      <MessagingStatus />
      <section className="stack">
        <h2>Automatic messages</h2>
        <p className="muted small">Each one is tied to an event. Edit the wording, switch it to need your approval, or turn it off.</p>
        {system.map(line)}
      </section>
      <section className="stack">
        <h2>Your templates</h2>
        {own.length === 0 && <p className="muted small">None yet. Create one below, then send it to one person from a conversation or to a group from the template&apos;s page.</p>}
        {own.map(line)}
        <form action={saveTemplate} className="card stack">
          <h3>New template</h3>
          <input type="hidden" name="back" value="/manager/templates" />
          <div className="row wrap">
            <label className="field grow"><span>Name *</span><input name="name" required maxLength={80} placeholder="Haul-out season reminder" /></label>
            <label className="field">
              <span>Kind</span>
              <select name="purpose" defaultValue="service">
                <option value="service">About the customer&apos;s service</option>
                <option value="marketing">Marketing (offers, promotions)</option>
              </select>
            </label>
          </div>
          <label className="field"><span>Text wording</span><textarea name="sms_body" rows={2} maxLength={600} /></label>
          <label className="field"><span>Email subject</span><input name="email_subject" maxLength={150} /></label>
          <label className="field"><span>Email wording</span><textarea name="email_body" rows={4} maxLength={5000} /></label>
          <p className="muted small">New templates always wait for your approval before sending. Fields like {"{first_name}"} and {"{boat}"} are listed on the template&apos;s page.</p>
          <button className="btn primary">Create template</button>
        </form>
      </section>
    </>
  );
}
