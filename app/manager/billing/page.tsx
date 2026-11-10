import { PageHead } from "@/components/ui";
import { todayLA } from "@/lib/dates";
import { requireManager } from "@/lib/session";

export default async function Exports() {
  await requireManager();
  const month = todayLA().slice(0, 7);
  return (
    <>
      <PageHead title="Exports" sub="Download your data as spreadsheet files (CSV). They open in Excel, Numbers and Google Sheets." />
      <section className="card stack">
        <h2>Visits for billing</h2>
        <form action="/api/manager/billing" method="get" className="row wrap">
          <label className="field">
            <span>Month</span>
            <input type="month" name="month" defaultValue={month} required />
          </label>
          <button className="btn primary">Download visits</button>
        </form>
        <p className="muted small">
          One row per visit: date, customer, boat, service, status, origin, crew and notes. Billing happens outside this app.
        </p>
      </section>
      <section className="card stack">
        <h2>Contacts and mailing list</h2>
        <p className="muted small">
          One row per customer or prospect: name, phone, email, mailing address, boats and marina, contact preference,
          and exactly what each person has agreed to. Use the address columns for a mail merge.
        </p>
        <div className="btn-row">
          <a className="btn primary" href="/api/manager/export?what=contacts">Everyone</a>
          <a className="btn" href="/api/manager/export?what=contacts&who=customers">Customers only</a>
          <a className="btn" href="/api/manager/export?what=contacts&who=prospects">Prospects only</a>
          <a className="btn" href="/api/manager/export?what=contacts&who=mailable">Only people with a mailing address</a>
        </div>
      </section>
      <section className="card stack">
        <h2>Message records</h2>
        <p className="muted small">
          Keep these. If a customer or a carrier ever questions a message, the consent record shows who agreed to what, when and how,
          and the message log shows everything sent and received.
        </p>
        <div className="btn-row">
          <a className="btn" href="/api/manager/export?what=messages">All messages</a>
          <a className="btn" href="/api/manager/export?what=consent">Consent and opt-out record</a>
          <a className="btn" href="/api/manager/export?what=suppressions">Do-not-contact list</a>
        </div>
      </section>
    </>
  );
}
