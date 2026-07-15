import { useEffect, useRef, useState } from "react";

interface Props {
  onDone: () => void;
  ready?: boolean; // true when auth/app finished loading
}

export default function SplashScreen({ onDone, ready = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fading, setFading] = useState(false);
  const doneCalled = useRef(false);
  const readyRef = useRef(ready);
  const videoEndedRef = useRef(false);

  const finish = () => {
    if (doneCalled.current) return;
    doneCalled.current = true;
    setFading(true);
    setTimeout(onDone, 400);
  };

  // Keep readyRef in sync so the video onEnded handler always sees the latest value
  useEffect(() => {
    readyRef.current = ready;
  });

  useEffect(() => {
    const v = videoRef.current;
    // Fallback: force-close after 10s in case video stalls
    const fallback = setTimeout(finish, 10000);

    if (!v) return () => clearTimeout(fallback);

    const onEnded = () => {
      clearTimeout(fallback);
      videoEndedRef.current = true;
      if (readyRef.current) finish(); // auth is already done → close now
      // else: wait for the ready useEffect below to close us
    };
    v.addEventListener("ended", onEnded);

    // If autoplay is blocked → show at least 1 s then close
    v.play().catch(() => {
      clearTimeout(fallback);
      videoEndedRef.current = true;
      setTimeout(finish, 1000);
    });

    return () => { v.removeEventListener("ended", onEnded); clearTimeout(fallback); };
  }, []);

  // Called when auth resolves; only close if the video has already finished
  useEffect(() => {
    if (!ready) return;
    if (videoEndedRef.current) {
      // Video is done, auth is now done too → close smoothly
      const t = setTimeout(finish, 300);
      return () => clearTimeout(t);
    }
    // Video still playing → let it finish; onEnded will call finish()
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
