# LA FPV — Los Angeles Drone Racing Simulator

Browser-based FPV drone racing sim. Fly a simulated 5-inch racing quad through
downtown Los Angeles — through Google's photorealistic 3D scan of the real
city — with a Bluetooth Xbox controller.

## Features

- **Real Los Angeles** — streams Google Photorealistic 3D Tiles of the Grand
  Park / City Hall area of downtown LA. No API key? The game falls back to a
  procedural stand-in city so it's always playable.
- **Real flight physics** — Betaflight-style rate curves, thrust-to-weight ~4,
  quadratic drag (~145 km/h top speed), 240 Hz physics.
- **Acro + Angle modes** — true rate-mode for building real FPV muscle memory,
  self-leveling angle mode for warming up. Toggle with `Y` / `M`.
- **Gate racing** — a ~1.1 km circuit of glowing gates with a lap timer; best
  lap is saved locally. Fly through the pink gate to start the clock.
- **Betaflight-style OSD** — crosshair, battery voltage, throttle, speed,
  altitude, gate tracker, lap/best times.

## Controls (Mode 2)

| Action        | Xbox controller     | Keyboard    |
| ------------- | ------------------- | ----------- |
| Throttle      | Left stick vertical | W / S       |
| Yaw           | Left stick horiz    | A / D       |
| Pitch         | Right stick vert    | ↑ / ↓       |
| Roll          | Right stick horiz   | ← / →       |
| Arm / disarm  | A                   | Enter       |
| Reset run     | B                   | R           |
| Acro ⇄ Angle  | Y                   | M           |

**Pairing an Xbox controller (macOS):** hold the pair button on top of the
controller until the Xbox logo flashes fast, then System Settings → Bluetooth
→ connect. Open the game in Chrome and press any button — the OSD shows
`● GAMEPAD` when detected. Throttle is the left stick: full down = motors idle.

## Run locally

```bash
npm install
cp .env.local.example .env.local   # then paste your key (optional but recommended)
npm run dev
```

Open http://localhost:3000.

## Getting the photorealistic LA (Google API key)

1. Go to the [Google Cloud Console](https://console.cloud.google.com/google/maps-apis)
   and create/select a project (billing enabled — there is a substantial free
   monthly tier).
2. Enable the **Map Tiles API**.
3. Create an API key and (recommended) restrict it to the Map Tiles API and to
   your domains (`localhost:3000`, your `*.vercel.app` domain).
4. Put it in `.env.local` as `NEXT_PUBLIC_GOOGLE_TILES_KEY=...`

## Deploy to Vercel

1. Push this repo to GitHub.
2. On [vercel.com](https://vercel.com) → **Add New → Project** → import the
   `FPV` repo. Framework auto-detects as Next.js; no settings needed.
3. Under **Environment Variables**, add `NEXT_PUBLIC_GOOGLE_TILES_KEY` with
   your key.
4. Deploy. Add your production URL to the API key's referrer allowlist.

## Tuning the feel

- Rates (RC rate / super rate / expo): `lib/game/rates.ts`
- Quad mass, thrust, drag, angle-mode tilt: `lib/game/physics.ts`
- Camera uptilt & FOV, crash speed threshold: `lib/game/game.ts`
- Course layout (gate positions/heights/headings): `lib/game/course.ts`
- Spawn location in the real world: `ORIGIN_LAT` / `ORIGIN_LON` in
  `lib/game/world.ts` — point it anywhere on Earth and the course comes along.
