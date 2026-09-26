import { cn } from "../../lib/cn";

// Cor estável por pessoa (mesmo nome → mesma cor), com par claro/escuro de bom contraste.
const PALETTE = [
  "bg-teal-100 text-teal-800 dark:bg-teal-400/15 dark:text-teal-300",
  "bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-300",
  "bg-violet-100 text-violet-800 dark:bg-violet-400/15 dark:text-violet-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
  "bg-rose-100 text-rose-800 dark:bg-rose-400/15 dark:text-rose-300",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300",
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

function hash(value: string): number {
  let h = 0;
  for (const char of value) h = (h * 31 + char.charCodeAt(0)) >>> 0;
  return h;
}

export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const box = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-12 text-base" }[size];
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold", box, PALETTE[hash(name) % PALETTE.length], className)}
    >
      {initials(name)}
    </span>
  );
}
