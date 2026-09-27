import { ArrowsOutSimpleIcon, ImageSquareIcon, PlusIcon, StarIcon, TrashIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { cn } from "../../lib/cn";
import { useConfirm } from "../../lib/confirm";
import { usePhotoViewer } from "../../lib/photoViewer";
import { photoUrl } from "../../lib/photos";
import { useToast } from "../../lib/toast";
import type { Room, RoomPhoto } from "../../lib/types";
import { Badge } from "../ui/Badge";
import { Spinner } from "../ui/Button";

const ACCEPTED = "image/jpeg,image/png,image/webp";

interface Props {
  room: Room;
  /** Avisa a tela de salas para recarregar (capa dos cards). */
  onChange: () => void;
}

/**
 * Fotos da sala no painel de edição. Cada ação vale na hora (não depende do
 * "Salvar alterações" do formulário): enviar, remover, escolher a capa e
 * editar a legenda.
 */
export function RoomPhotosManager({ room, onChange }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const openPhotos = usePhotoViewer();
  const fileInput = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<RoomPhoto[]>(room.photos);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);

  async function upload(files: FileList) {
    const list = [...files];
    setUploading({ done: 0, total: list.length });
    let added = 0;
    for (const file of list) {
      try {
        const { photo } = await api<{ photo: RoomPhoto }>(`/rooms/${room.id}/photos`, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        setPhotos((current) => [...current, photo]);
        added++;
      } catch (e) {
        toast.error(`Não foi possível enviar "${file.name}".`, e instanceof ApiError ? e.message : undefined);
      }
      setUploading((u) => u && { ...u, done: u.done + 1 });
    }
    setUploading(null);
    if (added > 0) {
      toast.success(added === 1 ? "Foto adicionada" : `${added} fotos adicionadas`, room.name);
      onChange();
    }
  }

  async function makeCover(photo: RoomPhoto) {
    const ids = [photo.id, ...photos.filter((p) => p.id !== photo.id).map((p) => p.id)];
    try {
      const { photos: ordered } = await api<{ photos: RoomPhoto[] }>(`/rooms/${room.id}/photos/order`, {
        method: "PUT",
        body: JSON.stringify({ ids }),
      });
      setPhotos(ordered);
      toast.success("Capa atualizada", room.name);
      onChange();
    } catch (e) {
      toast.error("Não foi possível trocar a capa.", e instanceof ApiError ? e.message : undefined);
    }
  }

  async function saveCaption(photo: RoomPhoto, caption: string) {
    if ((photo.caption ?? "") === caption.trim()) return;
    try {
      const { photo: updated } = await api<{ photo: RoomPhoto }>(`/rooms/${room.id}/photos/${photo.id}`, {
        method: "PATCH",
        body: JSON.stringify({ caption }),
      });
      setPhotos((current) => current.map((p) => (p.id === updated.id ? updated : p)));
      onChange();
    } catch (e) {
      toast.error("Não foi possível salvar a legenda.", e instanceof ApiError ? e.message : undefined);
    }
  }

  async function remove(photo: RoomPhoto) {
    const ok = await confirm({
      tone: "danger",
      title: "Remover esta foto?",
      description: photo.caption ?? undefined,
      confirmLabel: "Remover foto",
    });
    if (!ok) return;
    try {
      await api(`/rooms/${room.id}/photos/${photo.id}`, { method: "DELETE" });
      setPhotos((current) => current.filter((p) => p.id !== photo.id));
      toast.success("Foto removida", room.name);
      onChange();
    } catch (e) {
      toast.error("Não foi possível remover a foto.", e instanceof ApiError ? e.message : undefined);
    }
  }

  const actionButton =
    "grid size-8 place-items-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none";

  return (
    <section>
      <h3 className="text-base font-semibold">Fotos</h3>
      <p className="text-sm text-muted">Aparecem na consulta de salas e no formulário de reserva. A primeira é a capa.</p>

      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((photo, index) => (
          <li key={photo.id} className="min-w-0">
            <div className="group relative aspect-[3/2] overflow-hidden rounded-lg bg-surface-muted">
              <img src={photoUrl(photo)} alt={photo.caption ?? `Foto ${index + 1}`} loading="lazy" className="size-full object-cover" />
              {index === 0 && (
                <Badge tone="primary" icon={StarIcon} className="absolute top-1.5 left-1.5 shadow-sm">
                  Capa
                </Badge>
              )}
              <div className="absolute top-1.5 right-1.5 flex gap-1">
                <button type="button" className={actionButton} aria-label={`Ampliar foto ${index + 1}`} title="Ampliar" onClick={() => openPhotos(room.name, photos, index)}>
                  <ArrowsOutSimpleIcon size={16} weight="bold" aria-hidden />
                </button>
                {index > 0 && (
                  <button type="button" className={actionButton} aria-label={`Usar a foto ${index + 1} como capa`} title="Usar como capa" onClick={() => void makeCover(photo)}>
                    <StarIcon size={16} weight="bold" aria-hidden />
                  </button>
                )}
                <button type="button" className={cn(actionButton, "hover:bg-danger")} aria-label={`Remover foto ${index + 1}`} title="Remover" onClick={() => void remove(photo)}>
                  <TrashIcon size={16} weight="bold" aria-hidden />
                </button>
              </div>
            </div>
            <input
              key={`${photo.id}-${photo.caption ?? ""}`}
              aria-label={`Legenda da foto ${index + 1}`}
              placeholder="Legenda"
              defaultValue={photo.caption ?? ""}
              maxLength={120}
              onBlur={(e) => void saveCaption(photo, e.target.value)}
              onKeyDown={(e) => {
                // Enter salva a legenda em vez de enviar o formulário da sala.
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              className="mt-1.5 w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-base text-muted transition-colors placeholder:text-muted/60 hover:border-border focus:border-primary focus:text-foreground focus:outline-none sm:text-xs"
            />
          </li>
        ))}

        <li>
          <button
            type="button"
            disabled={uploading !== null}
            onClick={() => fileInput.current?.click()}
            className="flex aspect-[3/2] w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border-strong text-sm font-medium text-muted transition-colors hover:border-primary hover:bg-primary-soft/40 hover:text-primary-soft-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none"
          >
            {uploading ? (
              <>
                <Spinner size={20} />
                <span className="tabular-nums">
                  Enviando {Math.min(uploading.done + 1, uploading.total)} de {uploading.total}…
                </span>
              </>
            ) : (
              <>
                {photos.length === 0 ? <ImageSquareIcon size={24} aria-hidden /> : <PlusIcon size={22} aria-hidden />}
                Adicionar fotos
              </>
            )}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              e.target.value = "";
            }}
          />
        </li>
      </ul>
    </section>
  );
}
