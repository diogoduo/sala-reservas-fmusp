import { CameraIcon, ImagesIcon } from "@phosphor-icons/react";
import { useState, type ImgHTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import { plural } from "../../lib/format";
import { ROOM_TYPE_ICONS } from "../../lib/icons";
import { usePhotoViewer } from "../../lib/photoViewer";
import { photoUrl } from "../../lib/photos";
import type { Room, RoomPhoto, RoomType } from "../../lib/types";
import type { Tone } from "../ui/Badge";
import { IconTile } from "../ui/Surface";

type RoomWithPhotos = Pick<Room, "name" | "roomType"> & { photos?: RoomPhoto[] };

/** Imagem que aparece suavemente quando termina de carregar (sem "pular" na tela). */
function FadeImage({ className, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      loading="lazy"
      decoding="async"
      alt=""
      {...props}
      onLoad={() => setLoaded(true)}
      className={cn("transition-[opacity,transform] duration-300 ease-out", loaded ? "opacity-100" : "opacity-0", className)}
    />
  );
}

/**
 * Capa do card da sala (proporção 3:2). Clicar abre a galeria. Sem fotos,
 * mostra o ícone do tipo de espaço.
 */
export function RoomCover({ room, className }: { room: RoomWithPhotos; className?: string }) {
  const openPhotos = usePhotoViewer();
  const photos = room.photos ?? [];
  const cover = photos[0];
  const TypeIcon = ROOM_TYPE_ICONS[room.roomType];

  if (!cover) {
    return (
      <div className={cn("grid aspect-[3/2] w-full place-items-center bg-surface-muted text-muted", className)}>
        <div className="flex flex-col items-center gap-1.5">
          <TypeIcon size={36} weight="duotone" aria-hidden />
          <span className="text-xs">Sem fotos ainda</span>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => openPhotos(room.name, photos)}
      aria-label={`Ver ${plural(photos.length, "foto", "fotos")} de ${room.name}`}
      className={cn("group relative block aspect-[3/2] w-full overflow-hidden bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset", className)}
    >
      <FadeImage src={photoUrl(cover)} width={cover.width} height={cover.height} className="size-full object-cover motion-safe:group-hover:scale-[1.03]" />
      <span className="absolute right-2.5 bottom-2.5 inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
        <ImagesIcon size={14} weight="bold" aria-hidden />
        <span className="tabular-nums">{photos.length}</span>
      </span>
    </button>
  );
}

interface RoomThumbProps {
  room: { roomType: RoomType; photos?: RoomPhoto[] };
  size?: "sm" | "md" | "lg";
  /** Cor do ícone quando a sala não tem foto. */
  tone?: Tone;
  /** Foto em tons de cinza (sala ocupada ou inativa). */
  dimmed?: boolean;
}

/** Miniatura quadrada da capa, no lugar do ícone do tipo de sala (que continua valendo quando não há foto). */
export function RoomThumb({ room, size = "md", tone = "primary", dimmed = false }: RoomThumbProps) {
  const cover = room.photos?.[0];
  if (!cover) return <IconTile icon={ROOM_TYPE_ICONS[room.roomType]} size={size} tone={tone} />;
  const box = { sm: "size-9 rounded-lg", md: "size-11 rounded-xl", lg: "size-14 rounded-2xl" }[size];
  return (
    <span className={cn("block shrink-0 overflow-hidden bg-surface-muted", box, dimmed && "opacity-70 grayscale")}>
      <FadeImage src={photoUrl(cover)} className="size-full object-cover" />
    </span>
  );
}

/** Botão pequeno "N fotos" para abrir a galeria de uma sala em listas e textos. */
export function RoomPhotosButton({ room, className, tone = "default" }: { room: RoomWithPhotos; className?: string; tone?: "default" | "inverse" }) {
  const openPhotos = usePhotoViewer();
  const photos = room.photos ?? [];
  if (photos.length === 0) return null;
  return (
    <button
      type="button"
      onClick={() => openPhotos(room.name, photos)}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
        tone === "inverse"
          ? "bg-white/15 text-white hover:bg-white/25 focus-visible:ring-white"
          : "bg-surface-muted text-muted hover:bg-primary-soft hover:text-primary-soft-foreground focus-visible:ring-ring",
        className,
      )}
    >
      <CameraIcon size={14} weight="bold" aria-hidden />
      {plural(photos.length, "foto", "fotos")}
      <span className="sr-only"> de {room.name}</span>
    </button>
  );
}

// Posições no mosaico conforme a quantidade de fotos (até 5): a capa grande à esquerda.
const MOSAIC: Record<number, string[]> = {
  1: ["col-span-4 row-span-2"],
  2: ["col-span-2 row-span-2", "col-span-2 row-span-2"],
  3: ["col-span-2 row-span-2", "col-span-2", "col-span-2"],
  4: ["col-span-2 row-span-2", "col-span-2", "", ""],
  5: ["col-span-2 row-span-2", "", "", "", ""],
};

/** Mosaico com até 5 fotos (a última mostra "+N" se houver mais). Cada uma abre a galeria nela. */
export function PhotoMosaic({ room, className }: { room: RoomWithPhotos; className?: string }) {
  const openPhotos = usePhotoViewer();
  const photos = room.photos ?? [];
  if (photos.length === 0) return null;
  const shown = photos.slice(0, 5);
  const extra = photos.length - shown.length;

  return (
    <ul className={cn("grid aspect-[2/1] grid-cols-4 grid-rows-2 gap-1.5 overflow-hidden rounded-xl", className)}>
      {shown.map((photo, i) => {
        const isLast = i === shown.length - 1 && extra > 0;
        return (
          <li key={photo.id} className={cn("min-h-0 min-w-0", MOSAIC[shown.length]![i])}>
            <button
              type="button"
              onClick={() => openPhotos(room.name, photos, i)}
              aria-label={isLast ? `Ver todas as ${photos.length} fotos` : `Abrir foto ${i + 1}${photo.caption ? `: ${photo.caption}` : ""}`}
              className="group relative block size-full overflow-hidden bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
            >
              <FadeImage src={photoUrl(photo)} className="size-full object-cover motion-safe:group-hover:scale-[1.04]" />
              {isLast && (
                <span className="absolute inset-0 grid place-items-center bg-black/55 text-lg font-semibold text-white">+{extra + 1}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
