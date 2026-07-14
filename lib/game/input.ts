import { ControlInputs, ButtonEvents } from "./types";

const DEADZONE = 0.06;

function dz(v: number): number {
  const a = Math.abs(v);
  if (a < DEADZONE) return 0;
  return (Math.sign(v) * (a - DEADZONE)) / (1 - DEADZONE);
}

/**
 * Reads a Bluetooth/USB gamepad (Xbox layout) via the Gamepad API with a
 * keyboard fallback. Mode 2 mapping:
 *   left stick  : throttle (vert) / yaw (horiz)
 *   right stick : pitch (vert) / roll (horiz)
 *   A = arm/disarm, B = reset, Y = toggle acro/angle
 * Keyboard: W/S throttle, A/D yaw, arrows pitch/roll, Enter arm, R reset,
 * M mode.
 */
export class InputManager {
  connected = false;
  gamepadName = "";

  private keys = new Set<string>();
  private prevButtons: boolean[] = [];
  private kb: ControlInputs = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
  private kbEvents: ButtonEvents = { arm: false, reset: false, toggleMode: false };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === "Enter") this.kbEvents.arm = true;
    if (e.code === "KeyR") this.kbEvents.reset = true;
    if (e.code === "KeyM") this.kbEvents.toggleMode = true;
    if (
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
        e.code
      )
    ) {
      e.preventDefault();
    }
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);

  attach() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  detach() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  /** Poll once per frame. Returns inputs plus edge-triggered buttons. */
  poll(dt: number): { inputs: ControlInputs; events: ButtonEvents } {
    const pads = typeof navigator !== "undefined" && navigator.getGamepads
      ? navigator.getGamepads()
      : [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected && p.axes.length >= 4) {
        pad = p;
        break;
      }
    }

    if (pad) {
      this.connected = true;
      this.gamepadName = pad.id.slice(0, 24);
      // keyboard buttons stay live alongside the pad so Enter/R/M always work
      const events = this.takeKbEvents();
      const pressed = pad.buttons.map((b) => b.pressed);
      const edge = (i: number) => pressed[i] && !this.prevButtons[i];
      if (edge(0)) events.arm = true; // A
      if (edge(1)) events.reset = true; // B
      if (edge(3)) events.toggleMode = true; // Y
      this.prevButtons = pressed;

      const rawThrottle = (-pad.axes[1] + 1) / 2; // stick down = 0
      // gamepad sticks self-center: squaring the input puts stick-center
      // (0.5 -> 0.25) right at this quad's hover point instead of a climb
      const curved = rawThrottle * rawThrottle;
      const inputs: ControlInputs = {
        throttle: rawThrottle < 0.03 ? 0 : Math.min(1, curved),
        yaw: dz(pad.axes[0]),
        pitch: dz(-pad.axes[3]), // push forward = pitch forward
        roll: dz(pad.axes[2]),
      };
      return { inputs, events };
    }

    this.connected = false;
    return { inputs: this.pollKeyboard(dt), events: this.takeKbEvents() };
  }

  private takeKbEvents(): ButtonEvents {
    const e = this.kbEvents;
    this.kbEvents = { arm: false, reset: false, toggleMode: false };
    return e;
  }

  private pollKeyboard(dt: number): ControlInputs {
    const k = this.kb;
    const has = (c: string) => this.keys.has(c);
    const ramp = (cur: number, target: number, speed: number) => {
      if (cur < target) return Math.min(target, cur + speed * dt);
      return Math.max(target, cur - speed * dt);
    };

    // throttle: W up / S down, holds its value like a real throttle stick
    if (has("KeyW")) k.throttle = Math.min(1, k.throttle + 0.9 * dt);
    if (has("KeyS")) k.throttle = Math.max(0, k.throttle - 1.2 * dt);

    k.yaw = ramp(k.yaw, has("KeyA") ? -1 : has("KeyD") ? 1 : 0, 4);
    k.pitch = ramp(k.pitch, has("ArrowUp") ? 1 : has("ArrowDown") ? -1 : 0, 3.5);
    k.roll = ramp(k.roll, has("ArrowLeft") ? -1 : has("ArrowRight") ? 1 : 0, 3.5);

    return { ...k };
  }
}
