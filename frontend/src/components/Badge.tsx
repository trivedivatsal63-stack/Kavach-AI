import type { ReactNode } from "react";

type Variant = "neutral" | "success" | "warning" | "danger" | "info";

const styles: Record<Variant, string> = {
  neutral:
    "bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-gray-300",
  success:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  warning:
    "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  danger: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
  info: "bg-gray-100 text-gray-700 dark:bg-neutral-800 dark:text-gray-300",
};

export function Badge({
  variant = "neutral",
  children,
}: {
  variant?: Variant;
  children: ReactNode;
}) {
  return <span className={`badge ${styles[variant]}`}>{children}</span>;
}
