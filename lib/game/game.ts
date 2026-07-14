import {
  MathUtils,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  Vector3,
  WebGLRenderer,
  ACESFilmicToneMapping,
  NoToneMapping,
} from "three";
import { DroneSim } from "./physics";
import { InputManager } from "./input";
import { RaceManager } from "./course";
import { createWorld, World } from "./world";
import { HudState, FlightMode } from "./types";

const PHYSICS_DT = 1 / 240;
const CAMERA_UPTILT_DEG = 22; // FPV camera angle
const CRASH_SPEED = 4.5; // m/s — softer hits just stop the quad
const DRONE_RADIUS = 0.3;

const SPAWN_XZ = { x: 0, z: 20 }; // just behind the start gate
const SPAWN_HEADING = 0; // facing -Z, straight at gate 1

export class FpvGame {
  readonly hud: HudState;

  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: PerspectiveCamera;
  private world: World;
  private drone = new DroneSim();
  private race = new RaceManager();
  private input = new InputManager();

  private raf = 0;
  private watchdog = 0;
  private lastTime = 0;
  private accumulator = 0;
  private groundY: number | null = null;
  private groundPollAccum = 0;
  private gateResolveAccum = 0;
  private hasArmedOnce = false;
  private armedAtMs = 0;
  private throttleSmoothed = 0;
  private hintUntil = 0;

  private ray = new Raycaster();
  private down = new Vector3(0, -1, 0);
  private uptilt = new Quaternion();
  private tmpV = new Vector3();
  private tmpV2 = new Vector3();
  private tmpQ = new Quaternion();

  constructor(canvas: HTMLCanvasElement, hud: HudState, apiKey?: string) {
    this.hud = hud;

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.camera = new PerspectiveCamera(
      85,
      window.innerWidth / window.innerHeight,
      0.05,
      30000
    );

    this.world = createWorld(this.scene, this.camera, this.renderer, apiKey);
    // Google tiles ship baked lighting; tone-mapping them shifts the colors
    this.renderer.toneMapping = this.world.usingTiles
      ? NoToneMapping
      : ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;

    this.scene.add(this.race.group);
    this.uptilt.setFromAxisAngle(
      new Vector3(1, 0, 0),
      MathUtils.degToRad(CAMERA_UPTILT_DEG)
    );

    hud.usingGoogleTiles = this.world.usingTiles;
    hud.gateCount = this.race.gates.length;
    hud.bestLapMs = this.race.bestLapMs;
    hud.phase = "loading";

    this.input.attach();
    window.addEventListener("resize", this.onResize);
    // debug handle (harmless in prod, invaluable in dev tools)
    (window as unknown as { __game?: unknown }).__game = this;

    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.tick);
    // rAF starves in throttled/background tabs — keep the sim ticking regardless
    this.watchdog = window.setInterval(() => {
      if (performance.now() - this.lastTime > 400) {
        cancelAnimationFrame(this.raf);
        this.tick(performance.now());
      }
    }, 250);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.watchdog);
    window.removeEventListener("resize", this.onResize);
    this.input.detach();
    this.world.dispose();
    this.renderer.dispose();
  }

  /* ---------------------------------------------------------------- */

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private groundYAt(x: number, z: number): number | null {
    this.tmpV.set(x, 900, z);
    this.ray.set(this.tmpV, this.down);
    this.ray.far = 2500;
    const hits = this.ray.intersectObjects(this.world.colliders, true);
    return hits.length > 0 ? hits[0].point.y : null;
  }

  private respawn() {
    const gy = this.groundY ?? 0;
    this.tmpV.set(SPAWN_XZ.x, gy + 0.6, SPAWN_XZ.z);
    this.drone.reset(this.tmpV, SPAWN_HEADING);
    this.race.resetRun();
    this.throttleSmoothed = 0;
    this.hud.voltage = 16.8;
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    const frameDt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    const { inputs, events } = this.input.poll(frameDt);
    const hud = this.hud;
    hud.gamepadConnected = this.input.connected;
    hud.gamepadName = this.input.gamepadName;
    hud.tilesLoading = this.world.loading;
    hud.throttlePct = Math.round(inputs.throttle * 100);

    // ---- find the ground before the game can start ----
    if (hud.phase === "loading") {
      this.groundPollAccum += frameDt;
      if (this.groundPollAccum > 0.5) {
        this.groundPollAccum = 0;
        const gy = this.groundYAt(SPAWN_XZ.x, SPAWN_XZ.z);
        if (gy !== null) {
          this.groundY = gy;
          this.race.resolveHeights((x, z) => this.groundYAt(x, z), gy);
          this.respawn();
          hud.phase = "ready";
        }
      }
    } else if (this.world.usingTiles && !this.hasArmedOnce) {
      // terrain LOD keeps refining while we wait on the pad — track it
      this.gateResolveAccum += frameDt;
      if (this.gateResolveAccum > 3) {
        this.gateResolveAccum = 0;
        const gy = this.groundYAt(SPAWN_XZ.x, SPAWN_XZ.z);
        if (gy !== null) {
          this.groundY = gy;
          this.race.resolveHeights((x, z) => this.groundYAt(x, z), gy);
          this.respawn();
        }
      }
    }

    // ---- mode / arm / reset ----
    if (events.toggleMode) {
      hud.mode = hud.mode === "acro" ? ("angle" as FlightMode) : "acro";
    }
    if (events.reset && hud.phase !== "loading") {
      this.respawn();
      hud.phase = "ready";
    }
    if (events.arm) {
      if (hud.phase === "armed") {
        this.respawn();
        hud.phase = "ready";
      } else if (hud.phase === "ready" || hud.phase === "crashed") {
        if (inputs.throttle > 0.1) {
          hud.armHint = "LOWER THROTTLE TO ARM";
          this.hintUntil = now + 2200;
        } else {
          if (hud.phase === "crashed") this.respawn();
          hud.phase = "armed";
          this.hasArmedOnce = true;
          this.armedAtMs = now;
        }
      }
    }
    if (now > this.hintUntil) hud.armHint = "";

    // ---- physics ----
    if (hud.phase === "armed") {
      this.accumulator += frameDt;
      const maxSteps = 60;
      let steps = 0;
      while (this.accumulator >= PHYSICS_DT && steps < maxSteps) {
        this.stepPhysics(PHYSICS_DT, inputs, now);
        this.accumulator -= PHYSICS_DT;
        steps++;
      }
    }

    // ---- camera hard-mounted to the frame, like a real FPV cam ----
    this.camera.position.copy(this.drone.position);
    this.camera.quaternion.copy(this.drone.quaternion).multiply(this.uptilt);

    this.updateHud(now, inputs.throttle);
    this.world.update();
    this.renderer.render(this.scene, this.camera);
  };

  private prevPos = new Vector3();

  private stepPhysics(dt: number, inputs: Parameters<DroneSim["step"]>[1], now: number) {
    this.prevPos.copy(this.drone.position);
    this.drone.step(dt, inputs, this.hud.mode);

    // swept collision ray along the motion vector
    this.tmpV.subVectors(this.drone.position, this.prevPos);
    const dist = this.tmpV.length();
    if (dist > 1e-6) {
      this.ray.set(this.prevPos, this.tmpV.normalize());
      this.ray.far = dist + DRONE_RADIUS;
      const hits = this.ray.intersectObjects(this.world.colliders, true);
      if (hits.length > 0) {
        const speed = this.drone.velocity.length();
        if (speed > CRASH_SPEED) {
          this.hud.phase = "crashed";
          this.drone.velocity.set(0, 0, 0);
          this.drone.angularVelocity.set(0, 0, 0);
          this.drone.position.copy(hits[0].point).addScaledVector(this.tmpV, -DRONE_RADIUS);
          if (this.race.raceActive) this.race.resetRun();
          return;
        }
        // soft touch: settle instead of exploding
        this.drone.position
          .copy(hits[0].point)
          .addScaledVector(this.tmpV, -DRONE_RADIUS);
        this.drone.velocity.set(0, 0, 0);
      }
    }

    // fell through the world (tiles still streaming) — put us back
    if (this.drone.position.y < (this.groundY ?? 0) - 300) {
      this.respawn();
      this.hud.phase = "ready";
      return;
    }

    const lap = this.race.update(this.drone.position, now, dt);
    if (lap) {
      this.hud.lastLapMs = lap.lapMs;
      this.hud.bestLapMs = this.race.bestLapMs;
      this.hud.lapToast = lap.isBest
        ? `LAP ${this.race.formatTime(lap.lapMs)} ★ NEW BEST`
        : `LAP ${this.race.formatTime(lap.lapMs)}`;
      this.hud.lapToastUntil = now + 3500;
    }
  }

  private hudAglAccum = 0;
  private lastAgl = 0;

  private updateHud(now: number, throttle: number) {
    const hud = this.hud;
    hud.speedKmh = Math.round(this.drone.velocity.length() * 3.6);

    this.hudAglAccum += 1;
    if (this.hudAglAccum >= 8) {
      this.hudAglAccum = 0;
      this.tmpV.copy(this.drone.position);
      this.ray.set(this.tmpV, this.down);
      this.ray.far = 500;
      const hits = this.ray.intersectObjects(this.world.colliders, true);
      this.lastAgl =
        hits.length > 0
          ? this.drone.position.y - hits[0].point.y
          : this.drone.position.y - (this.groundY ?? 0);
    }
    hud.altitudeM = Math.max(0, Math.round(this.lastAgl));

    // cosmetic 4S battery: sags with time armed and load
    this.throttleSmoothed += (throttle - this.throttleSmoothed) * 0.02;
    if (hud.phase === "armed") {
      const t = (now - this.armedAtMs) / 1000;
      hud.voltage = Math.max(
        14.2,
        16.8 - 1.6 * (t / 240) - 0.8 * this.throttleSmoothed
      );
    }

    hud.raceActive = this.race.raceActive;
    hud.raceTimeMs = this.race.raceActive ? now - this.race.raceStartMs : 0;
    hud.gateNext = this.race.nextIndex;

    // distance + rough bearing to the next gate for the OSD pointer
    const gate = this.race.gates[this.race.nextIndex];
    this.tmpV.subVectors(gate.position, this.drone.position);
    hud.gateDistanceM = Math.round(this.tmpV.length());
    this.tmpQ.copy(this.camera.quaternion).invert();
    this.tmpV.applyQuaternion(this.tmpQ);
    const angle = Math.atan2(this.tmpV.x, -this.tmpV.z);
    hud.gateBearing = Math.abs(angle) < 0.55 ? 0 : Math.sign(angle);
  }
}
