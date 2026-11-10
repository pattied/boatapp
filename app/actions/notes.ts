"use server";

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { isDate } from "@/lib/dates";
import { one, q } from "@/lib/db";
import { field } from "@/lib/http";
import { isUuid } from "@/lib/ids";
import { requireSales } from "@/lib/session";

// Customer notes. Managers and sales people can both add and finish them.

function back(fd: FormData, key: "ok" | "error", msg: string): never {
  const b = field(fd, "back", 300);
  const path = b.startsWith("/manager") || b.startsWith("/sales") ? b : "/manager";
  redirect(`${path.split("#")[0]}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}#notes`);
}

export async function addNote(fd: FormData) {
  const user = await requireSales();
  const customerId = field(fd, "customer_id");
  const v = fd.get("body");
  const body = typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, 2000) : "";
  const neededBy = field(fd, "needed_by", 10);
  const boatId = field(fd, "boat_id");
  const target = isUuid(customerId) ? await one<{ status: string }>("select status from customers where id = $1", [customerId]) : null;
  if (!target) back(fd, "error", "Customer not found.");
  if (!user.manager && target.status !== "prospect") back(fd, "error", "Only a manager can add notes to a customer.");
  if (!body) back(fd, "error", "Write the note first.");
  if (neededBy && !isDate(neededBy)) back(fd, "error", "That date is not valid.");
  const boat = isUuid(boatId) ? await one("select 1 from boats where id = $1 and customer_id = $2", [boatId, customerId]) : null;
  const row = await one<{ id: string }>(
    "insert into customer_notes (customer_id, boat_id, body, needed_by, created_by) values ($1, $2, $3, $4, $5) returning id",
    [customerId, boat ? boatId : null, body, neededBy || null, user.name],
  );
  await audit(q, user.name, "create", "note", row!.id, { customer: customerId, needed_by: neededBy || null });
  back(fd, "ok", neededBy ? "Note saved. It will show on Needs attention as the date gets close." : "Note saved.");
}

export async function setNoteDone(fd: FormData) {
  const user = await requireSales();
  const id = field(fd, "id");
  if (!isUuid(id)) back(fd, "error", "Note not found.");
  const reopen = field(fd, "op", 10) === "reopen";
  if (!user.manager) {
    const n = await one<{ status: string }>("select c.status from customer_notes n join customers c on c.id = n.customer_id where n.id = $1", [id]);
    if (n?.status !== "prospect") back(fd, "error", "Only a manager can change notes on a customer.");
  }
  await q(
    reopen
      ? "update customer_notes set done_at = null, done_by = '' where id = $1"
      : "update customer_notes set done_at = now(), done_by = $2 where id = $1 and done_at is null",
    reopen ? [id] : [id, user.name],
  );
  await audit(q, user.name, reopen ? "reopen" : "done", "note", id);
  back(fd, "ok", reopen ? "Note reopened." : "Marked done.");
}

export async function deleteNote(fd: FormData) {
  const user = await requireSales();
  const id = field(fd, "id");
  if (!isUuid(id)) back(fd, "error", "Note not found.");
  // Sales people can remove their own notes; managers can remove any.
  const rows = await q("delete from customer_notes where id = $1 and ($2 or created_by = $3) returning id", [id, user.manager, user.name]);
  if (!rows.length) back(fd, "error", "Only a manager or the person who wrote a note can delete it.");
  await audit(q, user.name, "delete", "note", id);
  back(fd, "ok", "Note deleted.");
}
