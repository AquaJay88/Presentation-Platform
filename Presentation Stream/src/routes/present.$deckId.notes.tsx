import { createFileRoute, redirect, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, EyeOff, Eye, Maximize2 } from "lucide-react";
import {
  openChannel,
  type AudienceMessage,
  type PresenterState,
  type StepSummary,
} from "@/lib/presenter-sync";

export const Route = createFileRoute("/present/$deckId/notes")({
  ssr: false,
  head: () => ({ meta: [{ title: "Presenter view — SAU Meeting Presenter" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: PresenterNotes,
});

function PresenterNotes() {
  const { deckId } = useParams({ from: "/present/$deckId/notes" });
  const [state, setState] = useState<PresenterState | null>(null);
  const [connected, setConnected] = useState(false);
  const chRef = useRef<BroadcastChannel | null>(null);

  // Elapsed timer (since this window opened)
  const startedAtRef = useRef<number>(Date.now());
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const ch = openChannel(deckId);
    chRef.current = ch;
    ch.onmessage = (e) => {
      const msg = e.data as AudienceMessage;
      if (msg?.type === "state") {
        setState(msg.state);
        setConnected(true);
      }
    };
    ch.postMessage({ type: "hello" });
    // periodic hello until connected
    const probe = setInterval(() => {
      if (!chRef.current) return;
      chRef.current.postMessage({ type: "hello" });
    }, 1500);
    return () => {
      clearInterval(probe);
      ch.close();
      chRef.current = null;
    };
  }, [deckId]);

  const send = useCallback((m: { type: "next" | "prev" | "toggle-blank" } | { type: "goto"; i: number; page?: number }) => {
    chRef.current?.postMessage(m);
  }, []);

  // Keyboard shortcuts inside presenter window
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        send({ type: "next" });
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        send({ type: "prev" });
      } else if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        send({ type: "toggle-blank" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send]);

  const elapsed = useMemo(() => {
    const secs = Math.floor((now - startedAtRef.current) / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }, [now]);

  if (!state) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background text-foreground">
        <p className="text-sm text-muted-foreground">Waiting for the presentation window…</p>
        <p className="max-w-md text-center text-xs text-muted-foreground">
          Keep the presentation tab open in the same browser. If it&apos;s closed, open it again from
          the deck page.
        </p>
        {connected ? null : (
          <Button variant="outline" size="sm" onClick={() => chRef.current?.postMessage({ type: "hello" })}>
            Retry
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">{state.deckTitle || "Untitled deck"}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
            {state.i + 1} / {state.totalSteps}
            {state.current?.slideKind === "pdf" ? ` · p${state.page}/${state.totalPdfPages}` : ""}
          </span>
          {state.blank ? (
            <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">
              Audience screen blanked
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm tabular-nums text-muted-foreground">⏱ {elapsed}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
            title="Fullscreen this presenter view"
          >
            <Maximize2 className="mr-1 h-4 w-4" /> Fullscreen
          </Button>
        </div>
      </header>

      {/* Main grid */}
      <div className="grid flex-1 min-h-0 grid-cols-[1fr_360px]">
        {/* Left: current + next previews */}
        <div className="flex min-h-0 flex-col gap-4 p-4">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Now</div>
            <StepPreview step={state.current} big />
          </div>
          <div className="flex min-h-0 basis-1/3 flex-col">
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Next</div>
            <StepPreview step={state.next} />
          </div>
          {/* Controls */}
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button variant="secondary" onClick={() => send({ type: "prev" })}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Previous
            </Button>
            <Button variant="secondary" onClick={() => send({ type: "toggle-blank" })}>
              {state.blank ? (
                <>
                  <Eye className="mr-1 h-4 w-4" /> Unblank
                </>
              ) : (
                <>
                  <EyeOff className="mr-1 h-4 w-4" /> Blank
                </>
              )}
            </Button>
            <Button onClick={() => send({ type: "next" })}>
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Right: agenda jump list */}
        <aside className="flex min-h-0 flex-col border-l">
          <div className="border-b px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground">
            Agenda
          </div>
          <ol className="flex-1 overflow-y-auto p-3 space-y-1">
            {state.agenda.length === 0 ? (
              <li className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                No agenda items.
              </li>
            ) : (
              state.agenda.map((a, idx) => {
                const active = a.id === state.currentAgendaId;
                const targetIdx = state.agendaStepIndex[a.id];
                return (
                  <li key={a.id}>
                    <button
                      onClick={() =>
                        typeof targetIdx === "number" ? send({ type: "goto", i: targetIdx }) : undefined
                      }
                      className={
                        "flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors " +
                        (active
                          ? "border-primary bg-primary/10"
                          : "border-border hover:bg-muted")
                      }
                    >
                      <span
                        className={
                          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold " +
                          (active
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground")
                        }
                      >
                        {idx + 1}
                      </span>
                      <span className="flex-1">
                        <span className={"block text-sm " + (active ? "font-semibold" : "font-medium")}>
                          {a.title}
                        </span>
                        {a.leader ? (
                          <span className="block text-xs text-muted-foreground">{a.leader}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ol>
          <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
            ← / → navigate · Space = next · B = blank
          </div>
        </aside>
      </div>
    </div>
  );
}

function StepPreview({ step, big = false }: { step: StepSummary | null; big?: boolean }) {
  if (!step) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
        — End of deck —
      </div>
    );
  }
  const isTransition = step.kind === "transition";
  return (
    <div
      className={
        "flex flex-1 flex-col justify-between rounded-lg border p-4 " +
        (isTransition ? "bg-primary/5" : "bg-card")
      }
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {step.agendaIndex !== null ? (
          <span className="rounded-full bg-muted px-2 py-0.5">
            {step.agendaIndex + 1}. {step.agendaTitle}
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5">Unassigned</span>
        )}
        <span className="rounded-full bg-muted px-2 py-0.5 uppercase tracking-wide">
          {isTransition ? "Agenda intro" : step.slideKind}
        </span>
      </div>
      <div className="flex-1 py-4">
        <div
          className={
            "font-semibold leading-tight " + (big ? "text-3xl" : "text-lg")
          }
        >
          {step.title}
        </div>
      </div>
    </div>
  );
}
