import { useEffect, useRef, useState } from "react";

export type AgendaItem = {
  id: string;
  position: number;
  title: string;
  leader: string | null;
  transition_delay_ms: number;
};

const ROW_HEIGHT = 80; // px — must match h-20 below

/**
 * Full-screen transition that introduces a new agenda item.
 *
 * Visuals: full agenda list displayed vertically, with a fixed
 * crisp rectangle in the vertical center. Outside the rectangle the
 * list is blurred and dimmed.
 *
 * Animation: list starts with the previous item (deck title for the
 * first transition) locked in the center rectangle, then after
 * `delayMs` smoothly scrolls up one row so the new item locks in.
 */
export function AgendaTransition({
  items,
  incomingIndex,
  previousLabel,
  delayMs,
  onDone,
}: {
  items: AgendaItem[];
  incomingIndex: number;
  previousLabel: string;
  delayMs: number;
  onDone: () => void;
}) {
  const [scrolled, setScrolled] = useState(false);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    doneRef.current = false;
    setScrolled(false);
    const wait = Math.max(50, delayMs);
    const t1 = setTimeout(() => setScrolled(true), wait);
    // Failsafe in case transitionend doesn't fire
    const t2 = setTimeout(() => {
      if (!doneRef.current) {
        doneRef.current = true;
        onDoneRef.current?.();
      }
    }, wait + 1500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // Intentionally exclude onDone — parent passes a new function each render
    // and we don't want every parent re-render to reset the animation.
  }, [incomingIndex, delayMs]);

  // Displayed rows = [previousLabel row, ...all agenda items].
  // Previous row sits at index `incomingIndex` so it's adjacent to the
  // incoming item at index `incomingIndex + 1`. For the first transition
  // (incomingIndex = 0) that puts deck title at top.
  const displayed: { id: string; title: string; leader: string | null }[] = [];
  for (let k = 0; k < incomingIndex; k++) {
    displayed.push({ id: items[k].id, title: items[k].title, leader: items[k].leader });
  }
  displayed.push({ id: "__prev__", title: previousLabel, leader: null });
  for (let k = incomingIndex; k < items.length; k++) {
    displayed.push({ id: items[k].id, title: items[k].title, leader: items[k].leader });
  }

  // Index of the row that should be centered in the spotlight.
  const prevRowIdx = incomingIndex;
  const focusRow = scrolled ? prevRowIdx + 1 : prevRowIdx;

  // ul is positioned at top:50% left:50% (its top-left at viewport center).
  // To center the focused row on the viewport, translate up by the row's
  // center inside the ul: (focusRow + 0.5) * ROW_HEIGHT, and horizontally
  // back by half the ul width.
  const tY = -((focusRow + 0.5) * ROW_HEIGHT);
  const transform = `translate(-50%, ${tY}px)`;


  return (
    <div className="absolute inset-0 overflow-hidden bg-background text-foreground">
      {/* Blurred / dimmed background copy */}
      <ul
        aria-hidden
        className="absolute left-1/2 top-1/2 w-[min(1100px,86vw)] opacity-40 blur-[2px] transition-transform duration-700 ease-out"
        style={{ transform }}
      >
        {displayed.map((row, idx) => (
          <Row key={"b:" + row.id + ":" + idx} title={row.title} leader={row.leader} />
        ))}
      </ul>

      {/* Spotlight rectangle */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-20 w-[min(1100px,86vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-foreground/15"
        aria-hidden={false}
      >
        {/* Crisp copy of the same list, identically positioned. Because this
            wrapper is centered on the viewport, the inner ul's positioning is
            relative to the same anchor, so it stays aligned with the blurred
            copy underneath. */}
        <div className="relative h-full w-full">
          <ul
            className="absolute left-1/2 w-[min(1100px,86vw)] transition-transform duration-700 ease-out"
            style={{ top: "50%", transform }}
            onTransitionEnd={() => {
              if (!doneRef.current) {
                doneRef.current = true;
                onDoneRef.current?.();
              }
            }}
          >
            {displayed.map((row, idx) => (
              <Row key={"f:" + row.id + ":" + idx} title={row.title} leader={row.leader} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Row({ title, leader }: { title: string; leader: string | null }) {
  return (
    <li className="flex h-20 items-center justify-center px-6 text-center">
      <span className="text-[clamp(1.5rem,3.5vw,2.75rem)] font-medium tracking-tight">{title}</span>
      {leader ? (
        <span className="ml-4 text-[clamp(0.9rem,1.4vw,1.25rem)] text-muted-foreground">· {leader}</span>
      ) : null}
    </li>
  );
}
