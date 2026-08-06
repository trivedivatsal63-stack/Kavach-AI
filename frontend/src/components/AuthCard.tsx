import type { ReactNode } from "react";

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="relative flex flex-1 items-center justify-center px-4 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-32 top-8 h-72 w-72 rounded-full bg-indigo-400/20 blur-3xl dark:bg-indigo-600/20" />
        <div className="absolute -right-32 bottom-8 h-72 w-72 rounded-full bg-violet-400/20 blur-3xl dark:bg-violet-600/20" />
      </div>

      <div className="card relative w-full max-w-md space-y-6 p-8">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
