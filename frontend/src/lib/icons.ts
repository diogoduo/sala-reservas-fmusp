import {
  BackpackIcon,
  BooksIcon,
  CertificateIcon,
  ChalkboardSimpleIcon,
  ChalkboardTeacherIcon,
  DesktopIcon,
  DotsThreeCircleIcon,
  ExamIcon,
  FlaskIcon,
  GraduationCapIcon,
  LaptopIcon,
  MaskHappyIcon,
  MicrophoneIcon,
  PackageIcon,
  PresentationIcon,
  ProjectorScreenIcon,
  SnowflakeIcon,
  SpeakerHighIcon,
  SquaresFourIcon,
  UsersThreeIcon,
  VideoCameraIcon,
  VideoConferenceIcon,
  WifiSlashIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { ActivityType, RoomType } from "./types";

export const ACTIVITY_ICONS: Record<ActivityType, Icon> = {
  UNDERGRADUATE: GraduationCapIcon,
  GRADUATE: BooksIcon,
  CULTURE_EXTENSION: MaskHappyIcon,
  PUBLIC_EXAM: ExamIcon,
  DEFENSE: CertificateIcon,
};

export const ROOM_TYPE_ICONS: Record<RoomType, Icon> = {
  AUDITORIUM: PresentationIcon,
  LABORATORY: FlaskIcon,
  CLASSROOM: ChalkboardTeacherIcon,
  MEETING_ROOM: UsersThreeIcon,
  MULTIPURPOSE: SquaresFourIcon,
};

// Recursos são cadastrados pelo Admin (nome livre), então o ícone vem de
// palavras-chave do nome. A ordem importa: "videoconferência" antes de "equipamento".
const RESOURCE_KEYWORDS: [RegExp, Icon][] = [
  [/projetor|datashow/, ProjectorScreenIcon],
  [/lousa/, ChalkboardSimpleIcon],
  [/ar.condicionado|climatiz/, SnowflakeIcon],
  [/videoconfer/, VideoCameraIcon],
  [/webconfer|transmiss/, VideoConferenceIcon],
  [/microfone/, MicrophoneIcon],
  [/\bsom\b|caixa/, SpeakerHighIcon],
  [/chromebook|notebook|laptop/, LaptopIcon],
  [/computador|desktop|\bpc\b/, DesktopIcon],
  [/bloqueio|internet/, WifiSlashIcon],
  [/pessoal/, BackpackIcon],
  [/outro/, DotsThreeCircleIcon],
];

export function resourceIcon(name: string): Icon {
  const normalized = name.toLowerCase();
  return RESOURCE_KEYWORDS.find(([pattern]) => pattern.test(normalized))?.[1] ?? PackageIcon;
}
