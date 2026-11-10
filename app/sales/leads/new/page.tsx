import { newLead } from "../../actions";
import LeadShell from "@/components/sales/LeadShell";
import { todayLA } from "@/lib/dates";
import { one } from "@/lib/db";
import { isUuid } from "@/lib/ids";
import { MARKETING_SMS_WORDING, SERVICE_SMS_WORDING } from "@/lib/messaging/compliance";
import { BERTH_TYPES } from "@/lib/repo";
import { LEAD_SOURCES, places, SPOTTED_SELECT, type Spotted } from "@/lib/sales";
import { requireSales } from "@/lib/session";

type SP = Promise<{ boat?: string }>;

// A full lead: the same details a customer record holds, so nothing has to be asked twice later.
export default async function NewLead({ searchParams }: { searchParams: SP }) {
  await requireSales();
  const sp = await searchParams;
  const spotted = isUuid(sp.boat ?? "") ? await one<Spotted>(`${SPOTTED_SELECT} where s.id = $1 and s.customer_id is null`, [sp.boat]) : null;
  const { marinas, docks } = await places();
  const today = todayLA();
  return (
    <>
      <header className="top">
        <h1>New lead</h1>
        <p className="muted small">{spotted ? `Owner of ${spotted.boat_name || "the boat"} in slip ${spotted.slip || "?"} at ${spotted.marina_name}.` : "For a phone call, a walk-up or a referral. Only the name and one way to reach them are required."}</p>
      </header>
      <LeadShell action={newLead}>
        {spotted && <input type="hidden" name="spotted_id" value={spotted.id} />}
        <section className="card stack">
          <h2>Person</h2>
          <label className="field"><span>Name *</span><input name="name" required maxLength={100} autoComplete="off" /></label>
          <div className="two">
            <label className="field"><span>Mobile phone</span><input name="phone" type="tel" maxLength={30} autoComplete="off" /></label>
            <label className="field"><span>Email</span><input name="email" type="email" maxLength={120} autoComplete="off" /></label>
          </div>
          <div className="two">
            <label className="field">
              <span>How they reached us</span>
              <select name="source" defaultValue={spotted ? "Dock walk" : "Phone call"}>
                {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="field"><span>Interested in</span><input name="interest" maxLength={200} placeholder="Wash every 2 weeks" /></label>
          </div>
        </section>

        <section className="card stack">
          <h2>Boat and where it is kept</h2>
          <div className="two">
            <label className="field"><span>Boat name</span><input name="boat_name" maxLength={80} defaultValue={spotted?.boat_name ?? ""} /></label>
            <label className="field"><span>Make and model</span><input name="make_model" maxLength={80} defaultValue={spotted?.make_model ?? ""} /></label>
          </div>
          <div className="two">
            <label className="field"><span>Length (ft)</span><input name="length_ft" inputMode="numeric" maxLength={3} defaultValue={spotted?.length_ft ?? ""} /></label>
            <label className="field"><span>Hull color</span><input name="hull_color" maxLength={40} /></label>
          </div>
          <label className="field">
            <span>Marina</span>
            <select name="marina_id" defaultValue={spotted?.marina_id ?? ""}>
              <option value="">Not known</option>
              {marinas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <div className="two">
            <label className="field">
              <span>Dock</span>
              <select name="dock_id" defaultValue={spotted?.dock_id ?? ""}>
                <option value="">Not known</option>
                {marinas.map((m) => (
                  <optgroup key={m.id} label={m.name}>
                    {docks.filter((d) => d.marina_id === m.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="field"><span>Slip</span><input name="slip" maxLength={20} defaultValue={spotted?.slip ?? ""} /></label>
          </div>
          <label className="field">
            <span>Berth</span>
            <select name="berth_type" defaultValue="slip">
              {BERTH_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="field"><span>Access notes</span><textarea name="access_notes" rows={2} maxLength={500} placeholder="Locked gate, dock box on the port side" /></label>
          <label className="check"><input type="checkbox" name="liveaboard" /> <span>Someone lives aboard</span></label>
          <p className="muted small">If the marina is not listed, add it under Walk a dock first.</p>
        </section>

        <section className="card stack">
          <h2>Mailing address</h2>
          <label className="field"><span>Street address</span><input name="address1" maxLength={120} autoComplete="off" /></label>
          <label className="field"><span>Apartment, suite or PO box</span><input name="address2" maxLength={120} autoComplete="off" /></label>
          <div className="two">
            <label className="field"><span>City</span><input name="city" maxLength={80} autoComplete="off" /></label>
            <label className="field"><span>State</span><input name="state" maxLength={20} placeholder="CA" autoComplete="off" /></label>
          </div>
          <label className="field"><span>ZIP</span><input name="postal_code" maxLength={12} inputMode="numeric" autoComplete="off" /></label>
        </section>

        <section className="card stack">
          <h2>What they told you</h2>
          <label className="field"><span>Note</span><textarea name="note" rows={3} maxLength={2000} placeholder="Racing in the Midwinters on the 21st and wants the boat spotless. Family visiting at Thanksgiving." /></label>
          <label className="field"><span>Boat must be clean by (optional)</span><input type="date" name="needed_by" min={today} /></label>
        </section>

        <section className="card stack">
          <h2>Permission to text</h2>
          <p className="muted small">Having a number is not permission to text it. Tick a box only if they agreed, and say how. Without it we can still call, email or mail them.</p>
          <label className="check"><input type="checkbox" name="sms_consent" /> <span className="small">They agreed to texts about service. <span className="muted">Read them this: {SERVICE_SMS_WORDING}</span></span></label>
          <label className="check"><input type="checkbox" name="promo_sms_consent" /> <span className="small">They agreed to marketing texts. <span className="muted">{MARKETING_SMS_WORDING}</span></span></label>
          <label className="check"><input type="checkbox" name="promo_written" /> <span className="small">I have their marketing consent in writing (a signed card, a form, or a text or email from them).</span></label>
          <label className="field"><span>How and when they agreed</span><input name="consent_method" maxLength={200} placeholder="Asked on the phone today to get reminders by text" /></label>
        </section>
        <label className="check"><input type="checkbox" name="allow_duplicate" /> <span>Add anyway if this phone or email is already on file</span></label>
      </LeadShell>
    </>
  );
}
