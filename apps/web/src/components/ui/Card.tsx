import type { HTMLAttributes, ReactNode } from "react";

export function Card({
  raised,
  interactive,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { raised?: boolean; interactive?: boolean; children: ReactNode }) {
  const classes = ["card", raised ? "card-raised" : "", interactive ? "card-interactive" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
