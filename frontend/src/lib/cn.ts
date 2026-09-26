/** Junta classes, ignorando as condicionais falsas: cn("a", ok && "b"). */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
