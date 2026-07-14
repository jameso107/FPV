"use client";

import { useEffect, useRef } from "react";
import { createHudState } from "@/lib/game/types";

function fmt(ms: number | null): string {
  if (ms === null) return "--:--.--";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const osdRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef(createHudState());

  useEffect(() => {
    let disposed = false;
    let game: { dispose(): void } | null = null;
    const hud = hudRef.current;

    (async () => {
      const { FpvGame } = await import("@/lib/game/game");
      if (disposed || !canvasRef.current) return;
      game = new FpvGame(
        canvasRef.current,
        hud,
        process.env.NEXT_PUBLIC_GOOGLE_TILES_KEY || undefined
      );
    })();

    // OSD renders on its own rAF, straight to the DOM — no React churn
    const root = osdRef.current!;
    const el = new Map<string, HTMLElement>();
    root.querySelectorAll<HTMLElement>("[data-osd]").forEach((n) => {
      el.set(n.dataset.osd!, n);
    });
    const set = (k: string, v: string) => {
      const n = el.get(k);
      if (n && n.textContent !== v) n.textContent = v;
    };
    const show = (k: string, on: boolean) => {
      el.get(k)?.classList.toggle("hidden", !on);
    };

    let osdRaf = 0;
    const drawOsd = () => {
      osdRaf = requestAnimationFrame(drawOsd);
      const now = performance.now();

      set("mode", hud.mode.toUpperCase());
      set(
        "armed",
        hud.phase === "armed"
          ? "ARMED"
          : hud.phase === "crashed"
            ? "CRASH"
            : "DISARMED"
      );
      el.get("armed")?.classList.toggle("osd-crash", hud.phase === "crashed");
      set("gpad", hud.gamepadConnected ? "● GAMEPAD" : "○ KEYBOARD");
      set("volt", `${hud.voltage.toFixed(1)}V`);
      set("thr", `THR ${String(hud.throttlePct).padStart(3, " ")}%`);
      set("speed", `${hud.speedKmh} KM/H`);
      set("alt", `${hud.altitudeM}M`);
      set("gate", `GATE ${hud.gateNext + 1}/${hud.gateCount}`);
      set(
        "gatedist",
        `${hud.gateBearing < 0 ? "◄ " : ""}⬦ ${hud.gateDistanceM}M${hud.gateBearing > 0 ? " ►" : ""}`
      );
      set("time", hud.raceActive ? fmt(hud.raceTimeMs) : "00:00.00");
      set("best", `BEST ${fmt(hud.bestLapMs)}`);
      set("hint", hud.armHint);

      const toastOn = now < hud.lapToastUntil && hud.lapToast !== "";
      show("toast", toastOn);
      if (toastOn) set("toast", hud.lapToast);

      show("loading", hud.phase === "loading");
      show("streaming", hud.phase !== "loading" && hud.tilesLoading);
      show("start", hud.phase === "ready");
      show("crashed", hud.phase === "crashed");
      show("osd", hud.phase === "armed" || hud.phase === "crashed");
      show("attrib", hud.usingGoogleTiles);
      show("fallback-note", !hud.usingGoogleTiles && hud.phase === "ready");
      set(
        "world-status",
        hud.usingGoogleTiles
          ? "WORLD: PHOTOREAL LOS ANGELES (GOOGLE 3D TILES)"
          : "WORLD: PROCEDURAL LA (NO API KEY)"
      );
      set(
        "pad-status",
        hud.gamepadConnected
          ? `CONTROLLER: ${hud.gamepadName.toUpperCase()}`
          : "CONTROLLER: NOT DETECTED — PRESS ANY BUTTON, OR USE KEYBOARD"
      );
      set(
        "arm-prompt",
        hud.gamepadConnected
          ? "HOLD LEFT STICK FULLY DOWN + PRESS A TO ARM"
          : "PRESS A / ENTER TO ARM"
      );
    };
    osdRaf = requestAnimationFrame(drawOsd);

    return () => {
      disposed = true;
      cancelAnimationFrame(osdRaf);
      game?.dispose();
    };
  }, []);

  return (
    <div className="game-root">
      <canvas ref={canvasRef} />
      <div className="osd-root" ref={osdRef}>
        {/* in-goggles OSD */}
        <div data-osd="osd" className="hidden">
          <div className="crosshair" />
          <div className="osd osd-tl" data-osd="mode">ACRO</div>
          <div className="osd osd-tc" data-osd="armed">DISARMED</div>
          <div className="osd osd-tr" data-osd="gpad">KEYBOARD</div>
          <div className="osd osd-tc2" data-osd="gate">GATE 1/10</div>
          <div className="osd osd-gate" data-osd="gatedist">0M</div>
          <div className="osd osd-bl" data-osd="volt">16.8V</div>
          <div className="osd osd-bl2" data-osd="thr">THR 0%</div>
          <div className="osd osd-bc" data-osd="time">00:00.00</div>
          <div className="osd osd-bc2" data-osd="best">BEST --:--.--</div>
          <div className="osd osd-br" data-osd="alt">0M</div>
          <div className="osd osd-br2" data-osd="speed">0 KM/H</div>
          <div className="osd osd-toast hidden" data-osd="toast"></div>
        </div>

        {/* arm warnings live outside the OSD wrapper so they also show pre-arm */}
        <div className="osd osd-hint" data-osd="hint"></div>

        {/* boot / ground-finding */}
        <div data-osd="loading" className="overlay">
          <h1>LA FPV</h1>
          <p className="blink">LOCATING LAUNCH PAD — STREAMING TERRAIN…</p>
        </div>

        {/* pre-arm menu */}
        <div data-osd="start" className="overlay hidden">
          <h1>LA FPV</h1>
          <p className="sub">LOS ANGELES DRONE RACING SIMULATOR</p>
          <p data-osd="world-status" className="dim"></p>
          <p data-osd="pad-status" className="dim"></p>
          <div data-osd="fallback-note" className="note hidden">
            Add a Google Maps API key (NEXT_PUBLIC_GOOGLE_TILES_KEY) to fly
            the photorealistic scan of real Los Angeles — see README.
          </div>
          <table className="controls">
            <tbody>
              <tr><td>THROTTLE / YAW</td><td>LEFT STICK</td><td>W,S / A,D</td></tr>
              <tr><td>PITCH / ROLL</td><td>RIGHT STICK</td><td>ARROW KEYS</td></tr>
              <tr><td>ARM / DISARM</td><td>A BUTTON</td><td>ENTER</td></tr>
              <tr><td>RESET</td><td>B BUTTON</td><td>R</td></tr>
              <tr><td>ACRO / ANGLE</td><td>Y BUTTON</td><td>M</td></tr>
            </tbody>
          </table>
          <p className="blink big" data-osd="arm-prompt">PRESS A / ENTER TO ARM</p>
          <p className="dim">
            fly through the pink gate to start the clock — hit all gates in
            order
          </p>
        </div>

        {/* crash screen */}
        <div data-osd="crashed" className="overlay overlay-crash hidden">
          <h1 className="crash-title">CRASHED</h1>
          <p className="blink big">PRESS A / ENTER TO REARM</p>
        </div>

        <div data-osd="streaming" className="stream-note hidden">
          STREAMING LA TILES…
        </div>
        <div data-osd="attrib" className="attrib hidden">
          Map data ©2026 Google
        </div>
      </div>
    </div>
  );
}
