import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { AgendaItem } from "./agenda-transition";

export function AgendaOverview({
  items,
  currentAgendaId,
  slideCounts,
  onClose,
  onJump,
}: {
  items: AgendaItem[];
  currentAgendaId: string | null;
  slideCounts: Record<string, number>;
  onClose: () => void;
  onJump: (agendaId: string) => void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="relative w-[min(900px,90vw)] max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-background p-8 text-foreground shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Meeting agenda</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close overview">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <ol className="space-y-2">
          {items.map((item, idx) => {
            const active = item.id === currentAgendaId;
            const count = slideCounts[item.id] ?? 0;
            return (
              <li key={item.id}>
                <button
                  onClick={() => onJump(item.id)}
                  className={
                    "flex w-full items-center gap-4 rounded-lg border px-4 py-3 text-left transition-colors " +
                    (active
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-muted")
                  }
                >
                  <span
                    className={
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold " +
                      (active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")
                    }
                  >
                    {idx + 1}
                  </span>
                  <span className="flex-1">
                    <span className={"block text-base " + (active ? "font-semibold" : "font-medium")}>
                      {item.title}
                    </span>
                    {item.leader ? (
                      <span className="block text-xs text-muted-foreground">{item.leader}</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {count} slide{count === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            );
          })}
          {!items.length ? (
            <li className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No agenda items yet. Add one in the deck editor.
            </li>
          ) : null}
        </ol>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Press Tab or . (period) to close
        </p>
      </div>
    </div>
  );
}
