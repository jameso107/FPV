import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  Group,
  MathUtils,
  Mesh,
  MeshLambertMaterial,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { TilesRenderer } from "3d-tiles-renderer";
import {
  GoogleCloudAuthPlugin,
  GLTFExtensionsPlugin,
  TilesFadePlugin,
} from "3d-tiles-renderer/plugins";
import { COURSE } from "./course";

/** Grand Park, downtown Los Angeles — spawn/origin of the local frame. */
export const ORIGIN_LAT = 34.0563;
export const ORIGIN_LON = -118.244;

export interface World {
  colliders: Object3D[];
  usingTiles: boolean;
  loading: boolean;
  update(): void;
  dispose(): void;
}

export function createWorld(
  scene: Scene,
  camera: PerspectiveCamera,
  renderer: WebGLRenderer,
  apiKey: string | undefined
): World {
  addSkyAndLights(scene, renderer, !!apiKey);
  if (apiKey) {
    try {
      return createGoogleTilesWorld(scene, camera, renderer, apiKey);
    } catch (err) {
      console.error("Google 3D Tiles init failed, using fallback city:", err);
    }
  }
  return createFallbackCity(scene);
}

/* ------------------------------------------------------------------ */
/* Photorealistic Los Angeles via Google Map Tiles                     */
/* ------------------------------------------------------------------ */

function createGoogleTilesWorld(
  scene: Scene,
  camera: PerspectiveCamera,
  renderer: WebGLRenderer,
  apiKey: string
): World {
  const tiles = new TilesRenderer();
  tiles.registerPlugin(
    new GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true })
  );

  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(
    "https://www.gstatic.com/draco/versioned/decoders/1.5.7/"
  );
  tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader }));
  tiles.registerPlugin(new TilesFadePlugin());

  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);
  tiles.errorTarget = 20; // lower = sharper, higher = faster

  // Rotate the globe so our lat/lon sits at the origin with +Y up.
  const anyTiles = tiles as unknown as {
    setLatLonToYUp?: (lat: number, lon: number) => void;
  };
  if (typeof anyTiles.setLatLonToYUp === "function") {
    anyTiles.setLatLonToYUp(
      ORIGIN_LAT * MathUtils.DEG2RAD,
      ORIGIN_LON * MathUtils.DEG2RAD
    );
  }

  scene.add(tiles.group);

  const world: World = {
    colliders: [tiles.group],
    usingTiles: true,
    loading: true,
    update() {
      camera.updateMatrixWorld();
      tiles.update();
      const stats = tiles as unknown as { loadProgress?: number };
      if (typeof stats.loadProgress === "number") {
        world.loading = stats.loadProgress < 1;
      }
    },
    dispose() {
      scene.remove(tiles.group);
      tiles.dispose();
      dracoLoader.dispose();
    },
  };

  tiles.addEventListener("load-tile-set", () => {
    world.loading = false;
  });

  return world;
}

/* ------------------------------------------------------------------ */
/* Procedural stand-in city (no API key needed)                        */
/* ------------------------------------------------------------------ */

/** deterministic PRNG so the city (and course clearance) never shifts */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createFallbackCity(scene: Scene): World {
  const group = new Group();
  const rand = mulberry32(20260713);

  // asphalt ground with a street grid painted on
  const ground = new Mesh(
    new PlaneGeometry(6000, 6000),
    new MeshLambertMaterial({ map: makeStreetTexture(), color: 0xffffff })
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  const palette = [0x8f9aa6, 0x7a8894, 0xa9b2ba, 0x6d7b88, 0xbfc7cd, 0x95867a];
  const geo = new BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0); // grow upward from the ground

  const isNearCourse = (x: number, z: number) => {
    for (const g of COURSE) {
      const dx = x - g.x;
      const dz = z - g.z;
      if (dx * dx + dz * dz < 80 * 80) return true;
    }
    return false;
  };

  const BLOCK = 90;
  const HALF = 22; // 45x45 blocks => ~4km of city
  for (let ix = -HALF; ix <= HALF; ix++) {
    for (let iz = -HALF; iz <= HALF; iz++) {
      const cx = ix * BLOCK + (rand() - 0.5) * 24;
      const cz = iz * BLOCK + (rand() - 0.5) * 24;
      if (rand() < 0.18) continue; // empty lots

      const nearCourse = isNearCourse(cx, cz);
      // towers rise with distance from spawn, LA-downtown style,
      // but stay low along the race corridor
      const dist = Math.hypot(cx, cz);
      const maxH = nearCourse ? 10 : dist < 500 ? 60 : dist < 1200 ? 160 : 90;
      const h = 8 + rand() * maxH;
      const w = 18 + rand() * 34;
      const d = 18 + rand() * 34;

      const mat = new MeshLambertMaterial({
        color: palette[Math.floor(rand() * palette.length)],
      });
      const b = new Mesh(geo, mat);
      b.position.set(cx, 0, cz);
      b.scale.set(w, h, d);
      group.add(b);
    }
  }

  // a handful of glowing "landmark" towers on the skyline for orientation
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = 700 + rand() * 500;
    const t = new Mesh(
      geo,
      new MeshBasicMaterial({ color: new Color().setHSL(0.55 + i * 0.05, 0.5, 0.35) })
    );
    t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    t.scale.set(40, 180 + rand() * 120, 40);
    group.add(t);
  }

  scene.add(group);

  return {
    colliders: [group],
    usingTiles: false,
    loading: false,
    update() {},
    dispose() {
      scene.remove(group);
      ground.material.map?.dispose();
      geo.dispose();
    },
  };
}

function makeStreetTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#3a3d40";
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = "#585d61";
  ctx.lineWidth = 22;
  for (let i = 0; i <= 512; i += 128) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }
  ctx.strokeStyle = "#c9c94f";
  ctx.lineWidth = 2;
  ctx.setLineDash([14, 12]);
  for (let i = 0; i <= 512; i += 128) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(46, 46);
  tex.anisotropy = 4;
  return tex;
}

/* ------------------------------------------------------------------ */

function addSkyAndLights(
  scene: Scene,
  renderer: WebGLRenderer,
  usingTiles: boolean
) {
  const sky = new Sky();
  sky.scale.setScalar(45000);
  const u = sky.material.uniforms;
  u["turbidity"].value = 8; // LA haze
  u["rayleigh"].value = 1.6;
  u["mieCoefficient"].value = 0.015;
  u["mieDirectionalG"].value = 0.85;
  const sunDir = new Vector3().setFromSphericalCoords(
    1,
    MathUtils.degToRad(90 - 24), // late-afternoon sun
    MathUtils.degToRad(230)
  );
  u["sunPosition"].value.copy(sunDir);
  scene.add(sky);

  scene.fog = new Fog(0xcfd8e0, 900, 8000);

  const sun = new DirectionalLight(0xfff2dd, 2.4);
  sun.position.copy(sunDir).multiplyScalar(1000);
  scene.add(sun);
  scene.add(new AmbientLight(0x8899bb, usingTiles ? 0.6 : 1.1));
}
