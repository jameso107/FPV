/**
 * Betaflight-style "classic" rate curve: stick deflection -> deg/s.
 * Defaults give ~670 deg/s at full deflection, the standard racing feel.
 */
export interface RateProfile {
  rcRate: number;
  superRate: number;
  expo: number;
}

export const DEFAULT_RATES: { rollPitch: RateProfile; yaw: RateProfile } = {
  rollPitch: { rcRate: 1.0, superRate: 0.7, expo: 0.2 },
  yaw: { rcRate: 1.0, superRate: 0.65, expo: 0.2 },
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** @param stick -1..1 deflection @returns angular rate in deg/s */
export function applyRates(stick: number, p: RateProfile): number {
  const x = clamp(stick, -1, 1);
  const ax = Math.abs(x);
  // expo bends the curve for finer center control
  const cmd = x * ax * ax * ax * p.expo + x * (1 - p.expo);
  let rcRate = p.rcRate;
  if (rcRate > 2) rcRate += 14.54 * (rcRate - 2);
  let rate = 200 * rcRate * cmd;
  if (p.superRate > 0) {
    rate *= 1 / clamp(1 - Math.abs(cmd) * p.superRate, 0.01, 1);
  }
  return rate;
}
