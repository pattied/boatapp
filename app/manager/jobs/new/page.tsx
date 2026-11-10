import { createJob } from "../../actions";
import { Notice, PageHead, Select, Submit } from "@/components/ui";
import { todayLA } from "@/lib/dates";
import { q } from "@/lib/db";
import { lookups } from "@/lib/repo";
import { requireManager } from "@/lib/session";

type SP = Promise<{ boat?: string; date?: string; ok?: string; error?: string }>;

export default async function NewJob({ searchParams }: { searchParams: SP }) {
  await requireManager();
  const sp = await searchParams;
  const [{ crews, services }, boats] = await Promise.all([
    lookups(),
    q<{ id: string; name: string; customer: string; marina: string | null }>(
      `select b.id, b.name, c.name as customer, m.name as marina from boats b join customers c on c.id = b.customer_id
       left join marinas m on m.id = b.marina_id where b.status <> 'sold' and c.status in ('active', 'paused') order by b.name`,
    ),
  ]);
  return (
    <>
      <PageHead title="New one-off job" sub="A single visit outside any recurring plan, such as an extra wash or a detail." />
      <Notice ok={sp.ok} error={sp.error} />
      <form action={createJob} className="card form-grid">
        <input type="hidden" name="back" value="/manager/jobs/new" />
        <Select
          label="Boat"
          name="boat_id"
          required
          blank="Choose a boat"
          defaultValue={sp.boat}
          wide
          options={boats.map((b) => ({ value: b.id, label: `${b.name} · ${b.customer}${b.marina ? ` · ${b.marina}` : ""}` }))}
        />
        <label className="field">
          <span>Date *</span>
          <input type="date" name="date" defaultValue={sp.date ?? todayLA()} required />
        </label>
        <Select label="Crew" name="crew_id" blank="No crew yet" options={crews.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))} />
        <Select label="Service" name="service_id" blank="None" options={services.map((s) => ({ value: s.id, label: `${s.name}${s.is_add_on ? " (add-on)" : ""}` }))} />
        <label className="field wide">
          <span>Notes for the technician</span>
          <textarea name="notes" rows={2} />
        </label>
        <div className="wide">
          <Submit>Create job</Submit>
        </div>
      </form>
    </>
  );
}
