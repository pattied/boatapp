import Link from "next/link";
import { signUp } from "../portal/actions";
import SignupShell from "@/components/SignupShell";
import { Select } from "@/components/ui";
import { getConfig } from "@/lib/config";
import { q } from "@/lib/db";
import { MARKETING_SMS_WORDING, SERVICE_SMS_WORDING } from "@/lib/messaging/compliance";
import { BERTH_TYPES } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign up for boat cleaning" };

// Public sign-up. Gate codes are never shown here: only names.
export default async function SignUp() {
  const { businessName } = getConfig();
  const [marinas, gates, docks, services] = await Promise.all([
    q<{ id: string; name: string }>("select id, name from marinas order by name"),
    q<{ id: string; name: string; marina: string }>("select g.id, g.name, m.name as marina from gates g join marinas m on m.id = g.marina_id order by m.name, g.name"),
    q<{ id: string; name: string; marina: string }>("select d.id, d.name, m.name as marina from docks d join marinas m on m.id = d.marina_id order by m.name, d.name"),
    q<{ id: string; name: string; price_text: string }>("select id, name, price_text from services where active and not is_add_on order by sort, name"),
  ]);

  return (
    <main className="page signup">
      <header className="top">
        <div className="eyebrow">{businessName} · Customer</div>
        <h1>Sign up for cleanings</h1>
        <p className="muted small">Tell us about you and your boat. We review every sign-up and confirm your first cleaning.</p>
      </header>
      {marinas.length === 0 ? (
        <p className="notice warn">Online sign-up isn&apos;t open yet. Please call or text us.</p>
      ) : (
        <SignupShell action={signUp}>
          <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hp" aria-hidden="true" />
          <section className="card stack">
            <h2>You</h2>
<div className="two">
            <label className="field"><span>First name *</span><input name="first_name" required maxLength={50} autoComplete="given-name" /></label>
            <label className="field"><span>Last name *</span><input name="last_name" required maxLength={50} autoComplete="family-name" /></label>
          </div>
            <label className="field"><span>Mobile phone *</span><input name="phone" type="tel" required autoComplete="tel" /></label>
            <label className="field"><span>Email</span><input name="email" type="email" autoComplete="email" /></label>
            <details>
              <summary className="small">Add a mailing address (optional)</summary>
              <div className="stack">
                <label className="field"><span>Street address</span><input name="address1" autoComplete="address-line1" /></label>
                <label className="field"><span>Apartment, suite or PO box</span><input name="address2" autoComplete="address-line2" /></label>
                <div className="two">
                  <label className="field"><span>City</span><input name="city" autoComplete="address-level2" /></label>
                  <label className="field"><span>State</span><input name="state" autoComplete="address-level1" maxLength={20} /></label>
                </div>
                <label className="field"><span>ZIP</span><input name="postal_code" autoComplete="postal-code" inputMode="numeric" /></label>
              </div>
            </details>
          </section>

          <section className="card stack">
            <h2>Your boat</h2>
            <label className="field"><span>Boat name *</span><input name="boat_name" required /></label>
            <label className="field"><span>Make and model</span><input name="make_model" placeholder="Beneteau Oceanis 38" /></label>
            <div className="two">
              <label className="field"><span>Length (ft)</span><input name="length_ft" inputMode="numeric" pattern="\d*" /></label>
              <label className="field"><span>Hull color</span><input name="hull_color" /></label>
            </div>
          </section>

          <section className="card stack">
            <h2>Where it&apos;s berthed</h2>
            <p className="muted small">Our crews need the marina, gate, dock and slip to find your boat.</p>
            <Select label="Marina" name="marina_id" required blank="Choose…" options={marinas.map((m) => ({ value: m.id, label: m.name }))} />
            {gates.length > 0 && (
              <Select label="Gate" name="gate_id" blank="Not sure" options={gates.map((g) => ({ value: g.id, label: g.name, group: g.marina }))} />
            )}
            {docks.length > 0 && (
              <Select label="Dock" name="dock_id" required blank="Choose…" options={docks.map((d) => ({ value: d.id, label: d.name, group: d.marina }))} />
            )}
            <div className="two">
              <Select label="Berth" name="berth_type" defaultValue="slip" options={BERTH_TYPES.map(([v, l]) => ({ value: v, label: l }))} />
              <label className="field"><span>Slip</span><input name="slip" placeholder="B-14" /></label>
            </div>
            <label className="field">
              <span>Access notes</span>
              <textarea name="access_notes" rows={2} placeholder="Gate code changes monthly, cover snaps on port side" />
            </label>
            <label className="check"><input type="checkbox" name="liveaboard" /><span>Someone lives aboard</span></label>
          </section>

          <section className="card stack">
            <h2>Cleaning plan</h2>
            {services.length > 0 && (
              <Select label="Service" name="service_id" options={services.map((s) => ({ value: s.id, label: s.price_text ? `${s.name} · ${s.price_text}` : s.name }))} />
            )}
            <div className="two">
              <Select
                label="How often"
                name="frequency"
                defaultValue="2"
                options={[["1", "Every week"], ["2", "Every 2 weeks"], ["3", "Every 3 weeks"], ["4", "Every 4 weeks"], ["8", "Every 8 weeks"]].map(([v, l]) => ({ value: v, label: l }))}
              />
              <Select
                label="Preferred day"
                name="weekday"
                blank="Any day"
                options={["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d) => ({ value: d, label: d }))}
              />
            </div>
          </section>

          <section className="card stack">
            <h2>How should we reach you?</h2>
            <label className="field">
              <span>Reminders, confirmations and photo links</span>
              <select name="contact_pref" defaultValue="text">
                <option value="text">Text me</option>
                <option value="email">Email me</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" name="sms_consent" />
              <span className="small">{SERVICE_SMS_WORDING}</span>
            </label>
            <label className="check">
              <input type="checkbox" name="promo_sms_consent" />
              <span className="small">{MARKETING_SMS_WORDING}</span>
            </label>
            <p className="muted small">
              Both boxes are optional. If you leave the first one empty we will email you instead, so please add your email above.
              See our <Link href="/sms-terms">text messaging terms and privacy</Link>.
            </p>
            <label className="check">
              <input type="checkbox" name="marketing_consent" />
              <span className="small">You may feature photos of my boat on social media.</span>
            </label>
          </section>

        </SignupShell>
      )}
      <Link href="/customer" className="manager-link">Back</Link>
    </main>
  );
}
