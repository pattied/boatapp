import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteTemplate, queueGroup, saveTemplate } from "../../messaging-actions";
import MessagingStatus from "@/components/MessagingStatus";
import { DeleteForm, Notice, PageHead } from "@/components/ui";
import { getConfig } from "@/lib/config";
import { q } from "@/lib/db";
import { isUuid } from "@/lib/ids";
import { finishSms } from "@/lib/messaging/compliance";
import { getTemplate } from "@/lib/messaging/send";
import { MERGE_FIELDS, render, smsSegments } from "@/lib/messaging/templates";
import { requireManager } from "@/lib/session";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

const SAMPLE = { first_name: "Dana", name: "Dana Whitfield", boat: "Sea Breeze", date: "Thursday, November 12", service: "Exterior wash", link: "https://example.com/…", message: "She looks great.", reason: "Boat not in slip" };

export default async function TemplateDetail({ params, searchParams }: Props) {
  await requireManager();
  const { id } = await params;
  const sp = await searchParams;
  const t = isUuid(id) ? await getTemplate(id) : null;
  if (!t) notFound();
  const { businessName } = getConfig();
  const back = `/manager/templates/${id}`;
  const vars = { ...SAMPLE, business: businessName };
  const smsPreview = t.sms_body ? finishSms(render(t.sms_body, vars), { business: businessName, purpose: t.purpose, firstToNumber: false }) : "";
  const [marinas, counts] = await Promise.all([
    q<{ id: string; name: string }>("select id, name from marinas order by name"),
    q<{ status: string; n: number }>("select status, count(*)::int as n from customers where status in ('active', 'paused', 'prospect', 'lead') group by status"),
  ]);
  const n = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;

  return (
    <>
      <PageHead title={t.name} sub={t.key ? "Automatic message" : t.purpose === "marketing" ? "Your template · marketing" : "Your template"}>
        <Link className="btn small-btn" href="/manager/templates">All templates</Link>
      </PageHead>
      <Notice ok={sp.ok} error={sp.error} />
      <MessagingStatus />

      <div className="two-col">
        <form action={saveTemplate} className="card stack">
          <input type="hidden" name="id" value={t.id} />
          <input type="hidden" name="back" value={back} />
          <label className="field"><span>Name *</span><input name="name" required maxLength={80} defaultValue={t.name} /></label>
          {!t.key && (
            <label className="field">
              <span>Kind</span>
              <select name="purpose" defaultValue={t.purpose}>
                <option value="service">About the customer&apos;s service</option>
                <option value="marketing">Marketing (offers, promotions)</option>
              </select>
            </label>
          )}
          <label className="field"><span>Text wording</span><textarea name="sms_body" rows={3} maxLength={600} defaultValue={t.sms_body} /></label>
          <label className="field"><span>Email subject</span><input name="email_subject" maxLength={150} defaultValue={t.email_subject} /></label>
          <label className="field"><span>Email wording</span><textarea name="email_body" rows={7} maxLength={5000} defaultValue={t.email_body} /></label>
          <label className="check"><input type="checkbox" name="auto_send" defaultChecked={t.auto_send} /> <span>Send automatically. Untick to approve each message first.</span></label>
          <label className="check"><input type="checkbox" name="active" defaultChecked={t.active} /> <span>Turned on</span></label>
          <button className="btn primary">Save template</button>
        </form>

        <div className="stack">
          <section className="card stack">
            <h2>Preview</h2>
            {smsPreview ? (
              <>
                <div className="bubble out sent"><div className="bubble-body">{smsPreview}</div></div>
                <div className="muted small">{smsPreview.length} characters, about {smsSegments(smsPreview)} text segment(s). Texts are billed per segment.{t.purpose === "marketing" ? " “Reply STOP to opt out” is added to every marketing text." : " Opt-out wording is added to the first text each number receives."}</div>
              </>
            ) : <p className="muted small">No text wording. Customers who prefer texts get the email instead.</p>}
            {t.email_body ? (
              <div className="email-preview">
                <div className="small"><strong>{render(t.email_subject, vars)}</strong></div>
                <div className="bubble-body small">{render(t.email_body, vars)}</div>
                <div className="muted small">Footer: {businessName}, your postal address{t.purpose === "marketing" ? ", and an unsubscribe link" : ""}.</div>
              </div>
            ) : <p className="muted small">No email wording. Customers who prefer email get the text if they agreed to texts.</p>}
          </section>
          <section className="card stack">
            <h2>Fields you can use</h2>
            <ul className="plain-list small">
              {MERGE_FIELDS.map(([f, d]) => <li key={f}><code>{f}</code> {d}</li>)}
            </ul>
          </section>
        </div>
      </div>

      {t.active && (
        <section className="card stack">
          <h2>Send to a group</h2>
          <p className="muted small">
            This prepares one message per person and puts them all in Waiting for approval. Nothing is sent until you approve.
            Each person gets it by text or email according to their preference and what they have agreed to. People the rules
            do not allow are skipped and listed under Problems with the reason.
            {t.purpose === "marketing" ? " Marketing texts go only to people with written consent on record." : ""}
          </p>
          <form action={queueGroup} className="row wrap">
            <input type="hidden" name="template_id" value={t.id} />
            <input type="hidden" name="back" value={back} />
            <label className="field">
              <span>Who</span>
              <select name="audience" defaultValue="">
                <option value="" disabled>Choose…</option>
                <option value="active">Active customers ({n("active")})</option>
                <option value="prospects">Prospects and active leads ({n("prospect") + n("lead")})</option>
                <option value="leads">Active leads only ({n("lead")})</option>
                <option value="all">Customers, prospects and leads ({n("active") + n("paused") + n("prospect") + n("lead")})</option>
                <option value="marina">Customers at one marina</option>
              </select>
            </label>
            <label className="field">
              <span>Marina (if chosen above)</span>
              <select name="marina_id" defaultValue="">
                <option value="">Any</option>
                {marinas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <button className="btn primary">Prepare for approval</button>
          </form>
        </section>
      )}

      {!t.key && (
        <details className="danger-zone">
          <summary>Delete this template</summary>
          <DeleteForm action={deleteTemplate} id={t.id} back={back} label="Delete template" warning="Messages already sent with it stay in each conversation." />
        </details>
      )}
    </>
  );
}
