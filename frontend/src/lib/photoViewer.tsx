import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { PhotoLightbox } from "../components/rooms/PhotoLightbox";
import type { RoomPhoto } from "./types";

type OpenPhotos = (title: string, photos: RoomPhoto[], startIndex?: number) => void;

const PhotoViewerContext = createContext<OpenPhotos | null>(null);

/**
 * Uma galeria de fotos para o app inteiro, como os toasts e a confirmação:
 *   const openPhotos = usePhotoViewer();
 *   openPhotos(room.name, room.photos, 2);
 */
export function PhotoViewerProvider({ children }: { children: ReactNode }) {
  const [viewing, setViewing] = useState<{ title: string; photos: RoomPhoto[]; startIndex: number } | null>(null);

  const open = useCallback<OpenPhotos>((title, photos, startIndex = 0) => {
    if (photos.length > 0) setViewing({ title, photos, startIndex });
  }, []);

  return (
    <PhotoViewerContext.Provider value={open}>
      {children}
      {viewing && <PhotoLightbox {...viewing} onClose={() => setViewing(null)} />}
    </PhotoViewerContext.Provider>
  );
}

export function usePhotoViewer(): OpenPhotos {
  const open = useContext(PhotoViewerContext);
  if (!open) throw new Error("usePhotoViewer precisa estar dentro de <PhotoViewerProvider>");
  return open;
}
