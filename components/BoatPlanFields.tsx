import { Check, Field, Select } from "./ui";
import { BERTH_TYPES, type Lookups } from "@/lib/repo";

type BoatDefaults = {
  name?: string;
  make_model?: string;
  length_ft?: number | null;
  hull_color?: string;
  marina_id?: string | null;
  gate_id?: string | null;
  dock_id?: string | null;
  slip?: string;
  berth_type?: string;
  gate_code_override?: string;
  access_notes?: string;
  liveaboard?: boolean;
  knock_first?: boolean;
};

// Boat details. Gates and docks are grouped by marina; the server checks they match the marina chosen.
export function BoatFields({ l, b = {} }: { l: Pick<Lookups, "marinas" | "gates" | "docks">; b?: BoatDefaults }) {
  const marinaName = (id: string) => l.marinas.find((m) => m.id === id)?.name ?? "";
  return (
    <>
      <Field label="Boat name" name="boat_name" defaultValue={b.name} required />
      <Field label="Make and model" name="make_model" defaultValue={b.make_model} placeholder="Beneteau Oceanis 45" />
      <Field label="Length (ft)" name="length_ft" type="number" min={8} max={300} defaultValue={b.length_ft ?? ""} />
      <Field label="Hull color" name="hull_color" defaultValue={b.hull_color} />
      <Select
        label="Marina"
        name="marina_id"
        required
        blank="Choose a marina"
        defaultValue={b.marina_id}
        options={l.marinas.map((m) => ({ value: m.id, label: m.name }))}
      />
      <Select
        label="Dock"
        name="dock_id"
        blank="No dock"
        defaultValue={b.dock_id}
        options={l.docks.map((d) => ({ value: d.id, label: d.name, group: marinaName(d.marina_id) }))}
      />
      <Select
        label="Gate"
        name="gate_id"
        blank="Use the dock's gate"
        defaultValue={b.gate_id}
        options={l.gates.map((g) => ({ value: g.id, label: `${g.name}${g.code ? ` (code ${g.code})` : ""}`, group: marinaName(g.marina_id) }))}
      />
      <Field label="Slip" name="slip" defaultValue={b.slip} hint="Required unless the boat is on a mooring or in dry storage" />
      <Select
        label="Berth type"
        name="berth_type"
        defaultValue={b.berth_type ?? "slip"}
        options={BERTH_TYPES.map(([v, label]) => ({ value: v, label }))}
      />
      <Field label="Gate code for this boat only" name="gate_code_override" defaultValue={b.gate_code_override} hint="Leave blank to use the gate's code" />
      <label className="field wide">
        <span>Access notes</span>
        <textarea name="access_notes" defaultValue={b.access_notes ?? ""} rows={2} placeholder="Key in dock box, ladder on port side…" />
      </label>
      <div className="wide checks">
        <Check label="Liveaboard" name="liveaboard" defaultChecked={b.liveaboard} />
        <Check label="Knock first" name="knock_first" defaultChecked={b.knock_first} />
      </div>
    </>
  );
}

type PlanDefaults = {
  service_id?: string | null;
  crew_id?: string | null;
  anchor_date?: string;
  interval_weeks?: number;
  off_interval_weeks?: number | null;
  season_start?: string;
  season_end?: string;
};

const FREQ = [1, 2, 3, 4, 6, 8, 12].map((w) => ({ value: String(w), label: w === 1 ? "Every week" : `Every ${w} weeks` }));

// Recurring cleaning plan: first visit sets the weekday and the cadence.
export function PlanFields({ l, p = {}, optional }: { l: Pick<Lookups, "services" | "crews">; p?: PlanDefaults; optional?: boolean }) {
  const seasonal = Boolean(p.off_interval_weeks);
  return (
    <>
      <Select
        label="Service"
        name="service_id"
        defaultValue={p.service_id}
        blank="Choose a service"
        options={l.services.filter((s) => !s.is_add_on).map((s) => ({ value: s.id, label: s.name }))}
      />
      <Select
        label="Crew"
        name="crew_id"
        defaultValue={p.crew_id}
        blank="No crew yet"
        options={l.crews.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))}
      />
      <Field label={`First visit${optional ? "" : " *"}`} name="first_date" type="date" defaultValue={p.anchor_date} hint="Sets the weekday" />
      <Select label="How often" name="interval_weeks" defaultValue={String(p.interval_weeks ?? (optional ? "" : 2))} blank={optional ? "No recurring plan" : undefined} options={FREQ} />
      <div className="wide checks">
        <Check label="Different frequency outside the main season" name="seasonal" defaultChecked={seasonal} />
      </div>
      <Select label="Off-season frequency" name="off_interval_weeks" defaultValue={String(p.off_interval_weeks ?? 4)} options={FREQ} />
      <Field label="Main season starts (MM-DD)" name="season_start" defaultValue={p.season_start || "04-01"} pattern="\d\d-\d\d" />
      <Field label="Main season ends (MM-DD)" name="season_end" defaultValue={p.season_end || "10-31"} pattern="\d\d-\d\d" />
    </>
  );
}
