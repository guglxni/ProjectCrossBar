import { useEffect, useRef } from "react";
import { HERO_VIDEO_URL } from "@/lib/constants";

const FADE_SEC = 0.5;

export function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let frame = 0;

    const tick = () => {
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const t = video.currentTime;
      let opacity = 1;
      if (t < FADE_SEC) {
        opacity = t / FADE_SEC;
      } else if (t > duration - FADE_SEC) {
        opacity = Math.max(0, (duration - t) / FADE_SEC);
      }
      video.style.opacity = String(opacity);
      frame = requestAnimationFrame(tick);
    };

    const onEnded = () => {
      video.style.opacity = "0";
      window.setTimeout(() => {
        video.currentTime = 0;
        void video.play();
      }, 100);
    };

    video.addEventListener("ended", onEnded);
    frame = requestAnimationFrame(tick);
    void video.play().catch(() => undefined);

    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener("ended", onEnded);
    };
  }, []);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-0"
      style={{ top: 300, bottom: 0 }}
    >
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        style={{ opacity: 0 }}
        src={HERO_VIDEO_URL}
        muted
        playsInline
        preload="auto"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background" />
    </div>
  );
}
