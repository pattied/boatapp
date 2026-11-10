import Link from "next/link";
import { createProspect } from "../../messaging-actions";
import { Notice, PageHead } from "@/components/ui";
import { MARKETING_SMS_WORDING, SERVICE_SMS_WORDING } from "@/lib/messaging/compliance";
import { requireManager } from "@/lib/session";

type SP = Promise<{ ok?: string; error?: string }>;

// A prospect is someone whose details you have but who has not booked. No boat or plan is needed.
export default async function NewProspect({ searchParams }: { searchParams: SP }) {
  await requireManager();
  const sp = await searchParams;
  return (
    <>
      <PageHead title="New prospect" sub="Someone who has not done business with you yet">
        <Link className="btn small-btn" href="/manager/customers?status=prospect">All prospects</Link>
      </PageHead>
      <Notice ok={sp.ok} error={sp.error} />
      <form action={createProspect} className="stack">
        <section className="card form-grid">
          <label className="field"><span>Name *</span><input name="name" required maxLength={100} /></label>
          <label className="field"><span>Mobile phone</span><input name="phone" type="tel" maxLength={30} /></label>
          <label className="field"><span>Email</span><input name="email" type="email" maxLength={120} /></label>
          <label className="field"><span>Where they came from</span><input name="source" maxLength={60} placeholder="Boat show, referral from Dana, dock walk" /></label>
          <label className="field wide"><span>Interested in</span><input name="interest" maxLength={200} placeholder="Monthly wash for a 38 ft sloop at Clipper" /></label>
          <label className="field wide"><span>Notes</span><textarea name="notes" rows={2} maxLength={1000} /></label>
        </section>
        <section className="card form-grid">
          <h2 className="wide">Mailing address</h2>
          <label className="field wide"><span>Street address</span><input name="address1" maxLength={120} autoComplete="off" /></label>
          <label className="field wide"><span>Apartment, suite, slip or PO box</span><input name="address2" maxLength={120} /></label>
          <label className="field"><span>City</span><input name="city" maxLength={80} /></label>
          <label className="field"><span>State</span><input name="state" maxLength={20} placeholder="CA" /></label>
          <label className="field"><span>ZIP</span><input name="postal_code" maxLength={12} /></label>
        </section>
        <section className="card stack">
          <h2>Permission to text</h2>
          <p className="muted small">
            Having someone&apos;s number is not permission to text them. Tick a box only if this person agreed, and say how.
            Without it you can still email them, mail them, or call them yourself.
          </p>
          <label className="check"><input type="checkbox" name="sms_consent" /> <span className="small">They agreed to texts about service. <span className="muted">Wording: {SERVICE_SMS_WORDING}</span></span></label>
          <label className="check"><input type="checkbox" name="promo_sms_consent" /> <span className="small">They agreed to marketing texts. <span className="muted">Wording: {MARKETING_SMS_WORDING}</span></span></label>
          <label className="check"><input type="checkbox" name="promo_written" /> <span className="small">I have their marketing consent in writing (a signed form, a web form, or a text or email from them) and can produce it.</span></label>
          <label className="field"><span>How and when they agreed</span><input name="consent_method" maxLength={200} placeholder="Signed interest card at the Sausalito boat show, Nov 8" /></label>
        </section>
        <label className="check"><input type="checkbox" name="allow_duplicate" /> <span>Add anyway if the phone or email is already on file</span></label>
        <button className="btn primary">Save prospect</button>
      </form>
    </>
  );
}
