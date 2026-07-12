import { useEffect, useRef, useState } from "react";

interface Props {
  onDone: () => void;
}

export default function SplashScreen({ onDone }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fading, setFading] = useState(false);

  const finish = () => {
    setFading(true);
    setTimeout(onDone, 400); // wait for fade-out
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    // Fallback: если видео не стартовало через 3с — пропускаем
    const fallback = setTimeout(finish, 3000);

    const onEnded = () => {
      clearTimeout(fallback);
      finish();
    };

    v.addEventListener("ended", onEnded);
    v.play().catch(finish); // autoplay blocked → skip

    return () => {
      v.removeEventListener("ended", onEnded);
      clearTimeout(fallback);
    };
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
        ref={videoRef}
        src="/splash.mp4"
        muted
        playsInline
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </div>
  );
}
