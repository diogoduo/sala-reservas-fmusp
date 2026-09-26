import { DesktopIcon, MoonIcon, SunIcon, type Icon } from "@phosphor-icons/react";
import { cn } from "../../lib/cn";
import { useTheme, type ThemePreference } from "../../lib/theme";
import { IconButton } from "../ui/Button";

const OPTIONS: { value: ThemePreference; label: string; icon: Icon }[] = [
  { value: "light", label: "Tema claro", icon: SunIcon },
  { value: "dark", label: "Tema escuro", icon: MoonIcon },
  { value: "system", label: "Seguir o sistema", icon: DesktopIcon },
];

/** Três botões (claro/escuro/sistema) — usado na barra lateral. */
export function ThemeSegmented() {
  const { preference, setPreference } = useTheme();
  return (
    <div role="group" aria-label="Tema" className="flex rounded-lg bg-surface-muted p-1">
      {OPTIONS.map(({ value, label, icon: OptionIcon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={preference === value}
          aria-label={label}
          title={label}
          onClick={() => setPreference(value)}
          className={cn(
            "grid h-8 flex-1 place-items-center rounded-md transition-colors",
            preference === value ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
          )}
        >
          <OptionIcon size={16} weight={preference === value ? "fill" : "regular"} aria-hidden />
        </button>
      ))}
    </div>
  );
}

/** Um botão que alterna claro ↔ escuro — usado no cabeçalho do celular. */
export function ThemeCycleButton() {
  const { resolved, setPreference } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <IconButton
      icon={resolved === "dark" ? SunIcon : MoonIcon}
      label={next === "dark" ? "Usar tema escuro" : "Usar tema claro"}
      onClick={() => setPreference(next)}
    />
  );
}
