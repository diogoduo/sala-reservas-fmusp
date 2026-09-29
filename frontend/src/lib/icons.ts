import {
  ArmchairIcon,
  ArrowsSplitIcon,
  BackpackIcon,
  BatteryChargingIcon,
  BooksIcon,
  BriefcaseIcon,
  CertificateIcon,
  ChalkboardSimpleIcon,
  ChalkboardTeacherIcon,
  CursorClickIcon,
  DesktopIcon,
  DesktopTowerIcon,
  DotsThreeCircleIcon,
  ExamIcon,
  FlaskIcon,
  GavelIcon,
  GraduationCapIcon,
  LaptopIcon,
  MaskHappyIcon,
  MicrophoneIcon,
  MonitorIcon,
  PackageIcon,
  PlugsConnectedIcon,
  PresentationIcon,
  ProjectorScreenIcon,
  RadioIcon,
  SnowflakeIcon,
  SpeakerHifiIcon,
  SpeakerHighIcon,
  SquaresFourIcon,
  TelevisionSimpleIcon,
  UsersThreeIcon,
  VideoCameraIcon,
  VideoConferenceIcon,
  WebcamIcon,
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
  ADMINISTRATIVE: BriefcaseIcon,
};

export const ROOM_TYPE_ICONS: Record<RoomType, Icon> = {
  AUDITORIUM: PresentationIcon,
  LABORATORY: FlaskIcon,
  CLASSROOM: ChalkboardTeacherIcon,
  MEETING_ROOM: UsersThreeIcon,
  MULTIPURPOSE: SquaresFourIcon,
  COMPUTER_LAB: DesktopTowerIcon,
  BOARD_ROOM: GavelIcon,
  THEATER: ArmchairIcon,
};

// Recursos são cadastrados pelo Admin (nome livre), então o ícone vem de
// palavras-chave do nome. A ordem importa: "videoconferência" antes de "equipamento",
// "controle do projetor" antes de "projetor", "receptor de microfone" antes de "microfone".
const RESOURCE_KEYWORDS: [RegExp, Icon][] = [
  [/controle|passador/, CursorClickIcon],
  [/projetor|datashow/, ProjectorScreenIcon],
  [/lousa/, ChalkboardSimpleIcon],
  [/ar.condicionado|climatiz/, SnowflakeIcon],
  [/videoconfer/, VideoCameraIcon],
  [/webconfer|transmiss/, VideoConferenceIcon],
  [/webcam|câmera/, WebcamIcon],
  [/receptor/, RadioIcon],
  [/microfone/, MicrophoneIcon],
  [/amplificador/, SpeakerHifiIcon],
  [/\bsom\b|caixa/, SpeakerHighIcon],
  [/televis|\btv\b/, TelevisionSimpleIcon],
  [/monitor/, MonitorIcon],
  [/nobreak/, BatteryChargingIcon],
  [/splitter/, ArrowsSplitIcon],
  [/connect|conex/, PlugsConnectedIcon],
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
