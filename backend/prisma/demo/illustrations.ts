/**
 * Ilustrações das salas da base de demonstração (fictícia). Cada imagem é um
 * SVG desenhado em perspectiva — paredes, janelas, lousa/tela e as fileiras de
 * cadeiras ou mesas conforme o tipo de sala — e depois vira WebP como qualquer
 * foto enviada pelo SAD. Nada aqui vem de foto real.
 */
import type { RoomType } from "@prisma/client";

export interface Palette {
  wall: string;
  wallShade: string;
  floor: string;
  floorShade: string;
  ceiling: string;
  seat: string;
  seatShade: string;
  accent: string;
}

export const PALETTES: Palette[] = [
  { wall: "#eef1f4", wallShade: "#d5dbe2", floor: "#b9a58a", floorShade: "#8f7b62", ceiling: "#f8f9fa", seat: "#2f6f8f", seatShade: "#1f4c63", accent: "#e8a33d" },
  { wall: "#f3efe7", wallShade: "#ddd5c6", floor: "#9a9da3", floorShade: "#6f7379", ceiling: "#fbfaf7", seat: "#c2552d", seatShade: "#8d3a1c", accent: "#2f7d6d" },
  { wall: "#e9f1ee", wallShade: "#cbdad4", floor: "#a88e6e", floorShade: "#7a6449", ceiling: "#f6faf8", seat: "#3d4a5c", seatShade: "#262f3b", accent: "#d9a441" },
  { wall: "#f1eef4", wallShade: "#d8d1df", floor: "#8c8f96", floorShade: "#62666d", ceiling: "#faf9fb", seat: "#2a7f62", seatShade: "#1b5843", accent: "#e07a5f" },
];

const W = 1600;
const H = 1067;

interface Camera {
  /** Ponto de fuga. */
  vx: number;
  vy: number;
  /** Escala da parede do fundo (0–1): menor = sala mais funda. */
  far: number;
}

const fmt = (n: number) => n.toFixed(1);
const poly = (points: [number, number][], fill: string, extra = "") =>
  `<polygon points="${points.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ")}" fill="${fill}" ${extra}/>`;

/** Ponto da imagem para um ponto do "mundo": x e y normalizados (0–1 na moldura) na profundidade k. */
function project(cam: Camera, k: number, nx: number, ny: number): [number, number] {
  return [cam.vx + k * (nx * W - cam.vx), cam.vy + k * (ny * H - cam.vy)];
}

function shell(cam: Camera, p: Palette, windows: boolean): string {
  const f = cam.far;
  const [fl, ft] = project(cam, f, 0, 0);
  const [fr, fb] = project(cam, f, 1, 1);
  const parts: string[] = [];
  parts.push(poly([[0, 0], [W, 0], [fr, ft], [fl, ft]], p.ceiling));
  parts.push(poly([[0, 0], [fl, ft], [fl, fb], [0, H]], "url(#wallLeft)"));
  parts.push(poly([[W, 0], [fr, ft], [fr, fb], [W, H]], "url(#wallRight)"));
  parts.push(poly([[0, H], [W, H], [fr, fb], [fl, fb]], "url(#floor)"));
  parts.push(`<rect x="${fmt(fl)}" y="${fmt(ft)}" width="${fmt(fr - fl)}" height="${fmt(fb - ft)}" fill="${p.wall}"/>`);
  // Rodapé da parede do fundo e linhas do piso (dão profundidade).
  parts.push(`<rect x="${fmt(fl)}" y="${fmt(fb - 10 * f)}" width="${fmt(fr - fl)}" height="${fmt(10 * f)}" fill="${p.wallShade}"/>`);
  for (let i = 1; i < 8; i++) {
    const nx = i / 8;
    const [x1, y1] = project(cam, f, nx, 1);
    parts.push(`<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(nx * W)}" y2="${H}" stroke="${p.floorShade}" stroke-opacity="0.18" stroke-width="2"/>`);
  }
  // Luminárias no teto.
  for (const k of [0.55, 0.7, 0.88]) {
    for (const nx of [0.3, 0.7]) {
      const [x1, y1] = project(cam, k, nx - 0.07, 0.02);
      const [x2, y2] = project(cam, k, nx + 0.07, 0.02);
      const [x3, y3] = project(cam, k * 0.96, nx + 0.07, 0.02);
      const [x4, y4] = project(cam, k * 0.96, nx - 0.07, 0.02);
      parts.push(poly([[x1, y1], [x2, y2], [x3, y3], [x4, y4]], "#ffffff", 'stroke="#dfe3e8" stroke-width="2"'));
    }
  }
  if (windows) {
    // Janelas na parede da esquerda, com a luz entrando.
    for (const [k1, k2] of [
      [0.52, 0.62],
      [0.68, 0.8],
      [0.86, 0.98],
    ] as const) {
      const a = project(cam, k1, 0, 0.22);
      const b = project(cam, k2, 0, 0.22);
      const c = project(cam, k2, 0, 0.58);
      const d = project(cam, k1, 0, 0.58);
      parts.push(poly([a, b, c, d], "url(#glass)", 'stroke="#ffffff" stroke-width="6"'));
      const mid1 = project(cam, (k1 + k2) / 2, 0, 0.22);
      const mid2 = project(cam, (k1 + k2) / 2, 0, 0.58);
      parts.push(`<line x1="${fmt(mid1[0])}" y1="${fmt(mid1[1])}" x2="${fmt(mid2[0])}" y2="${fmt(mid2[1])}" stroke="#ffffff" stroke-width="4"/>`);
    }
  }
  return parts.join("");
}

/** Parede do fundo: lousa, tela de projeção, TV ou palco. */
function frontWall(cam: Camera, p: Palette, type: RoomType): string {
  const f = cam.far;
  const [fl, ft] = project(cam, f, 0, 0);
  const [fr, fb] = project(cam, f, 1, 1);
  const w = fr - fl;
  const h = fb - ft;
  const rect = (x: number, y: number, rw: number, rh: number, fill: string, extra = "") =>
    `<rect x="${fmt(fl + x * w)}" y="${fmt(ft + y * h)}" width="${fmt(rw * w)}" height="${fmt(rh * h)}" fill="${fill}" ${extra}/>`;
  switch (type) {
    case "THEATER":
      return [
        rect(0, 0, 1, 1, "#2b1a1e"),
        rect(0.08, 0.12, 0.84, 0.62, "#3a2328"),
        rect(0.18, 0.18, 0.64, 0.42, "#f4f1ea", 'rx="4"'),
        // Cortinas
        `<path d="M${fmt(fl)},${fmt(ft)} L${fmt(fl + 0.2 * w)},${fmt(ft)} Q${fmt(fl + 0.12 * w)},${fmt(ft + 0.5 * h)} ${fmt(fl + 0.2 * w)},${fmt(ft + 0.78 * h)} L${fmt(fl)},${fmt(ft + 0.78 * h)} Z" fill="#9e1f2c"/>`,
        `<path d="M${fmt(fr)},${fmt(ft)} L${fmt(fr - 0.2 * w)},${fmt(ft)} Q${fmt(fr - 0.12 * w)},${fmt(ft + 0.5 * h)} ${fmt(fr - 0.2 * w)},${fmt(ft + 0.78 * h)} L${fmt(fr)},${fmt(ft + 0.78 * h)} Z" fill="#9e1f2c"/>`,
        rect(0, 0, 1, 0.1, "#7d1622"),
        // Palco
        rect(-0.02, 0.78, 1.04, 0.22, "#6b4a32"),
        rect(-0.02, 0.78, 1.04, 0.03, "#8a6446"),
        rect(0.44, 0.6, 0.12, 0.18, "#4b3526", 'rx="3"'),
      ].join("");
    case "AUDITORIUM":
      return [
        ...Array.from({ length: 9 }, (_, i) => rect(i / 9, 0, 1 / 9 - 0.006, 1, i % 2 ? p.wallShade : p.wall)),
        rect(0.14, 0.1, 0.72, 0.5, "#f7f8fa", 'stroke="#2d3540" stroke-width="5"'),
        rect(0.16, 0.13, 0.68, 0.44, "url(#screen)"),
        rect(0.06, 0.66, 0.1, 0.34, p.accent, 'rx="3"'),
        rect(0.62, 0.7, 0.3, 0.3, "#5b4636"),
      ].join("");
    case "COMPUTER_LAB":
    case "CLASSROOM":
    case "LABORATORY":
      return [
        rect(0.06, 0.16, 0.5, 0.42, "#fdfdfd", 'stroke="#7b848f" stroke-width="5"'),
        rect(0.06, 0.58, 0.5, 0.03, "#9aa3ad"),
        rect(0.62, 0.1, 0.32, 0.5, "url(#screen)", 'stroke="#2d3540" stroke-width="4"'),
        rect(0.6, 0.72, 0.28, 0.08, "#6e5240"),
        rect(0.62, 0.8, 0.02, 0.2, "#4b3829"),
        rect(0.84, 0.8, 0.02, 0.2, "#4b3829"),
        `<line x1="${fmt(fl + 0.78 * w)}" y1="${fmt(ft)}" x2="${fmt(fl + 0.78 * w)}" y2="${fmt(ft + 0.1 * h)}" stroke="#555" stroke-width="3"/>`,
      ].join("");
    default:
      // Reunião, conselho, multiuso: TV na parede e um quadro.
      return [
        rect(0.3, 0.2, 0.4, 0.34, "#1d2530", 'rx="6"'),
        rect(0.32, 0.23, 0.36, 0.28, "url(#screen)"),
        rect(0.05, 0.22, 0.16, 0.3, p.accent, 'opacity="0.85"'),
        rect(0.79, 0.22, 0.16, 0.3, p.wallShade),
        rect(0.4, 0.62, 0.2, 0.06, "#6e5240"),
      ].join("");
  }
}

// Altura do tampo das mesas, na moldura normalizada (1 = chão, 0 = teto).
const TABLE_TOP = 0.78;

/** Cadeira vista por trás (encosto, assento, pé e sombra), apoiada no chão na profundidade k. */
function chair(cam: Camera, k: number, nx: number, p: Palette, withDesk: boolean): string {
  const [cx, cy] = project(cam, k, nx, 1);
  const bw = k * 84;
  const bh = k * 92;
  const parts = [
    `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(bw * 0.62)}" ry="${fmt(bw * 0.13)}" fill="#000" fill-opacity="0.13"/>`,
    `<rect x="${fmt(cx - bw * 0.05)}" y="${fmt(cy - bh * 0.5)}" width="${fmt(bw * 0.1)}" height="${fmt(bh * 0.5)}" fill="#3b3f45"/>`,
    `<rect x="${fmt(cx - bw * 0.52)}" y="${fmt(cy - bh * 0.6)}" width="${fmt(bw * 1.04)}" height="${fmt(bh * 0.14)}" rx="${fmt(bw * 0.06)}" fill="${p.seatShade}"/>`,
    `<rect x="${fmt(cx - bw / 2)}" y="${fmt(cy - bh * 1.3)}" width="${fmt(bw)}" height="${fmt(bh * 0.74)}" rx="${fmt(bw * 0.16)}" fill="${p.seat}"/>`,
    `<rect x="${fmt(cx - bw * 0.42)}" y="${fmt(cy - bh * 1.24)}" width="${fmt(bw * 0.84)}" height="${fmt(bh * 0.08)}" rx="${fmt(bw * 0.04)}" fill="#fff" fill-opacity="0.18"/>`,
  ];
  if (withDesk) {
    parts.push(`<rect x="${fmt(cx + bw * 0.3)}" y="${fmt(cy - bh * 0.86)}" width="${fmt(bw * 0.55)}" height="${fmt(bh * 0.1)}" rx="${fmt(bw * 0.04)}" fill="#d9c4a5"/>`);
  }
  return parts.join("");
}

function rows(cam: Camera, p: Palette, opts: { rows: number; perSide: number; desk: boolean; from: number; to: number }): string {
  const parts: string[] = [];
  for (let r = 0; r < opts.rows; r++) {
    const u = opts.rows === 1 ? 0.5 : r / (opts.rows - 1);
    const k = cam.far + (opts.from + u * (opts.to - opts.from)) * (1 - cam.far);
    const spread = 0.37 / opts.perSide;
    for (let c = 0; c < opts.perSide; c++) {
      parts.push(chair(cam, k, 0.1 + c * spread + spread / 2, p, opts.desk));
      parts.push(chair(cam, k, 0.53 + c * spread + spread / 2, p, opts.desk));
    }
  }
  return parts.join("");
}

/** Mesa vista de frente, apoiada no chão: tampo, painel frontal até o piso. */
function bench(cam: Camera, k: number, a: number, b: number, top: string, panel: string): string {
  const [x1, y1] = project(cam, k, a, TABLE_TOP);
  const [x2] = project(cam, k, b, TABLE_TOP);
  const [, yFloor] = project(cam, k, a, 1);
  const th = k * 16;
  return [
    `<rect x="${fmt(x1)}" y="${fmt(y1 - th)}" width="${fmt(x2 - x1)}" height="${fmt(th)}" fill="${top}"/>`,
    `<rect x="${fmt(x1 + k * 8)}" y="${fmt(y1)}" width="${fmt(x2 - x1 - k * 16)}" height="${fmt(yFloor - y1)}" fill="${panel}"/>`,
  ].join("");
}

function computerDesks(cam: Camera, p: Palette): string {
  const parts: string[] = [];
  for (let r = 0; r < 4; r++) {
    const k = cam.far + (0.08 + r * 0.24) * (1 - cam.far);
    for (const [a, b] of [
      [0.1, 0.46],
      [0.54, 0.9],
    ] as const) {
      parts.push(bench(cam, k, a, b, "#e6e1d8", "#cfc8bb"));
      const [x1, y1] = project(cam, k, a, TABLE_TOP);
      const [x2] = project(cam, k, b, TABLE_TOP);
      const n = 4;
      for (let i = 0; i < n; i++) {
        const mx = x1 + ((i + 0.5) / n) * (x2 - x1);
        const mw = k * 74;
        const mh = k * 50;
        const top = y1 - k * 16 - mh - k * 10;
        parts.push(`<rect x="${fmt(mx - k * 4)}" y="${fmt(top + mh)}" width="${fmt(k * 8)}" height="${fmt(k * 10)}" fill="#20262e"/>`);
        parts.push(`<rect x="${fmt(mx - mw / 2)}" y="${fmt(top)}" width="${fmt(mw)}" height="${fmt(mh)}" rx="${fmt(k * 3)}" fill="#20262e"/>`);
        parts.push(`<rect x="${fmt(mx - mw / 2 + k * 4)}" y="${fmt(top + k * 4)}" width="${fmt(mw - k * 8)}" height="${fmt(mh - k * 8)}" fill="url(#screen)"/>`);
      }
      // As cadeiras ficam entre esta bancada e a próxima (mais perto da câmera).
      for (let i = 0; i < n; i++) parts.push(chair(cam, Math.min(1, k + 0.1 * (1 - cam.far)), a + ((i + 0.5) / n) * (b - a), p, false));
    }
  }
  return parts.join("");
}

function meetingTable(cam: Camera, p: Palette, big: boolean): string {
  const farK = cam.far + 0.1 * (1 - cam.far);
  const nearK = cam.far + (big ? 0.78 : 0.7) * (1 - cam.far);
  const half = big ? 0.17 : 0.13;
  const a = project(cam, farK, 0.5 - half, TABLE_TOP);
  const b = project(cam, farK, 0.5 + half, TABLE_TOP);
  const c = project(cam, nearK, 0.5 + half, TABLE_TOP);
  const d = project(cam, nearK, 0.5 - half, TABLE_TOP);
  const [, nearFloor] = project(cam, nearK, 0.5, 1);
  const parts: string[] = [];
  const seats = big ? 6 : 4;
  // Cadeiras dos dois lados, da mais distante para a mais próxima.
  for (let i = 0; i < seats; i++) {
    const k = farK + ((i + 0.5) / seats) * (nearK - farK);
    parts.push(chair(cam, k, 0.5 - half - 0.07, p, false));
    parts.push(chair(cam, k, 0.5 + half + 0.07, p, false));
  }
  // Tampo, a borda da frente e as pernas.
  parts.push(poly([a, b, c, d], "#7a5a43"));
  parts.push(`<rect x="${fmt(d[0])}" y="${fmt(d[1])}" width="${fmt(c[0] - d[0])}" height="${fmt(nearK * 16)}" fill="#5d4433"/>`);
  for (const x of [d[0] + nearK * 20, c[0] - nearK * 34]) {
    parts.push(`<rect x="${fmt(x)}" y="${fmt(d[1] + nearK * 16)}" width="${fmt(nearK * 14)}" height="${fmt(nearFloor - d[1] - nearK * 16)}" fill="#4b3829"/>`);
  }
  if (big) {
    for (let i = 0; i < seats; i++) {
      const k = farK + ((i + 0.5) / seats) * (nearK - farK);
      for (const nx of [0.5 - half + 0.025, 0.5 + half - 0.025]) {
        const [mx, my] = project(cam, k, nx, TABLE_TOP);
        parts.push(`<circle cx="${fmt(mx)}" cy="${fmt(my - k * 4)}" r="${fmt(k * 6)}" fill="#22272e"/>`);
      }
    }
  }
  return parts.join("");
}

function roundTables(cam: Camera, p: Palette): string {
  const parts: string[] = [];
  for (const [u, nxs] of [
    [0.2, [0.3, 0.7]],
    [0.62, [0.2, 0.5, 0.8]],
  ] as const) {
    const k = cam.far + u * (1 - cam.far);
    for (const nx of nxs) {
      const [cx, cy] = project(cam, k, nx, TABLE_TOP);
      const [, floorY] = project(cam, k, nx, 1);
      parts.push(chair(cam, k, nx - 0.075, p, false));
      parts.push(chair(cam, k, nx + 0.075, p, false));
      parts.push(`<ellipse cx="${fmt(cx)}" cy="${fmt(floorY)}" rx="${fmt(k * 60)}" ry="${fmt(k * 12)}" fill="#000" fill-opacity="0.12"/>`);
      parts.push(`<rect x="${fmt(cx - k * 7)}" y="${fmt(cy)}" width="${fmt(k * 14)}" height="${fmt(floorY - cy)}" fill="#8c8f96"/>`);
      parts.push(`<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(k * 120)}" ry="${fmt(k * 30)}" fill="#f2efe8" stroke="#cfc8bb" stroke-width="3"/>`);
    }
  }
  return parts.join("");
}

function interior(cam: Camera, p: Palette, type: RoomType, capacity: number): string {
  switch (type) {
    case "THEATER":
      return rows(cam, p, { rows: 8, perSide: 6, desk: false, from: 0.1, to: 0.95 });
    case "AUDITORIUM":
      return rows(cam, p, { rows: Math.max(5, Math.min(8, Math.round(capacity / 14))), perSide: 5, desk: false, from: 0.12, to: 0.95 });
    case "COMPUTER_LAB":
      return computerDesks(cam, p);
    case "MEETING_ROOM":
      return meetingTable(cam, p, false);
    case "BOARD_ROOM":
      return meetingTable(cam, p, true);
    case "MULTIPURPOSE":
      return roundTables(cam, p);
    case "LABORATORY":
      // Duas bancadas de simulação, com as banquetas na frente de cada uma.
      return [0.18, 0.58]
        .map((u) => {
          const k = cam.far + u * (1 - cam.far);
          const stools = [0.3, 0.42, 0.58, 0.7].map((nx) => chair(cam, Math.min(1, k + 0.12 * (1 - cam.far)), nx, p, false)).join("");
          return bench(cam, k, 0.24, 0.76, "#f4f4f2", "#d6d9dd") + stools;
        })
        .join("");
    default:
      return rows(cam, p, { rows: Math.max(3, Math.min(6, Math.round(capacity / 8))), perSide: 4, desk: true, from: 0.16, to: 0.93 });
  }
}

/** As vistas de cada sala: geral, lateral e (opcional) da frente. */
export const VIEWS = [
  { caption: "Vista geral (imagem ilustrativa)", camera: { vx: 800, vy: 430, far: 0.42 } },
  { caption: "Vista lateral (imagem ilustrativa)", camera: { vx: 1040, vy: 450, far: 0.38 } },
  { caption: "Lousa e projeção (imagem ilustrativa)", camera: { vx: 700, vy: 470, far: 0.68 } },
] as const;

export function roomIllustration(type: RoomType, capacity: number, palette: Palette, camera: Camera): string {
  const lightType = type === "THEATER" || type === "AUDITORIUM";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="wallLeft" x1="0" x2="1"><stop offset="0" stop-color="${palette.wallShade}"/><stop offset="1" stop-color="${palette.wall}"/></linearGradient>
  <linearGradient id="wallRight" x1="1" x2="0"><stop offset="0" stop-color="${palette.wallShade}"/><stop offset="1" stop-color="${palette.wall}"/></linearGradient>
  <linearGradient id="floor" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${palette.floorShade}"/><stop offset="1" stop-color="${palette.floor}"/></linearGradient>
  <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfe6f5"/><stop offset="1" stop-color="#9cc6e2"/></linearGradient>
  <linearGradient id="screen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dfe9f3"/><stop offset="0.55" stop-color="#b9cde0"/><stop offset="1" stop-color="#8fb0cf"/></linearGradient>
  <radialGradient id="light" cx="0.5" cy="0.2" r="0.9"><stop offset="0" stop-color="#ffffff" stop-opacity="${lightType ? 0.05 : 0.18}"/><stop offset="1" stop-color="#000000" stop-opacity="${lightType ? 0.28 : 0.1}"/></radialGradient>
</defs>
${shell(camera, palette, !lightType)}
${frontWall(camera, palette, type)}
${interior(camera, palette, type, capacity)}
<rect width="${W}" height="${H}" fill="url(#light)"/>
</svg>`;
}
