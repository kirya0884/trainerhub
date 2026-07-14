import { useEffect, useRef, useState } from "react";

interface Props {
  onDone: () => void;
  ready?: boolean; // true when auth/app finished loading
}

export default function SplashScreen({ onDone, ready = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fading, setFading] = useState(false);
  const doneCalled = useRef(false);

  const finish = () => {
    if (doneCalled.current) return;
    doneCalled.current = true;
    setFading(true);
    setTimeout(onDone, 400);
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const fallback = setTimeout(finish, 8000);
    const onEnded = () => { clearTimeout(fallback); finish(); };
    v.addEventListener("ended", onEnded);
    v.play().catch(finish);
    return () => { v.removeEventListener("ended", onEnded); clearTimeout(fallback); };
  }, []);

  // Close 600ms after app signals it is ready (looks smooth)
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(finish, 600);
    return () => clearTimeout(t);
  }, [ready]);

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
        ref={videoRef}
        src="/splash.mp4"
        muted
        playsInline
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
    </div>
  );
}
