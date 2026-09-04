// ChatGPT-style thin outline icon set — 24x24 viewBox, stroke=currentColor,
// 1.7px stroke, round caps/joins, no fills. Monochrome by design: icons
// inherit surrounding text color. Add new icons here, never emoji.
function Base({
  children,
  className = "h-5 w-5",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function ChatIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </Base>
  );
}

export function PencilSquareIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Base>
  );
}

export function DocIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </Base>
  );
}

export function LibraryIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </Base>
  );
}

export function FolderIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </Base>
  );
}

export function GlobeIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </Base>
  );
}

export function KeyIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m11 12 10-10" />
      <path d="m15 8 3 3" />
    </Base>
  );
}

export function LayersIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="m12 2 9 4.9-9 4.9-9-4.9z" />
      <path d="m3 11.9 9 4.9 9-4.9" />
      <path d="m3 16.9 9 4.9 9-4.9" />
    </Base>
  );
}

export function ChartIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="M3 3v18h18" />
      <path d="M7 15v3" />
      <path d="M12 10v8" />
      <path d="M17 6v12" />
    </Base>
  );
}

export function ShieldIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </Base>
  );
}

export function ClockIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </Base>
  );
}

export function PaperclipIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </Base>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="M20 6 9 17l-5-5" />
    </Base>
  );
}

export function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="m8 12.5 2.5 2.5L16 9.5" />
    </Base>
  );
}

export function StopIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </Base>
  );
}

export function SearchIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Base>
  );
}

export function EllipsisIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <circle cx="5" cy="12" r="0.5" />
      <circle cx="12" cy="12" r="0.5" />
      <circle cx="19" cy="12" r="0.5" />
    </Base>
  );
}

export function XIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Base>
  );
}

export function ExternalIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </Base>
  );
}
