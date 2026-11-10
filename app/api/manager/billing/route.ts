import { q } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { managerSession } from "@/lib/session";

const csv = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  // Stop spreadsheet programs from running a cell as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request) {
  if (!(await managerSession())) return new Response("Sign in as a manager.", { status: 401 });
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return new Response("Choose a month.", { status: 400 });
  const from = `${month}-01`;
  const end = addDays(from, 32).slice(0, 7) + "-01"; // first day of the next month
  const rows = await q<Record<string, unknown>>(
    `select j.scheduled_date, c.name as customer, c.email, c.phone, b.name as boat, s.name as service, j.status, j.origin,
       cr.name as crew, j.completed_at, j.partial_reason, j.skip_reason, j.cancel_reason, j.manager_notes
     from jobs j join boats b on b.id = j.boat_id join customers c on c.id = b.customer_id
     left join services s on s.id = j.service_id left join crews cr on cr.id = j.crew_id
     where j.scheduled_date >= $1 and j.scheduled_date < $2 and j.status in ('completed', 'partial', 'skipped', 'cancelled')
     order by c.name, j.scheduled_date`,
    [from, end],
  );
  const cols = ["scheduled_date", "customer", "email", "phone", "boat", "service", "status", "origin", "crew", "completed_at", "partial_reason", "skip_reason", "cancel_reason", "manager_notes"];
  const body = [cols.join(","), ...rows.map((r) => cols.map((c) => csv(r[c])).join(","))].join("\n");
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="visits-${month}.csv"`,
      "cache-control": "no-store",
    },
  });
}
