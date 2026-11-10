import { createService, updateService } from "../actions";
import { Check, Field, Notice, PageHead, Submit } from "@/components/ui";
import { q } from "@/lib/db";
import { requireManager } from "@/lib/session";

type SP = Promise<{ ok?: string; error?: string }>;

export default async function Services({ searchParams }: { searchParams: SP }) {
  await requireManager();
  const sp = await searchParams;
  const services = await q<{ id: string; name: string; description: string; is_add_on: boolean; price_text: string; shot_list: string[]; active: boolean }>(
    "select * from services order by active desc, sort, name",
  );
  const back = "/manager/services";
  return (
    <>
      <PageHead title="Services" sub="Regular services go on plans. Add-ons are what customers can order from their portal. The shot list sets the photos technicians must take." />
      <Notice ok={sp.ok} error={sp.error} />
      {services.map((s) => (
        <form key={s.id} action={updateService} className="card form-grid">
          <input type="hidden" name="id" value={s.id} />
          <input type="hidden" name="back" value={back} />
          <Field label="Name" name="name" defaultValue={s.name} />
          <Field label="Price shown to customers" name="price_text" defaultValue={s.price_text} placeholder="from $150 or Quote required" />
          <Field label="Description" name="description" defaultValue={s.description} wide />
          <Field label="Shot list (comma separated)" name="shot_list" defaultValue={s.shot_list.join(", ")} wide />
          <div className="wide checks">
            <Check label="Add-on customers can order" name="is_add_on" defaultChecked={s.is_add_on} />
            <Check label="Active" name="active" defaultChecked={s.active} />
          </div>
          <div className="wide"><Submit tone="plain">Save</Submit></div>
        </form>
      ))}
      <form action={createService} className="card form-grid">
        <input type="hidden" name="back" value={back} />
        <h2 className="wide">Add a service</h2>
        <Field label="Name" name="name" required />
        <Field label="Price shown to customers" name="price_text" />
        <Field label="Description" name="description" wide />
        <Field label="Shot list (comma separated)" name="shot_list" defaultValue="Bow, Stern, Cockpit, Port side" wide />
        <div className="wide checks"><Check label="Add-on customers can order" name="is_add_on" /></div>
        <div className="wide"><Submit>Add service</Submit></div>
      </form>
    </>
  );
}
