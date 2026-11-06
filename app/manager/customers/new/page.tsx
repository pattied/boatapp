import Link from "next/link";
import { createCustomer } from "../../actions";
import { BoatFields, PlanFields } from "@/components/BoatPlanFields";
import { Check, Field, Notice, PageHead, Submit } from "@/components/ui";
import { lookups } from "@/lib/repo";

type SP = Promise<{ ok?: string; error?: string }>;

export default async function NewCustomer({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const l = await lookups();
  return (
    <>
      <PageHead title="New customer" sub="Customer, their boat and its cleaning plan in one step." />
      <Notice ok={sp.ok} error={sp.error} />
      {l.marinas.length === 0 && (
        <p className="notice warn">
          Add a marina with its gates and docks first: <Link href="/manager/marinas">Marinas</Link>.
        </p>
      )}
      <form action={createCustomer} className="stack">
        <input type="hidden" name="back" value="/manager/customers/new" />
        <section className="card form-grid">
          <h2 className="wide">Customer</h2>
          <Field label="Name" name="name" required />
          <Field label="Mobile phone" name="phone" type="tel" />
          <Field label="Email" name="email" type="email" />
          <label className="field wide">
            <span>Internal notes (not shown to the customer)</span>
            <textarea name="notes" rows={2} />
          </label>
          <div className="wide checks">
            <Check label="Customer agreed to marketing use of photos" name="marketing_consent" />
            <Check label="Create anyway if the phone matches another customer" name="allow_duplicate" />
          </div>
        </section>
        <section className="card form-grid">
          <h2 className="wide">Boat</h2>
          <BoatFields l={l} />
        </section>
        <section className="card form-grid">
          <h2 className="wide">Cleaning plan</h2>
          <p className="wide muted small">Leave &quot;How often&quot; blank to add the customer without a recurring plan.</p>
          <PlanFields l={l} optional />
        </section>
        <div>
          <Submit>Save customer and schedule visits</Submit>
        </div>
      </form>
    </>
  );
}
