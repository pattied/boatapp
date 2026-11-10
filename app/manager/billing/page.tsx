import { PageHead } from "@/components/ui";
import { todayLA } from "@/lib/dates";
import { requireManager } from "@/lib/session";

export default async function Billing() {
  await requireManager();
  const month = todayLA().slice(0, 7);
  return (
    <>
      <PageHead title="Billing export" sub="Billing happens outside this app. Export a month of visits as a spreadsheet file for your billing system." />
      <form action="/api/manager/billing" method="get" className="card row wrap">
        <label className="field">
          <span>Month</span>
          <input type="month" name="month" defaultValue={month} required />
        </label>
        <button className="btn primary">Download CSV</button>
      </form>
      <p className="muted small">
        One row per visit: date, customer, boat, service, status (done, partial, skipped or cancelled), origin (plan, request or one-off),
        crew and notes. Filter to done and partial rows to bill.
      </p>
    </>
  );
}
