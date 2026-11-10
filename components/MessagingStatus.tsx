import { messagingStatus } from "@/lib/messaging/providers";

// Tells the manager plainly whether messages really leave the building.
export default function MessagingStatus() {
  const s = messagingStatus();
  const lines: string[] = [];
  if (!s.sms.live) lines.push("Texts are in test mode: they are recorded here but not delivered. Set SMS_PROVIDER to go live.");
  else if (s.sms.missing.length) lines.push(`Texts cannot send yet. Missing settings: ${s.sms.missing.join(", ")}.`);
  if (!s.email.live) lines.push("Email is in test mode: recorded here but not delivered. Set EMAIL_PROVIDER to go live.");
  else if (s.email.missing.length) lines.push(`Email cannot send yet. Missing settings: ${s.email.missing.join(", ")}.`);
  if (!s.postalAddress) lines.push("Marketing email is blocked until BUSINESS_ADDRESS (your postal address) is set. The law requires it in every marketing email.");
  if (!lines.length) return null;
  return (
    <div className="notice warn stack tight">
      {lines.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );
}
