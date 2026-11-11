"use server";

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { tx } from "@/lib/db";
import { field } from "@/lib/http";
import { isUuid } from "@/lib/ids";
import { requireSales } from "@/lib/session";
import { isLeadStage, STAGE_LABEL } from "@/lib/stages";

// Moves one or many people between Prospect, Active lead, Customer and Do not contact.
// Sales people and managers both use it; the limits below apply to sales people.
export async function setStage(fd: FormData) {
  const user = await requireSales();
  const b = field(fd, "back", 300);
  const back = b.startsWith("/manager") || b.startsWith("/sales") ? b : "/sales/leads";
  const go = (key: "ok" | "error", msg: string): never => redirect(`${back}${back.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`);
  const ids = [...new Set(fd.getAll("ids").map(String).filter(isUuid))].slice(0, 500);
  const target = field(fd, "stage", 12);
  if (!ids.length) go("error", "Tick at least one person first.");
  if (!["prospect", "lead", "dnc", "customer"].includes(target)) go("error", "Choose where to move them.");
  const status = target === "customer" ? "active" : target;

  const result = await tx(async (t) => {
    const rows = await t<{ id: string; name: string; status: string; phone: string; email: string }>(
      "select id, name, status, phone, email from customers where id = any($1::uuid[]) for update",
      [ids],
    );
    let moved = 0;
    const refused: string[] = [];
    for (const r of rows) {
      if (r.status === status) continue;
      // Only people who are not customers yet move between categories. A customer's contact choices are
      // set on their customer page; changing their status here would also stop their cleaning schedule.
      if (!isLeadStage(r.status)) {
        refused.push(`${r.name} is already a customer`);
        continue;
      }
      // Lifting a do-not-contact is a manager's decision.
      if (!user.manager && r.status === "dnc") {
        refused.push(`${r.name} is marked do not contact; only a manager can lift that`);
        continue;
      }
      await t(
        `update customers set status = $2, stage_changed_at = now(),
           converted_at = case when $2 = 'active' then now() else converted_at end,
           converted_by = case when $2 = 'active' then $3 else converted_by end
         where id = $1`,
        [r.id, status, user.name],
      );
      if (status === "dnc") {
        // A do-not-contact is recorded like any withdrawal of consent, and anything waiting to go is cancelled.
        await t(
          `insert into consent_log (customer_id, customer_name, address, channel, purpose, action, method, actor)
           values ($1, $2, $3, 'sms', 'all', 'revoked', 'Marked do not contact', $5), ($1, $2, $4, 'email', 'all', 'revoked', 'Marked do not contact', $5)`,
          [r.id, r.name, r.phone, r.email, user.name],
        );
        await t("update messages set status = 'cancelled', block_reason = 'Marked do not contact.' where customer_id = $1 and status in ('queued', 'pending_approval')", [r.id]);
      }
      await audit(t, user.name, "move", "customer", r.id, { from: r.status, to: status });
      moved++;
    }
    return { moved, refused };
  });
  const label = target === "customer" ? "Customer" : STAGE_LABEL[status];
  const tail = result.refused.length ? ` Not moved: ${result.refused.slice(0, 3).join("; ")}${result.refused.length > 3 ? `; and ${result.refused.length - 3} more` : ""}.` : "";
  if (!result.moved && result.refused.length) go("error", tail.trim());
  if (!result.moved) go("ok", `Already in ${label}. Nothing changed.`);
  go("ok", `${result.moved} moved to ${label}.${target === "customer" ? " The manager now sees them under Needs attention to add a boat plan." : ""}${tail}`);
}
