import { csvFile } from "@/lib/csv";
import { todayLA } from "@/lib/dates";
import { q } from "@/lib/db";
import { managerSession } from "@/lib/session";

// Full exports for mailings and record keeping. Manager only.
export async function GET(req: Request) {
  if (!(await managerSession())) return new Response("Sign in as a manager.", { status: 401 });
  const url = new URL(req.url);
  const what = url.searchParams.get("what") ?? "";
  const who = url.searchParams.get("who") ?? "";
  const day = todayLA();

  if (what === "contacts") {
    const where =
      who === "customers" ? "c.status <> 'prospect'" : who === "prospects" ? "c.status = 'prospect'" : who === "mailable" ? "c.address1 <> '' and c.postal_code <> ''" : "true";
    const rows = await q<Record<string, unknown>>(
      `select case when c.status = 'prospect' then 'Prospect' else 'Customer' end as kind, c.status, c.name,
         c.first_name, c.last_name, c.phone, c.email, c.address1, c.address2, c.city, c.state, c.postal_code,
         c.contact_pref, c.sms_consent, c.consent_at, c.promo_sms_consent, c.promo_sms_consent_at,
         c.sms_opted_out_at is not null as sms_opted_out, c.email_opted_out_at is not null as email_unsubscribed,
         c.marketing_consent as photo_use_ok, c.source, c.interest, c.notes, c.created_at,
         (select string_agg(b.name, '; ' order by b.name) from boats b where b.customer_id = c.id and b.status <> 'sold') as boats,
         (select string_agg(distinct m.name, '; ') from boats b join marinas m on m.id = b.marina_id where b.customer_id = c.id and b.status <> 'sold') as marinas,
         (select string_agg(x.name || coalesce(' ' || nullif(x.phone, ''), '') || coalesce(' ' || nullif(x.email, ''), ''), '; ') from contacts x where x.customer_id = c.id) as other_contacts
       from customers c where c.status <> 'declined' and ${where} order by c.status = 'prospect', c.last_name, c.first_name, c.name`,
    );
    return csvFile(`contacts-${who || "all"}-${day}.csv`, [
      ["kind", "Type"], ["status", "Status"], ["first_name", "First name"], ["last_name", "Last name"], ["name", "Full name"], ["phone", "Phone"], ["email", "Email"],
      ["address1", "Address 1"], ["address2", "Address 2"], ["city", "City"], ["state", "State"], ["postal_code", "ZIP"],
      ["contact_pref", "Prefers"], ["sms_consent", "Agreed to service texts"], ["consent_at", "Service text consent date"],
      ["promo_sms_consent", "Agreed to marketing texts"], ["promo_sms_consent_at", "Marketing text consent date"],
      ["sms_opted_out", "Opted out of texts"], ["email_unsubscribed", "Unsubscribed from marketing email"], ["photo_use_ok", "Photo use OK"],
      ["boats", "Boats"], ["marinas", "Marinas"], ["other_contacts", "Other contacts"], ["source", "Source"], ["interest", "Interested in"],
      ["notes", "Notes"], ["created_at", "Added"],
    ], rows);
  }

  if (what === "messages") {
    const rows = await q<Record<string, unknown>>(
      `select m.created_at, m.sent_at, c.name, m.direction, m.channel, m.purpose, m.status, m.from_addr, m.to_addr, m.subject, m.body,
         t.name as template, m.created_by, m.approved_by, m.block_reason, m.error, m.provider, m.provider_id
       from messages m left join customers c on c.id = m.customer_id left join message_templates t on t.id = m.template_id
       order by m.created_at`,
    );
    return csvFile(`messages-${day}.csv`, [
      ["created_at", "Created"], ["sent_at", "Sent"], ["name", "Person"], ["direction", "Direction"], ["channel", "Channel"], ["purpose", "Kind"],
      ["status", "Status"], ["from_addr", "From"], ["to_addr", "To"], ["subject", "Subject"], ["body", "Message"], ["template", "Template"],
      ["created_by", "Created by"], ["approved_by", "Approved by"], ["block_reason", "Why blocked"], ["error", "Error"], ["provider", "Provider"], ["provider_id", "Provider reference"],
    ], rows);
  }

  if (what === "consent") {
    const rows = await q<Record<string, unknown>>("select at, customer_name, address, channel, purpose, action, method, wording, actor from consent_log order by at");
    return csvFile(`consent-record-${day}.csv`, [
      ["at", "When"], ["customer_name", "Person"], ["address", "Phone or email"], ["channel", "Channel"], ["purpose", "Covers"], ["action", "Action"],
      ["method", "How"], ["wording", "Wording shown"], ["actor", "Recorded by"],
    ], rows);
  }

  if (what === "suppressions") {
    const rows = await q<Record<string, unknown>>("select channel, address, reason, at from suppressions order by at");
    return csvFile(`do-not-contact-${day}.csv`, [["channel", "Channel"], ["address", "Phone or email"], ["reason", "Reason"], ["at", "Since"]], rows);
  }
  if (what === "spotted") {
    const rows = await q<Record<string, unknown>>(
      `select m.name as marina, d.name as dock, s.slip, s.boat_name, s.make_model, s.length_ft, s.boat_type, s.condition, s.status,
         c.first_name as owner_first, c.last_name as owner_last, c.phone, c.email, c.address1, c.address2, c.city, c.state, c.postal_code, s.spotted_by, s.spotted_at
       from spotted_boats s join marinas m on m.id = s.marina_id left join docks d on d.id = s.dock_id left join customers c on c.id = s.customer_id
       order by m.name, d.name, s.slip`,
    );
    return csvFile(`dock-walk-boats-${day}.csv`, [
      ["marina", "Marina"], ["dock", "Dock"], ["slip", "Slip"], ["boat_name", "Boat"], ["make_model", "Make and model"], ["length_ft", "Length (ft)"],
      ["boat_type", "Type"], ["condition", "Noticed"], ["status", "Status"], ["owner_first", "Owner first name"], ["owner_last", "Owner last name"], ["phone", "Phone"], ["email", "Email"],
      ["address1", "Address 1"], ["address2", "Address 2"], ["city", "City"], ["state", "State"], ["postal_code", "ZIP"], ["spotted_by", "Logged by"], ["spotted_at", "Logged"],
    ], rows);
  }

  if (what === "notes") {
    const rows = await q<Record<string, unknown>>(
      `select n.created_at, c.name, c.status, b.name as boat, n.body, n.needed_by, n.created_by, n.done_at, n.done_by
       from customer_notes n join customers c on c.id = n.customer_id left join boats b on b.id = n.boat_id order by n.created_at`,
    );
    return csvFile(`customer-notes-${day}.csv`, [
      ["created_at", "Written"], ["name", "Person"], ["status", "Status"], ["boat", "Boat"], ["body", "Note"], ["needed_by", "Clean by"],
      ["created_by", "Written by"], ["done_at", "Done"], ["done_by", "Done by"],
    ], rows);
  }
  return new Response("Unknown export.", { status: 400 });
}
