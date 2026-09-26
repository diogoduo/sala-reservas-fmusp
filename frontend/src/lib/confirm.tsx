import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";

interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

/**
 * Substitui o `window.confirm` por um diálogo do próprio sistema:
 *   if (!(await confirm({ title: "Excluir sala?", tone: "danger" }))) return;
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null);

  const confirm = useCallback<Confirm>((options) => new Promise((resolve) => setPending({ ...options, resolve })), []);

  function close(value: boolean) {
    pending?.resolve(value);
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={pending !== null}
        onClose={() => close(false)}
        size="sm"
        title={pending?.title ?? ""}
        description={pending?.description}
        footer={
          <>
            {/* Em ações destrutivas, o foco começa no "Voltar": Enter por engano não apaga nada. */}
            <Button variant="secondary" data-autofocus={pending?.tone === "danger" || undefined} onClick={() => close(false)}>
              {pending?.cancelLabel ?? "Voltar"}
            </Button>
            <Button
              variant={pending?.tone === "danger" ? "danger" : "primary"}
              data-autofocus={pending?.tone !== "danger" || undefined}
              onClick={() => close(true)}
            >
              {pending?.confirmLabel ?? "Confirmar"}
            </Button>
          </>
        }
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Confirm {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm precisa estar dentro de <ConfirmProvider>");
  return ctx;
}
