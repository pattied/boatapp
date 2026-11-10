import path from "path";
import { promises as fs } from "fs";
import { ADDED_SERVICES_2026_11, DEFAULT_SERVICES, ONE_TIME, RETIRED_SERVICES_2026_11, SCHEMA } from "./schema";
import { DEFAULT_TEMPLATES } from "./messaging/templates";

// One Postgres interface for the whole app. In production it connects to the database Vercel
// provides (DATABASE_URL or POSTGRES_URL, for example Neon). On a developer machine with no
// database configured it runs an embedded Postgres (PGlite) stored in .data/pg.

type Row = Record<string, unknown>;
export interface Q {
  <T = Row>(text: string, params?: unknown[]): Promise<T[]>;
}
type Db = { q: Q; tx: <T>(fn: (q: Q) => Promise<T>) => Promise<T> };

const url = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

// Postgres "date" stays a YYYY-MM-DD string; timestamps become ISO strings; bigint becomes number.
const asDate = (v: string) => v;
const asTimestamp = (v: string) => new Date(v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString();
const asNumber = (v: string) => Number(v);

async function connect(): Promise<Db> {
  if (url()) {
    const pg = (await import("pg")).default;
    pg.types.setTypeParser(1082, asDate);
    pg.types.setTypeParser(1184, asTimestamp);
    pg.types.setTypeParser(1114, asTimestamp);
    pg.types.setTypeParser(20, asNumber);
    const pool = new pg.Pool({ connectionString: url(), max: 3, idleTimeoutMillis: 10_000 });
    const q: Q = async <T,>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];
    const tx = async <T,>(fn: (q: Q) => Promise<T>) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const inner: Q = async <R,>(text: string, params: unknown[] = []) =>
          (await client.query(text, params)).rows as R[];
        const out = await fn(inner);
        await client.query("commit");
        return out;
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    };
    return { q, tx };
  }
  if (process.env.VERCEL) {
    throw new Error("No database is connected. In Vercel, open this project, go to Storage, and connect a Postgres database.");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DIR || path.join(process.cwd(), ".data", "pg");
  await fs.mkdir(dir, { recursive: true });
  // Load PGlite's WebAssembly files ourselves: Next.js's server runtime breaks PGlite's own file-URL loading.
  const dist = path.join(process.cwd(), "node_modules", "@electric-sql", "pglite", "dist");
  const [pgWasm, initWasm, bundle] = await Promise.all([
    fs.readFile(path.join(dist, "pglite.wasm")),
    fs.readFile(path.join(dist, "initdb.wasm")),
    fs.readFile(path.join(dist, "pglite.data")),
  ]);
  const db = new PGlite(dir, {
    pgliteWasmModule: await WebAssembly.compile(pgWasm),
    initdbWasmModule: await WebAssembly.compile(initWasm),
    fsBundle: new Blob([bundle]),
    parsers: { 1082: asDate, 1184: asTimestamp, 1114: asTimestamp, 20: asNumber },
  });
  const q: Q = async <T,>(text: string, params: unknown[] = []) => (await db.query<T>(text, params)).rows;
  const tx = async <T,>(fn: (q: Q) => Promise<T>) =>
    db.transaction(async (t) => fn(async <R,>(text: string, params: unknown[] = []) => (await t.query<R>(text, params)).rows));
  return { q, tx };
}

async function migrate(db: Db) {
  await db.tx(async (q) => {
    await q("select pg_advisory_xact_lock(727274)");
    for (const stmt of SCHEMA.split(/^--;$/m)) {
      if (stmt.trim()) await q(stmt);
    }
    const [{ n }] = await q<{ n: number }>("select count(*)::int as n from services");
    if (n === 0) {
      for (const s of DEFAULT_SERVICES) {
        await q("insert into services (name, description, is_add_on, price_text, sort) values ($1, $2, $3, $4, $5)", [
          s.name,
          s.description,
          s.addOn,
          s.price,
          s.sort,
        ]);
      }
    }
    // One-time update: add the detail services and turn off the ones they replace.
    // Runs once, so later edits on the Services page are never undone.
    const applied = await q("select 1 from app_meta where key = 'services_2026_11'");
    if (!applied.length) {
      for (const s of ADDED_SERVICES_2026_11) {
        await q(
          `insert into services (name, description, is_add_on, price_text, sort)
           select $1, $2, $3, $4, $5
           where not exists (select 1 from services where lower(name) = lower($1) and name <> all($6::text[]))`,
          [s.name, s.description, s.addOn, s.price, s.sort, RETIRED_SERVICES_2026_11],
        );
      }
      // Case-sensitive on purpose: "Full detail" is retired, the new "Full Detail" is not.
      await q("update services set active = false where name = any($1::text[])", [RETIRED_SERVICES_2026_11]);
      await q("insert into app_meta (key, value) values ('services_2026_11', 'done')");
    }
    for (const m of ONE_TIME) {
      const ran = await q("select 1 from app_meta where key = $1", [m.key]);
      if (ran.length) continue;
      for (const stmt of m.statements) await q(stmt);
      await q("insert into app_meta (key, value) values ($1, 'done')", [m.key]);
    }
    // Built-in message templates are added once each; later edits by the manager are never overwritten.
    for (const t of DEFAULT_TEMPLATES) {
      await q(
        `insert into message_templates (key, name, purpose, sms_body, email_subject, email_body, auto_send, active, sort)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (key) do nothing`,
        [t.key, t.name, t.purpose, t.sms, t.subject, t.email, t.autoSend, t.active, t.sort],
      );
    }
  });
}

// Shared across all bundles in one process, so the embedded database is opened only once.
const g = globalThis as unknown as { __ccDb?: Promise<Db> };

function getDb(): Promise<Db> {
  if (!g.__ccDb) {
    g.__ccDb = (async () => {
      const db = await connect();
      await migrate(db);
      return db;
    })().catch((err) => {
      g.__ccDb = undefined;
      throw err;
    });
  }
  return g.__ccDb;
}

export const q: Q = async <T,>(text: string, params: unknown[] = []) => (await getDb()).q<T>(text, params);
export const one = async <T,>(text: string, params: unknown[] = []) => (await q<T>(text, params))[0] ?? null;
export const tx = async <T,>(fn: (q: Q) => Promise<T>) => (await getDb()).tx(fn);
