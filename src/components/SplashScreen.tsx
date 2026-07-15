import { useEffect, useRef, useState } from "react";

interface Props {
  onDone: () => void;
  ready?: boolean;
}

const MIN_MS = 2500;

export default function SplashScreen({ onDone, ready = false }: Props) {
  const [fading, setFading] = useState(false);
  const doneCalled = useRef(false);
  const startRef = useRef(Date.now());

  const finish = () => {
    if (doneCalled.current) return;
    doneCalled.current = true;
    setFading(true);
    setTimeout(onDone, 500);
  };

  useEffect(() => {
    if (!ready) return;
    const elapsed = Date.now() - startRef.current;
    const wait = Math.max(0, MIN_MS - elapsed);
    const t = setTimeout(finish, wait);
    return () => clearTimeout(t);
  }, [ready]);

  useEffect(() => {
    const t = setTimeout(finish, 10000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#04030F",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 0,
        transition: "opacity 0.5s ease",
        opacity: fading ? 0 : 1,
        pointerEvents: fading ? "none" : "all",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
        <img
          src="/icon-512.png"
          alt=""
          style={{ width: 100, height: 100, borderRadius: 22, objectFit: "cover" }}
        />
        <p style={{ color: "#a3e635", fontWeight: 800, fontSize: 22, letterSpacing: "0.1em", margin: 0 }}>REPS</p>
        <Spinner />
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ width: 32, height: 32, position: "relative" }}>
      <svg viewBox="0 0 32 32" style={{ animation: "spin 1s linear infinite", width: 32, height: 32 }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <circle cx="16" cy="16" r="13" fill="none" stroke="#27272a" strokeWidth="3" />
        <circle cx="16" cy="16" r="13" fill="none" stroke="#a3e635" strokeWidth="3"
          strokeDasharray="20 62" strokeLinecap="round" />
      </svg>
    </div>
  );
}
