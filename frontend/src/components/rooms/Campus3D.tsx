import { ArrowsOutCardinalIcon, CrosshairIcon, EyeIcon, MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { levelsOf, shortLabel, type MapBuildingData, type Placement, type RoutePoint } from "../../lib/campusMap";

// Mapa 3D da faculdade (three.js): o piso de cada andar com a planta (as
// paredes, em branco), as alas em vidro, cada sala com o número e a cor da
// situação no horário escolhido, escadas, elevadores e acessos, e o caminho até
// a sala escolhida. Clique numa sala (ou no número) para ver os detalhes.

export type RoomState = "FREE" | "BUSY" | "BLOCKED";

const STATE_COLOR: Record<RoomState, number> = { FREE: 0x16a34a, BUSY: 0xdc2626, BLOCKED: 0x94a3b8 };
const FLOOR_GAP_SINGLE = 4.5;
const FLOOR_GAP_ALL = 11;
const WALL = 3.2;

interface Props {
  buildings: MapBuildingData[];
  placements: Placement[];
  states: Map<string, RoomState>;
  /** "ALL" = todos os andares, empilhados e afastados. */
  floor: string;
  selectedId: string | null;
  route: RoutePoint[] | null;
  routeBuilding: string | null;
  onSelect: (roomId: string | null) => void;
  /** SAD posicionando uma sala: o próximo clique no piso define o lugar. */
  placing?: { roomId: string; building: string; floor: string } | null;
  onPlace?: (x: number, y: number) => void;
}

function roomSize(capacity: number | null) {
  const side = Math.sqrt(Math.max(8, capacity ?? 20) * 1.6);
  return Math.min(16, Math.max(4.5, side));
}

export default function Campus3D({ buildings, placements, states, floor, selectedId, route, routeBuilding, onSelect, placing, onPlace }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    labels: CSS2DRenderer;
    controls: OrbitControls;
    content: THREE.Group;
    textures: Map<string, THREE.Texture>;
    pickables: THREE.Object3D[];
    floorMeshes: THREE.Mesh[];
    fly: { from: THREE.Vector3; to: THREE.Vector3; camFrom: THREE.Vector3; camTo: THREE.Vector3; t: number } | null;
    home: { target: THREE.Vector3; camera: THREE.Vector3 };
  } | null>(null);
  const lastFloor = useRef(floor);
  const handlers = useRef({ onSelect, onPlace, placing });
  handlers.current = { onSelect, onPlace, placing };

  // Cena, câmera, controles e o laço de desenho: uma vez só.
  useEffect(() => {
    const el = host.current!;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, el.clientWidth / el.clientHeight, 1, 5000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.setSize(el.clientWidth, el.clientHeight);
    labels.domElement.style.position = "absolute";
    labels.domElement.style.inset = "0";
    labels.domElement.style.pointerEvents = "none";
    el.appendChild(labels.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = 20;
    controls.maxDistance = 900;
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(-200, 400, 250);
    scene.add(sun);
    const content = new THREE.Group();
    scene.add(content);
    const state = {
      scene,
      camera,
      renderer,
      labels,
      controls,
      content,
      textures: new Map<string, THREE.Texture>(),
      pickables: [] as THREE.Object3D[],
      floorMeshes: [] as THREE.Mesh[],
      fly: null as { from: THREE.Vector3; to: THREE.Vector3; camFrom: THREE.Vector3; camTo: THREE.Vector3; t: number } | null,
      home: { target: new THREE.Vector3(), camera: new THREE.Vector3(0, 200, 220) },
    };
    api.current = state;

    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      if (state.fly) {
        state.fly.t = Math.min(1, state.fly.t + 0.035);
        const e = 1 - Math.pow(1 - state.fly.t, 3);
        controls.target.lerpVectors(state.fly.from, state.fly.to, e);
        camera.position.lerpVectors(state.fly.camFrom, state.fly.camTo, e);
        if (state.fly.t >= 1) state.fly = null;
      }
      const pulse = content.getObjectByName("selected-glow");
      if (pulse) pulse.scale.setScalar(1 + Math.sin(performance.now() / 260) * 0.06);
      controls.update();
      renderer.render(scene, camera);
      labels.render(scene, camera);
    };
    loop();

    const resize = () => {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
      labels.setSize(el.clientWidth, el.clientHeight);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    // Clique (sem arrastar): escolhe a sala ou, posicionando, o lugar no piso.
    const raycaster = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
      const h = handlers.current;
      if (h.placing && h.onPlace) {
        const hit = raycaster.intersectObjects(state.floorMeshes).find((i) => i.object.userData.building === h.placing!.building && i.object.userData.floor === h.placing!.floor);
        if (hit) h.onPlace(hit.point.x - hit.object.userData.bx, hit.point.z - hit.object.userData.by);
        return;
      }
      const hit = raycaster.intersectObjects(state.pickables)[0];
      h.onSelect(hit ? (hit.object.userData.roomId as string) : null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      disposeGroup(content);
      state.textures.forEach((t) => t.dispose());
      renderer.dispose();
      el.innerHTML = "";
      api.current = null;
    };
  }, []);

  // O conteúdo (prédios, salas, caminho): refeito quando muda o que se vê.
  useEffect(() => {
    const s = api.current;
    if (!s) return;
    disposeGroup(s.content);
    s.content.clear();
    s.pickables = [];
    s.floorMeshes = [];
    const gap = floor === "ALL" ? FLOOR_GAP_ALL : FLOOR_GAP_SINGLE;
    const routeFloors = new Set((route ?? []).map((p) => p.floor));
    const box = new THREE.Box3();
    // O enquadramento é no prédio com mais salas (o Prédio Principal).
    const counts = new Map<string, number>();
    for (const p of placements) counts.set(p.building.name, (counts.get(p.building.name) ?? 0) + 1);
    const mainName = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    for (const b of buildings) {
      const levels = levelsOf(b, placements.filter((p) => p.building.name === b.name).map((p) => p.floor));
      const floors = [...levels.keys()];
      const shown = floors.filter((f) => floor === "ALL" || f === floor || (b.name === routeBuilding && routeFloors.has(f)));
      // Prédio sem o andar escolhido: mostra só o piso do térreo, apagado, para situar.
      const ghost = shown.length === 0 && floor !== "ALL" ? floors.find((f) => levels.get(f) === 0) ?? floors[0] : null;
      for (const f of ghost ? [ghost] : shown) {
        const level = levels.get(f) ?? 0;
        const y = level * gap;
        const faded = ghost !== null || (floor !== "ALL" && f !== floor);
        const group = new THREE.Group();
        group.position.set(b.x, y, b.y);
        s.content.add(group);
        const rects = b.floors[f] ?? [];
        for (const r of rects) {
          const slab = new THREE.Mesh(
            new THREE.BoxGeometry(r.w, 0.4, r.h),
            new THREE.MeshStandardMaterial({ color: 0x1f2937, transparent: faded || floor === "ALL", opacity: faded ? 0.35 : floor === "ALL" ? 0.6 : 1, depthWrite: !(faded || floor === "ALL") }),
          );
          slab.position.set(r.x + r.w / 2, -0.2, r.y + r.h / 2);
          slab.userData = { building: b.name, floor: f, bx: b.x, by: b.y };
          group.add(slab);
          s.floorMeshes.push(slab);
          if (b.name === mainName) box.expandByPoint(new THREE.Vector3(b.x + r.x, y, b.y + r.y)).expandByPoint(new THREE.Vector3(b.x + r.x + r.w, y + WALL, b.y + r.y + r.h));
          if (!ghost) {
            const glass = new THREE.Mesh(
              new THREE.BoxGeometry(r.w, WALL, r.h),
              new THREE.MeshBasicMaterial({ color: new THREE.Color(b.color ?? "#ffffff"), transparent: true, opacity: faded ? 0.03 : 0.07, depthWrite: false }),
            );
            glass.position.set(r.x + r.w / 2, WALL / 2, r.y + r.h / 2);
            group.add(glass);
            const edges = new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: faded ? 0.15 : 0.45 }));
            edges.position.copy(glass.position);
            group.add(edges);
          }
        }
        // A planta (paredes em branco) como piso.
        const plan = b.plans.find((p) => p.floor === f);
        if (plan && !ghost) {
          let tex = s.textures.get(plan.id);
          if (!tex) {
            tex = new THREE.TextureLoader().load(`/api/campus-map/plans/${plan.id}?v=${encodeURIComponent(plan.updatedAt)}`);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = s.renderer.capabilities.getMaxAnisotropy();
            s.textures.set(plan.id, tex);
          }
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(plan.bounds.w, plan.bounds.h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: faded ? 0.25 : 0.95, depthWrite: false }));
          mesh.rotation.x = -Math.PI / 2;
          mesh.position.set(plan.bounds.x + plan.bounds.w / 2, 0.03, plan.bounds.y + plan.bounds.h / 2);
          group.add(mesh);
        }
        if (ghost) continue;
        // Escadas, elevadores e acessos.
        for (const l of b.landmarks.filter((x) => x.floor === "*" || x.floor === f)) {
          const isEntrance = l.kind === "ENTRANCE";
          const geo = isEntrance ? new THREE.BoxGeometry(7, 0.3, 3.5) : l.kind === "ELEVATOR" ? new THREE.BoxGeometry(1.8, WALL, 1.8) : new THREE.BoxGeometry(3, 1.2, 3);
          const color = isEntrance ? 0xe11d48 : l.kind === "ELEVATOR" ? 0x2563eb : 0xf59e0b;
          const mark = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, transparent: faded, opacity: faded ? 0.3 : 0.9 }));
          mark.position.set(l.x, isEntrance ? 0.15 : l.kind === "ELEVATOR" ? WALL / 2 : 0.6, l.y);
          group.add(mark);
          if (isEntrance && !faded) group.add(label(`🚪 ${l.label}`, "map-label map-label-entrance", l.x, 4.5, l.y));
        }
        // As salas do andar.
        for (const p of placements.filter((x) => x.building.name === b.name && x.floor === f)) {
          const st = states.get(p.room.id);
          const size = roomSize(p.room.capacity);
          const selected = p.room.id === selectedId;
          const block = new THREE.Mesh(
            new THREE.BoxGeometry(size, 2.6, size * 0.8),
            new THREE.MeshStandardMaterial({ color: st ? STATE_COLOR[st] : 0x14b8a6, transparent: true, opacity: faded ? 0.25 : selected ? 0.95 : 0.7 }),
          );
          block.position.set(p.x, 1.3, p.y);
          block.userData = { roomId: p.room.id };
          group.add(block);
          s.pickables.push(block);
          if (selected) {
            const glow = new THREE.Mesh(new THREE.BoxGeometry(size + 2, 4, size * 0.8 + 2), new THREE.MeshBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.35, depthWrite: false }));
            glow.name = "selected-glow";
            glow.position.set(p.x, 2, p.y);
            group.add(glow);
          }
          if (!faded || selected) {
            const tag = label(shortLabel(p.room.name), `map-label${selected ? " map-label-selected" : ""}${st ? ` map-state-${st.toLowerCase()}` : ""}`, p.x, 5, p.y);
            tag.element.title = `${p.room.name} · ${p.room.capacity ?? "—"} lugares${p.auto ? " · posição aproximada" : ""}`;
            tag.element.style.pointerEvents = "auto";
            tag.element.addEventListener("click", (e) => {
              e.stopPropagation();
              handlers.current.onSelect(p.room.id);
            });
            group.add(tag);
          }
        }
      }
    }

    // O caminho até a sala (entrada → escada → andar → sala).
    const rb = buildings.find((b) => b.name === routeBuilding);
    if (route && route.length > 1 && rb) {
      const levels = levelsOf(rb, route.map((r) => r.floor));
      const pts = route.map((r) => new THREE.Vector3(rb.x + r.x, (levels.get(r.floor) ?? 0) * gap + 0.9, rb.y + r.y));
      const path = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1]!, pts[i]!));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(path, 64, 0.55, 8, false), new THREE.MeshBasicMaterial({ color: 0xf59e0b }));
      s.content.add(tube);
      for (const p of [pts[0]!, pts.at(-1)!]) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0xf59e0b }));
        dot.position.copy(p);
        s.content.add(dot);
      }
    }

    // Enquadramento inicial (e o "centralizar").
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      const sizeV = box.getSize(new THREE.Vector3());
      const span = Math.max(sizeV.x, sizeV.z);
      s.home = { target: center, camera: center.clone().add(new THREE.Vector3(0, span * (floor === "ALL" ? 0.85 : 1.1), span * (floor === "ALL" ? 0.95 : 0.7))) };
      if (s.controls.target.lengthSq() === 0) {
        s.controls.target.copy(center);
        s.camera.position.copy(s.home.camera);
      } else if (lastFloor.current !== floor && !selectedId) {
        s.fly = { from: s.controls.target.clone(), to: s.home.target.clone(), camFrom: s.camera.position.clone(), camTo: s.home.camera.clone(), t: 0 };
      }
      lastFloor.current = floor;
    }
  }, [buildings, placements, states, floor, selectedId, route, routeBuilding]);

  // Voa até a sala escolhida.
  useEffect(() => {
    const s = api.current;
    const p = placements.find((x) => x.room.id === selectedId);
    if (!s || !p) return;
    const levels = levelsOf(p.building, [p.floor]);
    const gap = floor === "ALL" ? FLOOR_GAP_ALL : FLOOR_GAP_SINGLE;
    const to = new THREE.Vector3(p.building.x + p.x, (levels.get(p.floor) ?? 0) * gap, p.building.y + p.y);
    const far = floor === "ALL" ? 2.2 : 1;
    s.fly = { from: s.controls.target.clone(), to, camFrom: s.camera.position.clone(), camTo: to.clone().add(new THREE.Vector3(30 * far, 55 * far, 60 * far)), t: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const zoom = (factor: number) => {
    const s = api.current;
    if (!s) return;
    const dir = s.camera.position.clone().sub(s.controls.target).multiplyScalar(factor);
    s.camera.position.copy(s.controls.target.clone().add(dir));
  };
  const home = () => {
    const s = api.current;
    if (s) s.fly = { from: s.controls.target.clone(), to: s.home.target.clone(), camFrom: s.camera.position.clone(), camTo: s.home.camera.clone(), t: 0 };
  };
  const topView = () => {
    const s = api.current;
    if (!s) return;
    const d = s.camera.position.distanceTo(s.controls.target);
    s.fly = { from: s.controls.target.clone(), to: s.controls.target.clone(), camFrom: s.camera.position.clone(), camTo: s.controls.target.clone().add(new THREE.Vector3(0, d, 0.01)), t: 0 };
  };

  return (
    <div className="relative h-full w-full">
      <div ref={host} className={`h-full w-full ${placing ? "cursor-crosshair" : "cursor-grab"}`} />
      <div className="absolute bottom-3 left-3 flex gap-1 rounded-xl border border-border bg-surface/95 p-1 shadow-md">
        {[
          { icon: CrosshairIcon, label: "Centralizar", onClick: home },
          { icon: MagnifyingGlassPlusIcon, label: "Aproximar", onClick: () => zoom(0.7) },
          { icon: MagnifyingGlassMinusIcon, label: "Afastar", onClick: () => zoom(1.4) },
          { icon: EyeIcon, label: "Ver de cima", onClick: topView },
        ].map((b) => (
          <button key={b.label} type="button" onClick={b.onClick} aria-label={b.label} title={b.label} className="grid size-10 place-items-center rounded-lg text-foreground hover:bg-surface-muted">
            <b.icon size={20} aria-hidden />
          </button>
        ))}
      </div>
      <p className="pointer-events-none absolute right-3 bottom-3 hidden items-center gap-1.5 rounded-lg bg-surface/90 px-2.5 py-1.5 text-xs text-muted shadow sm:flex">
        <ArrowsOutCardinalIcon size={14} aria-hidden /> Arraste para girar · role para aproximar · botão direito para mover
      </p>
    </div>
  );
}

function label(text: string, className: string, x: number, y: number, z: number) {
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;
  const obj = new CSS2DObject(div);
  obj.position.set(x, y, z);
  return obj;
}

function disposeGroup(group: THREE.Object3D) {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      o.geometry.dispose();
      const m = o.material as THREE.Material | THREE.Material[];
      (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
    }
    if (o instanceof CSS2DObject) o.element.remove();
  });
}
