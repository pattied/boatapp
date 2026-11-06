import type { ReactNode } from "react";
import { STATUS_LABEL, STATUS_TONE, type JobStatus } from "@/lib/repo";

// Small server-safe building blocks shared by the manager and customer screens.

export function Badge({ tone = "idle", children }: { tone?: string; children: ReactNode }) {
  return <span className={`status ${tone}`}>{children}</span>;
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="muted">{sub}</div>}
      </div>
      {children && <div className="btn-row tight">{children}</div>}
    </header>
  );
}

export function Notice({ error, ok }: { error?: string; ok?: string }) {
  if (error) return <p className="notice bad">{error}</p>;
  if (ok) return <p className="notice good">{ok}</p>;
  return null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted empty">{children}</p>;
}

export function Field({
  label,
  name,
  defaultValue,
  type = "text",
  required,
  placeholder,
  hint,
  wide,
  ...rest
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  wide?: boolean;
  min?: number | string;
  max?: number | string;
  step?: number;
  pattern?: string;
  maxLength?: number;
}) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        required={required}
        placeholder={placeholder}
        {...rest}
      />
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function TextArea({ label, name, defaultValue, wide = true }: { label: string; name: string; defaultValue?: string; wide?: boolean }) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      <textarea name={name} defaultValue={defaultValue ?? ""} rows={2} />
    </label>
  );
}

export function Select({
  label,
  name,
  defaultValue,
  options,
  required,
  blank,
  wide,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  options: { value: string; label: string; group?: string }[];
  required?: boolean;
  blank?: string;
  wide?: boolean;
}) {
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      <select name={name} defaultValue={defaultValue ?? ""} required={required}>
        {blank !== undefined && <option value="">{blank}</option>}
        {groups.length > 1 || groups[0]
          ? groups.map((g) => (
              <optgroup key={g} label={g || "Other"}>
                {options
                  .filter((o) => (o.group ?? "") === g)
                  .map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
              </optgroup>
            ))
          : options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
      </select>
    </label>
  );
}

export function Check({ label, name, defaultChecked }: { label: string; name: string; defaultChecked?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      <span>{label}</span>
    </label>
  );
}

export function Submit({ children, tone = "primary", name, value, formAction }: {
  children: ReactNode;
  tone?: "primary" | "plain" | "danger" | "quiet";
  name?: string;
  value?: string;
  formAction?: (fd: FormData) => void | Promise<void>;
}) {
  return (
    <button className={`btn ${tone === "plain" ? "" : tone}`} type="submit" name={name} value={value} formAction={formAction}>
      {children}
    </button>
  );
}
