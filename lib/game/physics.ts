import { Euler, Quaternion, Vector3 } from "three";
import { ControlInputs, FlightMode } from "./types";
import { applyRates, DEFAULT_RATES } from "./rates";

const DEG2RAD = Math.PI / 180;
const GRAVITY = new Vector3(0, -9.81, 0);

/**
 * 5-inch racing quad simulation.
 * Body frame: -Z forward (matches the camera), +Y up (thrust axis), +X right.
 * Acro: sticks command body angular rates through Betaflight rate curves.
 * Angle: roll/pitch sticks command tilt angle with a P controller; yaw stays
 * rate-based.
 */
export class DroneSim {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly quaternion = new Quaternion();
  /** body-frame angular velocity, rad/s */
  readonly angularVelocity = new Vector3();

  mass = 0.65; // kg, typical 5" freestyle/race build
  maxThrust = 26; // N => thrust-to-weight ~4
  dragK = 0.018; // quadratic drag => ~145 km/h terminal horizontal speed
  angularTau = 0.028; // s, rotational response lag
  maxTiltAngle = 55 * DEG2RAD; // angle mode
  angleP = 9; // angle mode P gain (rad/s per rad of error)

  private tmpQ = new Quaternion();
  private tmpE = new Euler();
  private thrustVec = new Vector3();
  private drag = new Vector3();

  reset(position: Vector3, headingRad: number) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.quaternion.setFromEuler(new Euler(0, headingRad, 0, "YXZ"));
  }

  step(dt: number, inputs: ControlInputs, mode: FlightMode) {
    const w = this.angularVelocity;

    // --- target body rates ---
    let targetX: number, targetZ: number;
    const targetY = -applyRates(inputs.yaw, DEFAULT_RATES.yaw) * DEG2RAD;

    if (mode === "acro") {
      // pitch stick forward => nose down (rotation about -X)
      targetX = -applyRates(inputs.pitch, DEFAULT_RATES.rollPitch) * DEG2RAD;
      // roll stick right => roll right (rotation about -Z)
      targetZ = -applyRates(inputs.roll, DEFAULT_RATES.rollPitch) * DEG2RAD;
    } else {
      // self-leveling: sticks set a target tilt, P controller chases it
      this.tmpE.setFromQuaternion(this.quaternion, "YXZ");
      const targetPitch = -inputs.pitch * this.maxTiltAngle;
      const targetRoll = -inputs.roll * this.maxTiltAngle;
      const maxRate = 600 * DEG2RAD;
      targetX = clamp((targetPitch - this.tmpE.x) * this.angleP, -maxRate, maxRate);
      targetZ = clamp((targetRoll - this.tmpE.z) * this.angleP, -maxRate, maxRate);
    }

    // first-order response toward target rates
    const blend = 1 - Math.exp(-dt / this.angularTau);
    w.x += (targetX - w.x) * blend;
    w.y += (targetY - w.y) * blend;
    w.z += (targetZ - w.z) * blend;

    // integrate orientation (body-frame rates => right-multiply)
    const h = dt / 2;
    this.tmpQ.set(w.x * h, w.y * h, w.z * h, 1);
    this.quaternion.multiply(this.tmpQ).normalize();

    // --- forces ---
    const thrust = this.maxThrust * inputs.throttle;
    this.thrustVec.set(0, thrust, 0).applyQuaternion(this.quaternion);

    const speed = this.velocity.length();
    this.drag.copy(this.velocity).multiplyScalar(-this.dragK * speed);

    // a = thrust/m + g + drag/m
    this.velocity.addScaledVector(this.thrustVec, dt / this.mass);
    this.velocity.addScaledVector(GRAVITY, dt);
    this.velocity.addScaledVector(this.drag, dt / this.mass);

    this.position.addScaledVector(this.velocity, dt);
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
