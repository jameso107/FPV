export type FlightMode = "acro" | "angle";

export type GamePhase = "loading" | "ready" | "armed" | "crashed";

/** Normalized pilot inputs. throttle 0..1, others -1..1 (Mode 2). */
export interface ControlInputs {
  throttle: number;
  yaw: number;
  pitch: number;
  roll: number;
}

/** Edge-triggered button events for this frame. */
export interface ButtonEvents {
  arm: boolean;
  reset: boolean;
  toggleMode: boolean;
}

/**
 * Mutable HUD snapshot, written by the game loop every frame and read by
 * the OSD overlay on its own rAF. Avoids React re-render churn at 60fps.
 */
export interface HudState {
  phase: GamePhase;
  mode: FlightMode;
  gamepadConnected: boolean;
  gamepadName: string;
  usingGoogleTiles: boolean;
  tilesLoading: boolean;
  speedKmh: number;
  altitudeM: number;
  voltage: number;
  throttlePct: number;
  raceActive: boolean;
  raceTimeMs: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  gateNext: number;
  gateCount: number;
  gateDistanceM: number;
  /** -1 gate is left of view, 1 right, 0 roughly centered/visible */
  gateBearing: number;
  lapToast: string;
  lapToastUntil: number;
  armHint: string;
}

export function createHudState(): HudState {
  return {
    phase: "loading",
    mode: "acro",
    gamepadConnected: false,
    gamepadName: "",
    usingGoogleTiles: false,
    tilesLoading: false,
    speedKmh: 0,
    altitudeM: 0,
    voltage: 16.8,
    throttlePct: 0,
    raceActive: false,
    raceTimeMs: 0,
    lastLapMs: null,
    bestLapMs: null,
    gateNext: 0,
    gateCount: 0,
    gateDistanceM: 0,
    gateBearing: 0,
    lapToast: "",
    lapToastUntil: 0,
    armHint: "",
  };
}
