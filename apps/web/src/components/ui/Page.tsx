import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="meter" role="img" aria-label={label} title={label}>
      <div className="meter-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function MetaRow({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="meta-row">
      <span className="meta-icon">
        <Icon name={icon} />
      </span>
      <div>{children}</div>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "success" | "warning"; children: ReactNode }) {
  const icon: IconName = tone === "success" ? "check" : tone === "warning" ? "alert" : "spark";
  return (
    <div className={`notice notice-${tone}`} role="status">
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

export function Chip({ selected, onClick, children }: { selected?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`chip${selected ? " selected" : ""}`} aria-pressed={!!selected} onClick={onClick}>
      {children}
    </button>
  );
}
