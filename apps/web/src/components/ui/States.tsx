import type { ReactNode } from "react";

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <h3 style={{ fontSize: "1.1rem", marginBottom: description ? 8 : 0 }}>{title}</h3>
      {description && <p style={{ margin: 0 }}>{description}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="error-banner" role="alert">
      {message}
    </div>
  );
}

export function Skeleton({ height = 16, width = "100%", style }: { height?: number | string; width?: number | string; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ height, width, ...style }} aria-hidden="true" />;
}

export function SkeletonCard() {
  return (
    <div className="card" aria-hidden="true">
      <Skeleton height={18} width="60%" style={{ marginBottom: 12 }} />
      <Skeleton height={14} width="40%" style={{ marginBottom: 8 }} />
      <Skeleton height={14} width="80%" />
    </div>
  );
}
