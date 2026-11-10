import Link from "next/link";
import { notFound } from "next/navigation";
import { updateLead } from "../../actions";
import NotesCard from "@/components/NotesCard";
import { Badge, Notice } from "@/components/ui";
import { fmtDateTime, todayLA } from "@/lib/dates";
import { one, q } from "@/lib/db";
import { isUuid } from "@/lib/ids";
import { notesFor } from "@/lib/notes";
import { locationText } from "@/lib/repo";
import { requireSales } from "@/lib/session";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

export default async function Lead({ params, searchParams }: Props) {
  const user = await requireSales();
  const { id } = await params;
  const sp = await searchParams;
  const c = isUuid(id)
    ? await one<{ id: string; name: string; phone: string; email: string; status: string; interest: string; source: string; created_at: string; address1: string; address2: string; city: string; state: string; postal_code: string; sms_consent: boolean; promo_sms_consent: boolean; sms_opted_out_at: string | null }>(
        "select id, name, phone, email, status, interest, source, created_at, address1, address2, city, state, postal_code, sms_consent, promo_sms_consent, sms_opted_out_at from customers where id = $1",
        [id],
      )
    : null;
  if (!c) notFound();
  // Sales people work with leads. Once someone is a customer their record belongs to the manager's side.
  if (c.status !== "prospect" && !user.manager) {
    return (
      <>
        <header className="top"><h1>{c.name}</h1></header>
        <p className="notice good">{c.name} is now a customer. A manager looks after their record from here.</p>
        <Link href="/sales/leads" className="btn">Back to leads</Link>
      </>
    );
  }
  const [boats, notes] = await Promise.all([
    q<{ id: string; name: string; make_model: string; length_ft: number | null; marina_name: string | null; dock_name: string | null; slip: string; berth_type: string }>(
      `select b.id, b.name, b.make_model, b.length_ft, m.name as marina_name, d.name as dock_name, b.slip, b.berth_type
       from boats b left join marinas m on m.id = b.marina_id left join docks d on d.id = b.dock_id where b.customer_id = $1 order by b.created_at`,
      [id],
    ),
    notesFor(id),
  ]);
  const back = `/sales/leads/${id}`;
  return (
    <>
      <header className="top">
        <div className="eyebrow">Lead</div>
        <h1>{c.name}</h1>
        <p className="muted small">{c.source} · added {fmtDateTime(c.created_at)}{c.interest ? ` · wants: ${c.interest}` : ""}</p>
      </header>
      <Notice ok={sp.ok} error={sp.error} />
      {user.manager && <Link href={`/manager/customers/${id}`} className="btn">Open in the manager view (convert, message, add a plan)</Link>}
      <div className="btn-row">
        {c.phone && <a className="btn primary" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>Call {c.phone}</a>}
        {c.email && <a className="btn" href={`mailto:${c.email}`}>Email</a>}
      </div>
      <div className="small">
        Texts about service: <Badge tone={c.sms_consent && !c.sms_opted_out_at ? "good" : "idle"}>{c.sms_opted_out_at ? "opted out" : c.sms_consent ? "agreed" : "no permission"}</Badge>{" "}
        Marketing texts: <Badge tone={c.promo_sms_consent && !c.sms_opted_out_at ? "good" : "idle"}>{c.promo_sms_consent && !c.sms_opted_out_at ? "agreed" : "no permission"}</Badge>
      </div>

      <NotesCard customerId={id} notes={notes} boats={boats} back={back} today={todayLA()} />

      <section className="card stack">
        <h2>Boats</h2>
        {boats.length === 0 && <p className="muted small">No boat on file yet.</p>}
        {boats.map((b) => (
          <div key={b.id}>
            <strong>{b.name}</strong> <span className="muted small">{[b.make_model, b.length_ft ? `${b.length_ft} ft` : ""].filter(Boolean).join(" · ")}</span>
            <div className="muted small">{locationText({ ...b, gate_name: null })}</div>
          </div>
        ))}
      </section>

      <form action={updateLead} className="card stack">
        <h2>Contact details</h2>
        <input type="hidden" name="id" value={id} />
        <label className="field"><span>Name *</span><input name="name" required defaultValue={c.name} maxLength={100} /></label>
        <div className="two">
          <label className="field"><span>Mobile phone</span><input name="phone" type="tel" defaultValue={c.phone} maxLength={30} /></label>
          <label className="field"><span>Email</span><input name="email" type="email" defaultValue={c.email} maxLength={120} /></label>
        </div>
        <label className="field"><span>Interested in</span><input name="interest" defaultValue={c.interest} maxLength={200} /></label>
        <label className="field"><span>Street address</span><input name="address1" defaultValue={c.address1} maxLength={120} /></label>
        <label className="field"><span>Apartment, suite or PO box</span><input name="address2" defaultValue={c.address2} maxLength={120} /></label>
        <div className="two">
          <label className="field"><span>City</span><input name="city" defaultValue={c.city} maxLength={80} /></label>
          <label className="field"><span>State</span><input name="state" defaultValue={c.state} maxLength={20} /></label>
        </div>
        <label className="field"><span>ZIP</span><input name="postal_code" defaultValue={c.postal_code} maxLength={12} /></label>
        <button className="btn primary">Save</button>
        <p className="muted small">Changing the phone number clears text permission, because permission belongs to the number it was given for.</p>
      </form>
    </>
  );
}
