export function ShieldMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="shield-mark-grad" x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#818cf8" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <path
        d="M24 3.5 41 10v11.2c0 12.1-7.2 21.4-17 24.3-9.8-2.9-17-12.2-17-24.3V10L24 3.5Z"
        fill="url(#shield-mark-grad)"
      />
      <path
        d="M24 14.5 24 33.5M16 20l8-5.5 8 5.5M16 27.5l8 5.5 8-5.5"
        stroke="#ffffff"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.92}
      />
    </svg>
  );
}
