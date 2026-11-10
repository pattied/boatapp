"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Item = { clientId: string; marinaId: string; dockId: string; slip: string; boatName: string; makeModel: string; lengthFt: string; boatType: string; condition: string; at: number };
const KEY = "cc_sales_queue";

function load(): Item[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function store(items: Item[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage blocked: the boat still uploads if there is signal.
  }
}

// Fast boat entry for walking a dock. Each boat is saved on the phone first and uploaded when there is signal,
// so a dead spot at the end of a dock loses nothing.
export default function WalkForm({ marinaId, dockId, boatTypes }: { marinaId: string; dockId: string; boatTypes: string[] }) {
  const router = useRouter();
  const [queue, setQueue] = useState<Item[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const slipRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);

  const flush = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    let sent = 0;
    try {
      for (const item of load()) {
        let res: Response;
        try {
          res = await fetch("/api/sales/spotted", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...item, lengthFt: Number(item.lengthFt) || null }) });
        } catch {
          break; // no signal: keep everything and try later
        }
        if (res.status === 401) {
          setError("You are signed out. Your boats are safe on this phone. Sign in again and they will upload.");
          break;
        }
        if (res.status >= 500) break;
        // Saved, or refused as invalid: either way it leaves the queue.
        store(load().filter((x) => x.clientId !== item.clientId));
        sent++;
      }
    } finally {
      busy.current = false;
      setQueue(load());
      if (sent) router.refresh();
    }
  }, [router]);

  useEffect(() => {
    setQueue(load());
    flush();
    const again = () => flush();
    window.addEventListener("online", again);
    const timer = window.setInterval(again, 20000);
    return () => {
      window.removeEventListener("online", again);
      window.clearInterval(timer);
    };
  }, [flush]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "").trim();
    if (!get("slip") && !get("boat_name")) {
      setError("Enter the slip, the boat name, or both.");
      return;
    }
    setError("");
    const item: Item = {
      clientId: crypto.randomUUID(), marinaId, dockId, slip: get("slip"), boatName: get("boat_name"), makeModel: get("make_model"),
      lengthFt: get("length_ft"), boatType: get("boat_type"), condition: get("condition"), at: Date.now(),
    };
    store([...load(), item]);
    setQueue(load());
    setNote(`Saved ${item.slip ? `slip ${item.slip}` : item.boatName}.`);
    e.currentTarget.reset();
    slipRef.current?.focus();
    flush();
  }

  const waiting = queue.filter((x) => x.marinaId === marinaId && x.dockId === dockId);
  const elsewhere = queue.length - waiting.length;

  return (
    <div className="stack">
      <form onSubmit={submit} className="card stack walk-form">
        <div className="two">
          <label className="field"><span>Slip</span><input ref={slipRef} name="slip" maxLength={20} autoCapitalize="characters" autoComplete="off" placeholder="C-14" enterKeyHint="next" /></label>
          <label className="field"><span>Boat name</span><input name="boat_name" maxLength={80} autoCapitalize="words" autoComplete="off" placeholder="Sea Breeze" /></label>
        </div>
        <label className="field"><span>What you noticed</span><input name="condition" maxLength={500} autoComplete="off" placeholder="Green waterline, dull gelcoat, covers on" /></label>
        {more && (
          <>
            <div className="two">
              <label className="field"><span>Make and model</span><input name="make_model" maxLength={80} autoComplete="off" placeholder="Catalina 36" /></label>
              <label className="field"><span>Length (ft)</span><input name="length_ft" inputMode="numeric" pattern="\d*" maxLength={3} /></label>
            </div>
            <label className="field">
              <span>Type</span>
              <select name="boat_type" defaultValue="">
                <option value="">Not noted</option>
                {boatTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </>
        )}
        {error && <p className="notice bad" role="alert">{error}</p>}
        <button className="btn primary big-btn">Save boat and go to the next</button>
        <div className="crew-foot">
          <button type="button" className="linkish" onClick={() => setMore((m) => !m)}>{more ? "Fewer details" : "Add make, length and type"}</button>
          {note && <span className="good-text small" role="status">{note}</span>}
        </div>
      </form>
      {(waiting.length > 0 || elsewhere > 0) && (
        <div className="notice warn">
          {queue.length} boat(s) saved on this phone, waiting for signal.{" "}
          <button type="button" className="linkish dark" onClick={() => flush()}>Upload now</button>
          {waiting.length > 0 && (
            <ul className="plain-list small">
              {waiting.map((w) => <li key={w.clientId}>{w.slip || "No slip"} · {w.boatName || "No name"}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
