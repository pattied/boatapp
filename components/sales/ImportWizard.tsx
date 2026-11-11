"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type Summary = { added: number; updated: number; skipped: number; outcomes: { row: number; result: string; reason?: string; name?: string }[] };

// Reads comma, tab or semicolon separated text, with quoted cells and line breaks inside quotes.
function parse(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", "\t", ";"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

// Guesses which field a column holds from its heading, the way import tools suggest a mapping.
const GUESS: [RegExp, string][] = [
  [/^(first|given|f)[ _-]?name$|^first$/, "first_name"],
  [/^(last|family|sur|l)[ _-]?name$|^last$|^surname$/, "last_name"],
  [/^(full[ _-]?name|name|contact|owner|customer|client)( name)?$/, "full_name"],
  [/phone|mobile|cell|tel/, "phone"],
  [/e-?mail/, "email"],
  [/address.*2|apt|suite|unit|po box/, "address2"],
  [/address|street/, "address1"],
  [/city|town/, "city"],
  [/^state$|province|^st$/, "state"],
  [/zip|postal/, "postal_code"],
  [/boat.*name|vessel|^boat$/, "boat_name"],
  [/make|model/, "make_model"],
  [/length|loa|feet|^ft$/, "length_ft"],
  [/marina|harbor|harbour|yacht club/, "marina"],
  [/dock|pier/, "dock"],
  [/slip|berth/, "slip"],
  [/interest|service|wants/, "interest"],
  [/note|comment|remark/, "note"],
];
const guess = (h: string) => GUESS.find(([re]) => re.test(h.trim().toLowerCase()))?.[1] ?? "";

export default function ImportWizard({ fields, action }: { fields: [string, string][]; action: (payload: string) => Promise<Summary | { error: string }> }) {
  const [table, setTable] = useState<string[][] | null>(null);
  const [map, setMap] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [listName, setListName] = useState("");
  const [stage, setStage] = useState("prospect");
  const [duplicates, setDuplicates] = useState("skip");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState<Summary | null>(null);

  function load(raw: string, name?: string) {
    const rows = parse(raw);
    if (rows.length < 2) { setError("That needs a heading row and at least one person."); return; }
    if (rows.length > 5001) { setError("That list has more than 5,000 rows. Split it into smaller files."); return; }
    setError("");
    const used = new Set<string>();
    setMap(rows[0].map((h) => { const g = guess(h); if (!g || used.has(g)) return ""; used.add(g); return g; }));
    setTable(rows);
    if (name && !listName) setListName(name.replace(/\.[a-z0-9]+$/i, ""));
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 3_000_000) { setError("That file is over 3 MB. Split it into smaller files."); return; }
    if (/\.(xlsx?|numbers)$/i.test(f.name)) { setError("Save the spreadsheet as CSV first (File, then Save As or Download, then CSV), and choose that file."); return; }
    load(await f.text(), f.name);
  }

  const mapped = useMemo(() => new Set(map.filter(Boolean)), [map]);
  const hasName = mapped.has("first_name") || mapped.has("full_name") || mapped.has("boat_name");
  const hasReach = mapped.has("phone") || mapped.has("email") || mapped.has("address1");

  async function run() {
    if (!table) return;
    setError("");
    const body = table.slice(1);
    const all: Summary = { added: 0, updated: 0, skipped: 0, outcomes: [] };
    try {
      for (let i = 0; i < body.length; i += 200) {
        setBusy(`Importing rows ${i + 1} to ${Math.min(i + 200, body.length)} of ${body.length}…`);
        const rows = body.slice(i, i + 200).map((r) => Object.fromEntries(map.map((f, c) => [f, (r[c] ?? "").trim()]).filter(([f, v]) => f && v)));
        const res = await action(JSON.stringify({ rows, listName, stage, duplicates, firstRow: i + 2 }));
        if ("error" in res) { setError(`${res.error} Rows before ${i + 2} were imported; the rest were not.`); break; }
        all.added += res.added; all.updated += res.updated; all.skipped += res.skipped; all.outcomes.push(...res.outcomes);
      }
    } catch {
      setError("The connection dropped. Rows already imported are saved; importing the same file again skips them as duplicates.");
    }
    setBusy("");
    setDone(all);
  }

  if (done) {
    const skipped = done.outcomes.filter((o) => o.result === "skipped");
    return (
      <div className="stack">
        <div className="notice good"><strong>{done.added}</strong> added, <strong>{done.updated}</strong> updated, <strong>{done.skipped}</strong> skipped.</div>
        {error && <p className="notice bad" role="alert">{error}</p>}
        {skipped.length > 0 && (
          <section className="card stack">
            <h2>Skipped rows</h2>
            <p className="muted small">Row numbers match your file, counting the heading as row 1.</p>
            <ul className="plain-list small">
              {skipped.slice(0, 300).map((o) => <li key={o.row}>Row {o.row}{o.name ? ` (${o.name})` : ""}: {o.reason}</li>)}
            </ul>
          </section>
        )}
        <div className="btn-row">
          <Link href={`/sales/leads?list=${encodeURIComponent(listName)}`} className="btn primary">See this list</Link>
          <button className="btn" onClick={() => { setDone(null); setTable(null); setText(""); }}>Import another</button>
        </div>
      </div>
    );
  }

  if (!table) {
    return (
      <div className="stack">
        <section className="card stack">
          <h2>1. Choose the list</h2>
          <label className="field"><span>A CSV file</span><input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={onFile} /></label>
          <p className="muted small">From Excel, Numbers or Google Sheets: save or download the sheet as CSV. The first row must be headings.</p>
          <label className="field"><span>Or paste rows copied from a spreadsheet</span><textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={"First name,Last name,Phone,Email,Boat,Marina,Slip\nDana,Whitfield,415-555-0111,dana@example.com,Sea Breeze,Clipper Yacht Harbor,C-14"} /></label>
          <button className="btn" disabled={!text.trim()} onClick={() => load(text)}>Use pasted rows</button>
          {error && <p className="notice bad" role="alert">{error}</p>}
        </section>
      </div>
    );
  }

  const head = table[0];
  return (
    <div className="stack">
      <section className="card stack">
        <h2>2. Match your columns</h2>
        <p className="muted small">{table.length - 1} people found. We guessed each column from its heading. Change any that are wrong; unmatched columns are left out.</p>
        <div className="map-grid">
          {head.map((h, c) => (
            <label key={c} className="field">
              <span>{h || `Column ${c + 1}`} <span className="muted">· e.g. {table.slice(1, 4).map((r) => r[c]).filter(Boolean)[0]?.slice(0, 24) || "empty"}</span></span>
              <select value={map[c] ?? ""} onChange={(e) => setMap((m) => m.map((v, i) => (i === c ? e.target.value : v === e.target.value && e.target.value ? "" : v)))} aria-label={`Field for ${h}`}>
                <option value="">Leave out</option>
                {fields.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
          ))}
        </div>
        {!hasName && <p className="notice warn">Match a column to First name, Full name or Boat name.</p>}
        {!hasReach && <p className="notice warn">Match a column to Phone, Email or Street address. A lead needs one way to be reached.</p>}
      </section>
      <section className="card stack">
        <h2>3. Where they go</h2>
        <label className="field"><span>Name for this list</span><input value={listName} onChange={(e) => setListName(e.target.value)} maxLength={80} placeholder="Boat show November" /></label>
        <label className="field">
          <span>Category</span>
          <select value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="prospect">Prospect (no conversation yet)</option>
            <option value="lead">Active lead (already talking with us)</option>
          </select>
        </label>
        <label className="field">
          <span>If the phone or email is already on file</span>
          <select value={duplicates} onChange={(e) => setDuplicates(e.target.value)}>
            <option value="skip">Skip that row</option>
            <option value="fill">Fill in their blank details, change nothing else</option>
          </select>
        </label>
        <p className="muted small">
          Customers and people marked do not contact are never changed by an import. Imported people have no permission to be texted:
          being on a list is not consent. They can be emailed, mailed or called, and text permission is added later if they give it.
        </p>
        {error && <p className="notice bad" role="alert">{error}</p>}
        {busy && <p className="notice warn" role="status">{busy}</p>}
        <div className="btn-row">
          <button className="btn primary" disabled={!hasName || !hasReach || Boolean(busy)} onClick={run}>Import {table.length - 1} people</button>
          <button className="btn" disabled={Boolean(busy)} onClick={() => setTable(null)}>Start over</button>
        </div>
      </section>
    </div>
  );
}
