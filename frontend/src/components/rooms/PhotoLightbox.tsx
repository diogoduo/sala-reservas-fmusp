import { CaretLeftIcon, CaretRightIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "../../lib/cn";
import { photoUrl } from "../../lib/photos";
import type { RoomPhoto } from "../../lib/types";

interface Props {
  title: string;
  photos: RoomPhoto[];
  startIndex?: number;
  onClose: () => void;
}

const SWIPE_MIN_PX = 50;

/**
 * Galeria em tela cheia sobre o <dialog> nativo (fica por cima até de um painel
 * lateral aberto). Setas do teclado ou dos botões trocam a foto; no celular,
 * deslizar para os lados. Sempre escura, como todo visualizador de fotos.
 */
export function PhotoLightbox({ title, photos, startIndex = 0, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(startIndex);
  const swipeStart = useRef<number | null>(null);
  const count = photos.length;
  const photo = photos[index]!;

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  // Carrega as vizinhas antes, para a troca ser instantânea.
  useEffect(() => {
    if (count < 2) return;
    for (const delta of [1, -1]) new Image().src = photoUrl(photos[(index + delta + count) % count]!, "large");
  }, [index, count, photos]);

  const go = (delta: number) => setIndex((i) => (i + delta + count) % count);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowRight") go(1);
    else if (event.key === "ArrowLeft") go(-1);
  }

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType !== "mouse") swipeStart.current = event.clientX;
  }

  function onPointerUp(event: PointerEvent) {
    if (swipeStart.current === null) return;
    const dx = event.clientX - swipeStart.current;
    swipeStart.current = null;
    if (Math.abs(dx) >= SWIPE_MIN_PX) go(dx < 0 ? 1 : -1);
  }

  const navButton = "absolute top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none";

  return (
    <dialog
      ref={ref}
      aria-label={`Fotos de ${title}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={onKeyDown}
      className="m-0 size-full max-h-none max-w-none bg-black/95 p-0 text-white open:animate-fade-in backdrop:bg-black/50"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-6">
          <div className="min-w-0">
            <p className="truncate font-semibold">{title}</p>
            <p className="text-sm text-white/70" aria-live="polite">
              <span className="tabular-nums">
                {index + 1} de {count}
              </span>
              {photo.caption && ` · ${photo.caption}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar fotos"
            className="grid size-11 shrink-0 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
          >
            <XIcon size={22} weight="bold" aria-hidden />
          </button>
        </header>

        <div
          className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center px-2 select-none sm:px-20"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (swipeStart.current = null)}
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <img
            key={photo.id}
            src={photoUrl(photo, "large")}
            alt={photo.caption ? `${title}: ${photo.caption}` : `${title}, foto ${index + 1}`}
            width={photo.width}
            height={photo.height}
            draggable={false}
            className="h-auto max-h-full w-auto max-w-full animate-fade-in rounded-lg object-contain"
          />
          {count > 1 && (
            <>
              <button type="button" onClick={() => go(-1)} aria-label="Foto anterior" className={cn(navButton, "left-2 sm:left-5")}>
                <CaretLeftIcon size={24} weight="bold" aria-hidden />
              </button>
              <button type="button" onClick={() => go(1)} aria-label="Próxima foto" className={cn(navButton, "right-2 sm:right-5")}>
                <CaretRightIcon size={24} weight="bold" aria-hidden />
              </button>
            </>
          )}
        </div>

        {count > 1 && (
          <ul className="flex shrink-0 justify-start gap-2 overflow-x-auto px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] scrollbar-none sm:justify-center">
            {photos.map((p, i) => (
              <li key={p.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Foto ${i + 1}${p.caption ? `: ${p.caption}` : ""}`}
                  aria-current={i === index ? "true" : undefined}
                  className={cn(
                    "block h-14 w-20 overflow-hidden rounded-md ring-2 transition focus-visible:ring-white focus-visible:outline-none",
                    i === index ? "opacity-100 ring-white" : "opacity-50 ring-transparent hover:opacity-80",
                  )}
                >
                  <img src={photoUrl(p)} alt="" loading="lazy" className="size-full object-cover" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </dialog>
  );
}
