// CSV building shared by every export. Cells that would run as spreadsheet formulas are neutralized.
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
  // Phone numbers such as +14155550111 are left alone: digits and punctuation cannot run anything.
  if (/^[=+\-@\t\r]/.test(s) && !/^[+\-]?[\d\s().\-]+$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvFile(name: string, cols: [string, string][], rows: Record<string, unknown>[]): Response {
  const body = [cols.map(([, label]) => csvCell(label)).join(","), ...rows.map((r) => cols.map(([k]) => csvCell(r[k])).join(","))].join("\r\n");
  // The leading mark makes Excel read accented names correctly.
  return new Response(`\uFEFF${body}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
