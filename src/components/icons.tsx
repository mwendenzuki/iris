/** The IRIS mark: a ring around a pupil. Same shape as the app icon. */
export function RingMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 512 512" aria-hidden="true">
      <circle
        cx="256"
        cy="256"
        r="150"
        fill="none"
        stroke="currentColor"
        strokeWidth="28"
      />
      <circle cx="256" cy="256" r="62" fill="currentColor" />
    </svg>
  );
}

export function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
