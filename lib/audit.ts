import type { Q } from "./db";

// Records who changed what. Only managers can read the log.
export async function audit(
  q: Q,
  actor: string,
  action: string,
  entity: string,
  entityId: string | null,
  detail: Record<string, unknown> = {},
) {
  await q(`insert into audit_log (actor, action, entity, entity_id, detail) values ($1, $2, $3, $4, $5)`, [
    actor,
    action,
    entity,
    entityId,
    JSON.stringify(detail),
  ]);
}
