import { useEffect, useRef, useState } from "react";

interface Props {
  onDone: () => void;
  ready?: boolean; // true when auth + role check resolved
}

const MIN_MS = 2500; // минимальное время показа — даём анимации прокрутиться и данным загрузиться

export default function SplashScreen({ onDone, ready = false }: Props) {
  const [fading, setFading] = useState(false);
  const doneCalled = useRef(false);
  const startRef = useRef(Date.now());

  const finish = () => {
    if (doneCalled.current) return;
    doneCalled.current = true;
    setFading(true);
    setTimeout(onDone, 400);
  };

  // Закрыть когда auth готов И прошло не менее MIN_MS
  useEffect(() => {
    if (!ready) return;
    const elapsed = Date.now() - startRef.current;
    const wait = Math.max(0, MIN_MS - elapsed);
    const t = setTimeout(finish, wait);
    return () => clearTimeout(t);
  }, [ready]);

  // Жёсткий fallback на случай зависания
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
        alignItems: "center",
        justifyContent: "center",
        transition: "opacity 0.4s ease",
        opacity: fading ? 0 : 1,
        pointerEvents: fading ? "none" : "all",
      }}
    >
      <video
        src="/splash.mp4"
        autoPlay
        muted
        loop
        playsInline
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
    </div>
  );
}
