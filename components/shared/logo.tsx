import { cn } from "@/lib/utils";

/**
 * The JMS cycle mark: ring = the daily/weekly sales cycle, dark disc +
 * $ = the record kept at the center of it. See the brand-mark design
 * review artifact for the full rationale and alternates.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("h-8 w-8", className)}
      aria-hidden="true"
    >
      <g fill="none" stroke="#10786A" strokeWidth={5} strokeLinecap="round">
        <path d="M40.89 7.57 A26 26 0 0 1 40.89 56.43" />
        <path d="M23.11 56.43 A26 26 0 0 1 23.11 7.57" />
      </g>
      <g fill="#10786A">
        <polygon points="42.60,61.13 39.18,51.73 33.37,59.17" />
        <polygon points="21.40,2.87 24.82,12.27 30.63,4.83" />
      </g>
      <circle cx={32} cy={32} r={17} fill="#0B1220" />
      <g
        fill="none"
        stroke="#FBFAF7"
        strokeWidth={4.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1={32} y1={17.5} x2={32} y2={46.5} />
        <path d="M39.25 21.85 H28.375 a5.075 5.075 0 0 0 0 10.15 h7.25 a5.075 5.075 0 0 1 0 10.15 H23.3" />
      </g>
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-lg font-extrabold tracking-tight">
        J<span className="text-[#10786A]">M</span>S
      </span>
    </div>
  );
}
