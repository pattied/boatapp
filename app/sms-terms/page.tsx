import Link from "next/link";
import { getConfig } from "@/lib/config";
import { messagingStatus } from "@/lib/messaging/providers";

export const metadata = { title: "Text messaging terms and privacy" };

// Public page. Mobile carriers ask for this page when a business registers to send texts.
export default function SmsTerms() {
  const { businessName } = getConfig();
  const s = messagingStatus();
  return (
    <main className="page">
      <header className="top">
        <div className="eyebrow">{businessName}</div>
        <h1>Text messaging terms and privacy</h1>
      </header>
      <section className="card stack">
        <h2>What we send</h2>
        <p>If you agree to texts, {businessName} sends messages about your boat cleaning service: reminders the day before a visit, confirmations, notices when a visit is finished with a link to your before and after photos, and replies to your questions.</p>
        <p>If you separately agree to marketing texts, we may also send occasional offers and seasonal reminders. Agreeing to marketing texts is optional and is never a condition of buying anything from us.</p>
        <h2>How often</h2>
        <p>Message frequency varies with your cleaning schedule. Most customers get a few messages per visit.</p>
        <h2>Cost</h2>
        <p>We do not charge for texts. Message and data rates from your mobile carrier may apply.</p>
        <h2>How to stop or get help</h2>
        <p>Reply <strong>STOP</strong> to any text to stop all texts from us. You will get one message confirming it. Reply <strong>START</strong> to turn them back on. Reply <strong>HELP</strong> for help{s.helpContact ? `, or contact us at ${s.helpContact}` : ""}. You can also change your choices on your private boat page, or tell any of our staff.</p>
        <h2>Privacy</h2>
        <p>We use your mobile number and email address only to provide and communicate about our service. We do not sell or rent them, and we do not share your mobile number or your consent to receive texts with third parties or affiliates for their marketing. We share details only with the companies that deliver our messages and host our systems, and only so they can do that work.</p>
        <p>We keep a record of the messages we exchange with you and of what you agreed to, so we can serve you and show we followed the rules.</p>
        <h2>Carriers</h2>
        <p>Mobile carriers are not liable for delayed or undelivered messages.</p>
        <p className="muted small">{businessName}{s.postalAddress ? ` · ${s.postalAddress}` : ""}</p>
      </section>
      <Link href="/" className="manager-link">Back</Link>
    </main>
  );
}
