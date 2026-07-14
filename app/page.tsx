"use client";

import dynamic from "next/dynamic";

const GameCanvas = dynamic(() => import("@/components/GameCanvas"), {
  ssr: false,
  loading: () => (
    <div className="boot-splash">
      <span>LA FPV</span>
      <small>INITIALIZING…</small>
    </div>
  ),
});

export default function Home() {
  return <GameCanvas />;
}
