import { useEffect, useRef, useState } from "react";
import { parseYouTubeId, parseYouTubeStart } from "@/lib/youtube";

// Loads the YouTube IFrame API once and resolves when ready.
let ytReady: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve) => {
    const w = window as unknown as { YT?: { Player: unknown }; onYouTubeIframeAPIReady?: () => void };
    if (w.YT && w.YT.Player) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.head.appendChild(script);
    w.onYouTubeIframeAPIReady = () => resolve();
  });
  return ytReady;
}

type Player = {
  playVideo: () => void;
  pauseVideo: () => void;
  getPlayerState: () => number;
  destroy: () => void;
};

export type YouTubePlayerHandle = {
  toggle: () => void;
  play: () => void;
  pause: () => void;
};

export function YouTubeSlide({
  url,
  registerHandle,
  autoplay = false,
}: {
  url: string;
  autoplay?: boolean;
  registerHandle?: (h: YouTubePlayerHandle | null) => void;
}) {
  const id = parseYouTubeId(url);
  const start = parseYouTubeStart(url);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<Player | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !containerRef.current) {
      setErr("Could not read a YouTube video ID from that URL.");
      return;
    }
    let cancelled = false;
    let player: Player | null = null;

    loadYouTubeApi().then(() => {
      if (cancelled || !containerRef.current) return;
      const w = window as unknown as {
        YT: {
          Player: new (
            el: HTMLElement,
            opts: Record<string, unknown>,
          ) => Player;
          PlayerState: { PLAYING: number };
        };
      };
      const div = document.createElement("div");
      containerRef.current.innerHTML = "";
      containerRef.current.appendChild(div);
      player = new w.YT.Player(div, {
        videoId: id,
        width: "100%",
        height: "100%",
        playerVars: {
          start,
          autoplay: autoplay ? 1 : 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
        },
        events: {
          onReady: () => {
            playerRef.current = player;
            registerHandle?.({
              toggle: () => {
                if (!playerRef.current) return;
                const state = playerRef.current.getPlayerState();
                if (state === 1) playerRef.current.pauseVideo();
                else playerRef.current.playVideo();
              },
              play: () => playerRef.current?.playVideo(),
              pause: () => playerRef.current?.pauseVideo(),
            });
          },
        },
      });
    });

    return () => {
      cancelled = true;
      registerHandle?.(null);
      try {
        player?.destroy();
      } catch {
        /* ignore */
      }
    };
  }, [id, start, autoplay, registerHandle]);

  if (err) return <div className="text-destructive">{err}</div>;
  return (
    <div className="h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
