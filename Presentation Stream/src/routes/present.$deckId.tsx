import { createFileRoute, redirect, useParams, useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getDeck } from "@/lib/decks.functions";
import { YouTubeSlide, type YouTubePlayerHandle } from "@/components/presenter/youtube-slide";
import { PdfSlide } from "@/components/presenter/pdf-slide";
import { DocxSlide } from "@/components/presenter/docx-slide";
import { AgendaTransition, type AgendaItem } from "@/components/presenter/agenda-transition";
import { AgendaOverview } from "@/components/presenter/agenda-overview";
import { Button } from "@/components/ui/button";
import { X, ExternalLink, ChevronLeft, ChevronRight, Lock, Unlock, List, MonitorSpeaker } from "lucide-react";
import { openChannel, type PresenterMessage, type PresenterState, type StepSummary } from "@/lib/presenter-sync";

const searchSchema = z.object({
  i: z.coerce.number().int().min(0).optional(),
  p: z.coerce.number().int().min(1).optional(),
});

export const Route = createFileRoute("/present/$deckId")({
  ssr: false,
  validateSearch: searchSchema,
  head: () => ({
    meta: [{ title: "Presenting — SAU Meeting Presenter" }],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: Presenter,
});

type Slide = {
  id: string;
  kind: "youtube" | "pdf" | "image" | "text" | "website" | "docx";
  title: string | null;
  payload: Record<string, unknown>;
  storage_path: string | null;
  agenda_item_id: string | null;
};

type Step =
  | { kind: "transition"; agenda: AgendaItem; previousLabel: string; agendaIndex: number }
  | { kind: "slide"; slide: Slide; agenda: AgendaItem | null; agendaIndex: number | null };

function Presenter() {
  const { deckId } = useParams({ from: "/present/$deckId" });
  const search = useSearch({ from: "/present/$deckId" });
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const get = useServerFn(getDeck);
  const deckQ = useQuery({
    queryKey: ["deck-present", deckId],
    queryFn: () => get({ data: { id: deckId } }),
    enabled: !!session,
  });

  const slides = (deckQ.data?.slides ?? []) as Slide[];
  const signedUrls = deckQ.data?.signedUrls ?? {};
  const agenda = (deckQ.data?.agenda ?? []) as AgendaItem[];
  const deckTitle = deckQ.data?.deck.title ?? "";

  // Build ordered playlist: for each agenda item -> [transition, ...its slides],
  // followed by unassigned slides (no transition).
  const steps = useMemo<Step[]>(() => {
    const out: Step[] = [];
    const slidesByAgenda = new Map<string | null, Slide[]>();
    // slides arrive ordered by `position` (deck-wide); preserve that order
    for (const s of slides) {
      const k = s.agenda_item_id;
      if (!slidesByAgenda.has(k)) slidesByAgenda.set(k, []);
      slidesByAgenda.get(k)!.push(s);
    }


    let prevLabel = deckTitle || "Welcome";
    agenda.forEach((a, idx) => {
      out.push({ kind: "transition", agenda: a, previousLabel: prevLabel, agendaIndex: idx });
      const groupSlides = slidesByAgenda.get(a.id) ?? [];
      for (const s of groupSlides) {
        out.push({ kind: "slide", slide: s, agenda: a, agendaIndex: idx });
      }
      prevLabel = a.title;
    });
    const unassigned = slidesByAgenda.get(null) ?? [];
    for (const s of unassigned) {
      out.push({ kind: "slide", slide: s, agenda: null, agendaIndex: null });
    }
    return out;
  }, [slides, agenda, deckTitle]);

  const i = Math.min(Math.max(search.i ?? 0, 0), Math.max(steps.length - 1, 0));
  const page = search.p ?? 1;

  const [pdfTotals, setPdfTotals] = useState<Record<string, number>>({});
  const ytHandle = useRef<YouTubePlayerHandle | null>(null);

  const setIndex = useCallback(
    (next: number, nextPage?: number) => {
      const clamped = Math.min(Math.max(next, 0), Math.max(steps.length - 1, 0));
      navigate({
        to: "/present/$deckId",
        params: { deckId },
        search: { i: clamped, ...(nextPage ? { p: nextPage } : {}) },
        replace: true,
      });
    },
    [navigate, deckId, steps.length],
  );

  const current = steps[i];
  const currentSlide = current?.kind === "slide" ? current.slide : null;
  const totalPdfPages = currentSlide?.kind === "pdf" ? pdfTotals[currentSlide.id] ?? 1 : 1;

  // Cursor auto-hide
  const [cursorVisible, setCursorVisible] = useState(true);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    function onMove() {
      setCursorVisible(true);
      clearTimeout(t);
      t = setTimeout(() => setCursorVisible(false), 2000);
    }
    window.addEventListener("mousemove", onMove);
    onMove();
    return () => {
      window.removeEventListener("mousemove", onMove);
      clearTimeout(t);
    };
  }, []);

  // Try fullscreen on mount
  useEffect(() => {
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  const [blank, setBlank] = useState(false);
  const [siteInteractive, setSiteInteractive] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  useEffect(() => {
    setSiteInteractive(false);
  }, [i]);

  // Jump to first slide for an agenda item from overview
  const jumpToAgenda = useCallback(
    (agendaId: string) => {
      const idx = steps.findIndex((s) => s.kind === "transition" && s.agenda.id === agendaId);
      if (idx >= 0) {
        setIndex(idx);
        setOverviewOpen(false);
      }
    },
    [steps, setIndex],
  );

  // Slide counts per agenda for overview
  const slideCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of slides) {
      if (s.agenda_item_id) m[s.agenda_item_id] = (m[s.agenda_item_id] ?? 0) + 1;
    }
    return m;
  }, [slides]);

  const goNext = useCallback(() => {
    if (!current) return;
    if (currentSlide?.kind === "pdf" && page < totalPdfPages) {
      setIndex(i, page + 1);
      return;
    }
    if (i < steps.length - 1) {
      const nextStep = steps[i + 1];
      const nextPage = nextStep.kind === "slide" && nextStep.slide.kind === "pdf" ? 1 : undefined;
      setIndex(i + 1, nextPage);
    }
  }, [current, currentSlide, page, totalPdfPages, i, steps, setIndex]);

  const goPrev = useCallback(() => {
    if (!current) return;
    if (currentSlide?.kind === "pdf" && page > 1) {
      setIndex(i, page - 1);
      return;
    }
    if (i > 0) {
      const target = steps[i - 1];
      if (target.kind === "slide" && target.slide.kind === "pdf") {
        setIndex(i - 1, pdfTotals[target.slide.id] ?? 1);
      } else {
        setIndex(i - 1);
      }
    }
  }, [current, currentSlide, page, i, steps, pdfTotals, setIndex]);

  // Keyboard handler (capture phase)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

      const reserved =
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "PageUp" ||
        e.key === "PageDown" ||
        e.key === "Home" ||
        e.key === "End" ||
        e.key === "Escape" ||
        e.key === " " ||
        e.key === "b" ||
        e.key === "B" ||
        e.key === "Tab" ||
        e.key === ".";

      if (reserved) {
        e.preventDefault();
        e.stopPropagation();
      }

      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
          goNext();
          break;
        case "ArrowLeft":
        case "PageUp":
          goPrev();
          break;
        case "Home":
          setIndex(0);
          break;
        case "End":
          setIndex(steps.length - 1);
          break;
        case " ":
        case "k":
        case "K":
          if (currentSlide?.kind === "youtube" && ytHandle.current) ytHandle.current.toggle();
          break;
        case "b":
        case "B":
          setBlank((v) => !v);
          break;
        case "Tab":
        case ".":
          setOverviewOpen((v) => !v);
          break;
        case "Escape":
          if (overviewOpen) {
            setOverviewOpen(false);
          } else {
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            navigate({ to: "/decks/$deckId", params: { deckId } });
          }
          break;
      }
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [goNext, goPrev, currentSlide, setIndex, steps.length, deckId, navigate, overviewOpen]);

  // ---- Presenter-window sync (BroadcastChannel) ----
  const channelRef = useRef<BroadcastChannel | null>(null);
  const broadcastStateRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const ch = openChannel(deckId);
    channelRef.current = ch;
    ch.onmessage = (e) => {
      const msg = e.data as PresenterMessage;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "next") goNext();
      else if (msg.type === "prev") goPrev();
      else if (msg.type === "goto") setIndex(msg.i, msg.page);
      else if (msg.type === "toggle-blank") setBlank((v) => !v);
      else if (msg.type === "hello") broadcastStateRef.current?.();
    };
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, [deckId, goNext, goPrev, setIndex]);

  const agendaStepIndex = useMemo(() => {
    const m: Record<string, number> = {};
    steps.forEach((s, idx) => {
      if (s.kind === "transition" && !(s.agenda.id in m)) m[s.agenda.id] = idx;
    });
    return m;
  }, [steps]);

  const summarize = useCallback((s: Step | undefined): StepSummary | null => {
    if (!s) return null;
    if (s.kind === "transition") {
      return {
        kind: "transition",
        slideKind: null,
        title: s.agenda.title,
        agendaTitle: s.agenda.title,
        agendaIndex: s.agendaIndex,
      };
    }
    return {
      kind: "slide",
      slideKind: s.slide.kind,
      title: s.slide.title ?? s.slide.kind,
      agendaTitle: s.agenda?.title ?? null,
      agendaIndex: s.agendaIndex,
    };
  }, []);

  useEffect(() => {
    function send() {
      const ch = channelRef.current;
      if (!ch) return;
      const state: PresenterState = {
        deckTitle,
        i,
        totalSteps: steps.length,
        page,
        totalPdfPages,
        blank,
        current: summarize(steps[i]),
        next: summarize(steps[i + 1]),
        agenda: agenda.map((a) => ({ id: a.id, title: a.title, leader: a.leader ?? null })),
        agendaStepIndex,
        currentAgendaId:
          current?.kind === "slide" ? current.agenda?.id ?? null : current?.agenda.id ?? null,
      };
      ch.postMessage({ type: "state", state });
    }
    broadcastStateRef.current = send;
    send();
  }, [deckTitle, i, steps, page, totalPdfPages, blank, summarize, agenda, agendaStepIndex, current]);

  const openPresenterView = useCallback(() => {
    window.open(`/present/${deckId}/notes`, `presenter-${deckId}`, "width=1100,height=800");
  }, [deckId]);

  const registerYt = useCallback((h: YouTubePlayerHandle | null) => {
    ytHandle.current = h;
  }, []);

  if (authLoading || !session || deckQ.isLoading) {
    return <div className="flex h-screen items-center justify-center bg-black text-white/70">Loading…</div>;
  }
  if (!steps.length) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-black text-white">
        <p>This deck has no slides yet.</p>
        <Button variant="secondary" onClick={() => navigate({ to: "/decks/$deckId", params: { deckId } })}>
          Back to editor
        </Button>
      </div>
    );
  }

  const anchorLabel =
    current?.kind === "slide" && current.agenda
      ? `${(current.agendaIndex ?? 0) + 1}. ${current.agenda.title}`
      : null;

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-black text-white"
      style={{ cursor: cursorVisible ? "default" : "none" }}
    >
      {blank ? (
        <div className="absolute inset-0 bg-black" />
      ) : current.kind === "transition" ? (
        <AgendaTransition
          key={current.agenda.id}
          items={agenda}
          incomingIndex={current.agendaIndex}
          previousLabel={current.previousLabel}
          delayMs={current.agenda.transition_delay_ms}
          onDone={() => {
            // Animation complete — stay on the agenda intro page.
            // The presenter must press Next manually to advance to the first slide.
          }}
        />
      ) : (
        <div className="absolute inset-0">
          <SlideRenderer
            slide={current.slide}
            signedUrl={signedUrls[current.slide.id]}
            page={page}
            siteInteractive={siteInteractive}
            onPdfLoaded={(total) => setPdfTotals((m) => ({ ...m, [current.slide.id]: total }))}
            onYtHandle={registerYt}
          />
        </div>
      )}

      {/* Anchor label — always visible during slides (not during transitions/blank) */}
      {anchorLabel && !blank && current.kind === "slide" ? (
        <div className="pointer-events-none absolute left-4 top-4 z-20 rounded-full bg-black/50 px-3 py-1 text-xs font-medium tracking-wide text-white/90 backdrop-blur">
          {anchorLabel}
          {current.agenda?.leader ? (
            <span className="ml-2 text-white/60">· {current.agenda.leader}</span>
          ) : null}
        </div>
      ) : null}

      {/* Overview overlay */}
      {overviewOpen ? (
        <AgendaOverview
          items={agenda}
          currentAgendaId={current.kind === "slide" ? current.agenda?.id ?? null : current.agenda.id}
          slideCounts={slideCounts}
          onClose={() => setOverviewOpen(false)}
          onJump={jumpToAgenda}
        />
      ) : null}

      {/* HUD */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-4 transition-opacity ${cursorVisible ? "opacity-100" : "opacity-0"}`}
      >
        <div className="pointer-events-auto flex items-center gap-1">
          <Button
            variant="secondary"
            size="icon"
            onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }))}
            aria-label="Previous"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }))}
            aria-label="Next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            onClick={() => setOverviewOpen((v) => !v)}
            aria-label="Toggle agenda overview"
            title="Agenda overview (Tab or .)"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            onClick={openPresenterView}
            aria-label="Open presenter view"
            title="Open presenter view in a new window"
          >
            <MonitorSpeaker className="h-4 w-4" />
          </Button>
        </div>

        <div className="pointer-events-auto rounded-full bg-white/10 px-4 py-1.5 text-sm tabular-nums backdrop-blur">
          {i + 1} / {steps.length}
          {currentSlide?.kind === "pdf" ? ` · page ${page} / ${totalPdfPages}` : ""}
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          {currentSlide?.kind === "website" ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSiteInteractive((v) => !v)}
                title={
                  siteInteractive
                    ? "Lock so arrow keys control the presentation"
                    : "Unlock to click and scroll inside the page"
                }
              >
                {siteInteractive ? (
                  <>
                    <Unlock className="mr-1.5 h-4 w-4" /> Interacting
                  </>
                ) : (
                  <>
                    <Lock className="mr-1.5 h-4 w-4" /> Locked
                  </>
                )}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => window.open(String(currentSlide.payload.url ?? ""), "_blank", "noopener,noreferrer")}
              >
                <ExternalLink className="mr-1.5 h-4 w-4" /> Open
              </Button>
            </>
          ) : null}
          <Button
            variant="secondary"
            size="icon"
            onClick={() => {
              if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
              navigate({ to: "/decks/$deckId", params: { deckId } });
            }}
            aria-label="Exit"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function SlideRenderer({
  slide,
  signedUrl,
  page,
  siteInteractive,
  onPdfLoaded,
  onYtHandle,
}: {
  slide: Slide;
  signedUrl?: string;
  page: number;
  siteInteractive: boolean;
  onPdfLoaded: (n: number) => void;
  onYtHandle: (h: YouTubePlayerHandle | null) => void;
}) {
  switch (slide.kind) {
    case "youtube":
      return <YouTubeSlide url={String(slide.payload.url ?? "")} registerHandle={onYtHandle} />;

    case "pdf":
      if (!signedUrl) return <Centered>PDF unavailable.</Centered>;
      return <PdfSlide url={signedUrl} page={page} onLoaded={onPdfLoaded} />;

    case "image":
      if (!signedUrl) return <Centered>Image unavailable.</Centered>;
      return (
        <div className="flex h-full w-full items-center justify-center bg-black">
          <img src={signedUrl} alt={slide.title ?? ""} className="max-h-full max-w-full object-contain" />
        </div>
      );

    case "text": {
      const heading = String(slide.payload.heading ?? slide.title ?? "");
      const body = String(slide.payload.body ?? "");
      const lines = body.split(/\n+/).filter(Boolean);
      const isBullets = lines.length > 1;
      return (
        <div className="flex h-full w-full items-center justify-center bg-primary px-[10vw] py-[8vh] text-primary-foreground">
          <div className="w-full max-w-5xl">
            {heading ? (
              <h1 className="text-[clamp(2rem,7vw,6rem)] font-semibold leading-[1.05] tracking-tight">
                {heading}
              </h1>
            ) : null}
            {isBullets ? (
              <ul className="mt-10 space-y-5 text-[clamp(1rem,2.6vw,2.4rem)] leading-snug">
                {lines.map((l, idx) => (
                  <li key={idx} className="flex gap-4">
                    <span className="text-accent">•</span>
                    <span>{l}</span>
                  </li>
                ))}
              </ul>
            ) : body ? (
              <p className="mt-10 text-[clamp(1rem,2.6vw,2.4rem)] leading-snug opacity-90">{body}</p>
            ) : null}
          </div>
        </div>
      );
    }

    case "website": {
      const url = String(slide.payload.url ?? "");
      return (
        <div className="relative flex h-full w-full items-center justify-center bg-white">
          <iframe
            src={url}
            title={slide.title ?? "Website"}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
          {!siteInteractive ? <div className="absolute inset-0 cursor-default" aria-hidden /> : null}
        </div>
      );
    }

    case "docx": {
      if (signedUrl) return <DocxSlide url={signedUrl} />;
      const html = String(slide.payload.html ?? "");
      return (
        <div className="h-full w-full overflow-auto bg-white px-[8vw] py-[6vh]">
          <article
            className="docx-render mx-auto max-w-4xl text-[clamp(1rem,1.6vw,1.5rem)]"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      );
    }
  }
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full items-center justify-center bg-black text-white/70">{children}</div>;
}
