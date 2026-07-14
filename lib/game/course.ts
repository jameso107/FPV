import {
  Group,
  Mesh,
  MeshBasicMaterial,
  TorusGeometry,
  Vector3,
  MathUtils,
} from "three";

const DEG2RAD = Math.PI / 180;

/**
 * Gate definition in local meters around the spawn point.
 * heightAGL is resolved against the streamed terrain/buildings at runtime,
 * so the course adapts to whatever Google's mesh puts underneath it.
 * headingDeg: direction of travel through the gate (0 = -Z, 90 = +X).
 */
export interface GateDef {
  x: number;
  z: number;
  heightAGL: number;
  headingDeg: number;
}

/** ~1.1 km clockwise circuit over the Grand Park / City Hall area. */
export const COURSE: GateDef[] = [
  { x: 0, z: -30, heightAGL: 14, headingDeg: 0 }, // start/finish
  { x: 10, z: -140, heightAGL: 20, headingDeg: 5 },
  { x: 60, z: -260, heightAGL: 32, headingDeg: 30 },
  { x: 150, z: -330, heightAGL: 42, headingDeg: 70 },
  { x: 260, z: -340, heightAGL: 48, headingDeg: 100 },
  { x: 350, z: -280, heightAGL: 38, headingDeg: 150 },
  { x: 380, z: -170, heightAGL: 26, headingDeg: 175 },
  { x: 330, z: -60, heightAGL: 30, headingDeg: 225 },
  { x: 220, z: 10, heightAGL: 22, headingDeg: 255 },
  { x: 90, z: 30, heightAGL: 16, headingDeg: 300 },
];

export const GATE_RADIUS = 3.2;

const COLOR_NEXT = 0xff4de1;
const COLOR_UPCOMING = 0x1fb8d4;
const COLOR_PASSED = 0x3dff7a;

export class Gate {
  readonly mesh: Mesh;
  readonly position = new Vector3();
  readonly normal: Vector3;
  readonly def: GateDef;

  constructor(def: GateDef) {
    this.def = def;
    const geo = new TorusGeometry(GATE_RADIUS, 0.22, 12, 48);
    const mat = new MeshBasicMaterial({ color: COLOR_UPCOMING });
    this.mesh = new Mesh(geo, mat);
    const h = def.headingDeg * DEG2RAD;
    this.normal = new Vector3(Math.sin(h), 0, -Math.cos(h));
    this.mesh.rotation.y = -h; // torus faces +Z by default; align to heading
    this.setBaseY(0);
  }

  setBaseY(groundY: number) {
    this.position.set(this.def.x, groundY + this.def.heightAGL, this.def.z);
    this.mesh.position.copy(this.position);
  }

  setState(state: "next" | "upcoming" | "passed") {
    const mat = this.mesh.material as MeshBasicMaterial;
    mat.color.setHex(
      state === "next"
        ? COLOR_NEXT
        : state === "passed"
          ? COLOR_PASSED
          : COLOR_UPCOMING
    );
  }
}

export interface LapResult {
  lapMs: number;
  isBest: boolean;
}

/**
 * Sequential gate racing: pass gate 0 to start the clock, hit every gate in
 * order, and crossing gate 0 again closes the lap.
 */
export class RaceManager {
  readonly group = new Group();
  readonly gates: Gate[];
  nextIndex = 0;
  raceActive = false;
  raceStartMs = 0;
  bestLapMs: number | null = null;

  private prevPos = new Vector3();
  private hasPrev = false;
  private rel = new Vector3();
  private relPrev = new Vector3();
  private pulse = 0;

  constructor() {
    this.gates = COURSE.map((def) => new Gate(def));
    for (const g of this.gates) this.group.add(g.mesh);
    try {
      const stored = localStorage.getItem("lafpv-best-lap");
      if (stored) this.bestLapMs = Number(stored) || null;
    } catch {
      /* private browsing */
    }
    this.refreshColors();
  }

  /** Re-anchor gate heights once terrain is known. */
  resolveHeights(groundYAt: (x: number, z: number) => number | null, fallbackY: number) {
    for (const g of this.gates) {
      const y = groundYAt(g.def.x, g.def.z);
      g.setBaseY(y ?? fallbackY);
    }
  }

  resetRun() {
    this.nextIndex = 0;
    this.raceActive = false;
    this.hasPrev = false;
    this.refreshColors();
  }

  /** Call once per physics step. Returns a LapResult when a lap closes. */
  update(pos: Vector3, nowMs: number, dt: number): LapResult | null {
    this.pulse += dt * 5;
    const next = this.gates[this.nextIndex];
    const s = 1 + Math.sin(this.pulse) * 0.06;
    next.mesh.scale.setScalar(s);

    if (!this.hasPrev) {
      this.prevPos.copy(pos);
      this.hasPrev = true;
      return null;
    }

    let result: LapResult | null = null;
    this.rel.subVectors(pos, next.position);
    this.relPrev.subVectors(this.prevPos, next.position);
    const dPrev = this.relPrev.dot(next.normal);
    const dCur = this.rel.dot(next.normal);

    if (dPrev < 0 && dCur >= 0) {
      // crossed the gate plane in the right direction; check radial miss
      const t = dPrev / (dPrev - dCur);
      const cross = this.relPrev.clone().lerp(this.rel, t);
      cross.addScaledVector(next.normal, -cross.dot(next.normal));
      if (cross.length() < GATE_RADIUS) {
        result = this.onGatePassed(nowMs);
      }
    }

    this.prevPos.copy(pos);
    return result;
  }

  private onGatePassed(nowMs: number): LapResult | null {
    let result: LapResult | null = null;
    if (this.nextIndex === 0) {
      if (this.raceActive) {
        const lapMs = nowMs - this.raceStartMs;
        const isBest = this.bestLapMs === null || lapMs < this.bestLapMs;
        if (isBest) {
          this.bestLapMs = lapMs;
          try {
            localStorage.setItem("lafpv-best-lap", String(lapMs));
          } catch {
            /* ignore */
          }
        }
        result = { lapMs, isBest };
      }
      this.raceActive = true;
      this.raceStartMs = nowMs;
    }
    this.gates[this.nextIndex].mesh.scale.setScalar(1);
    this.nextIndex = (this.nextIndex + 1) % this.gates.length;
    this.refreshColors();
    return result;
  }

  private refreshColors() {
    this.gates.forEach((g, i) => {
      if (i === this.nextIndex) g.setState("next");
      else g.setState(this.raceActive || this.nextIndex > 0 ? "passed" : "upcoming");
    });
    // gates still ahead this lap stay cyan
    for (let k = 1; k < this.gates.length; k++) {
      const i = (this.nextIndex + k) % this.gates.length;
      this.gates[i].setState("upcoming");
    }
    this.gates[this.nextIndex].setState("next");
  }

  formatTime(ms: number): string {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  }
}

export { MathUtils };
