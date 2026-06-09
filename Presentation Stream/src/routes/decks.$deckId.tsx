import { useNavigate, useParams, createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  addSlide,
  assignSlide,
  createUploadUrl,
  deleteAgendaItem,
  deleteSlide,
  getDeck,
  parseAndReplaceAgenda,
  renameDeck,
  reorderAgendaItems,
  reorderSlides,
  reorderSlidesInGroup,
  updateAgendaItem,
  updateSlide,
} from "@/lib/decks.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  GripVertical,
  ListOrdered,
  Pencil,
  Play,
  Trash2,
  Youtube,
  FileText,
  Image as ImageIcon,
  Type,
  Globe,
  FileType2,
  Upload,
} from "lucide-react";
import { parseYouTubeId } from "@/lib/youtube";
import { toast } from "sonner";

import logoAsset from "@/assets/sau-logo-white.png.asset.json";

export const Route = createFileRoute("/decks/$deckId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Deck editor — SAU Meeting Presenter" },
      { name: "description", content: "Build a meeting deck." },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: DeckEditor,
});

type SlideRow = {
  id: string;
  position: number;
  kind: "youtube" | "pdf" | "image" | "text" | "website" | "docx";
  title: string | null;
  payload: Record<string, unknown>;
  storage_path: string | null;
  agenda_item_id: string | null;
};

type AgendaRow = {
  id: string;
  position: number;
  title: string;
  leader: string | null;
  transition_delay_ms: number;
};


function DeckEditor() {
  const { deckId } = useParams({ from: "/decks/$deckId" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { session, loading: authLoading } = useAuth();
  const get = useServerFn(getDeck);
  const rename = useServerFn(renameDeck);
  const reorderAg = useServerFn(reorderAgendaItems);
  const reorderGrp = useServerFn(reorderSlidesInGroup);
  const assignFn = useServerFn(assignSlide);
  const del = useServerFn(deleteSlide);
  const delAg = useServerFn(deleteAgendaItem);
  const updAg = useServerFn(updateAgendaItem);
  const upd = useServerFn(updateSlide);

  const deckQ = useQuery({
    queryKey: ["deck", deckId],
    queryFn: () => get({ data: { id: deckId } }),
    enabled: !!session,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editingAgendaId, setEditingAgendaId] = useState<string | null>(null);

  useEffect(() => {
    if (deckQ.data?.deck) setTitle(deckQ.data.deck.title);
  }, [deckQ.data?.deck]);

  const renameMut = useMutation({
    mutationFn: (t: string) => rename({ data: { id: deckId, title: t } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deck", deckId] }),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ["deck", deckId] });
    },
  });
  const delAgMut = useMutation({
    mutationFn: (id: string) => delAg({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deck", deckId] }),
  });
  const renameSlideMut = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      upd({ data: { id, title } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deck", deckId] }),
  });
  const updAgMut = useMutation({
    mutationFn: (vars: { id: string; title?: string; leader?: string | null; transition_delay_ms?: number }) =>
      updAg({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deck", deckId] }),
  });

  const slides = (deckQ.data?.slides ?? []) as SlideRow[];
  const agenda = (deckQ.data?.agenda ?? []) as AgendaRow[];
  const selected = slides.find((s) => s.id === selectedId) ?? null;

  // Group slides by agenda id; "" = unassigned
  const groups = useMemo(() => {
    const m = new Map<string, SlideRow[]>();
    m.set("", []);
    for (const a of agenda) m.set(a.id, []);
    for (const s of slides) {
      const key = s.agenda_item_id ?? "";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(s);
    }
    return m;
  }, [slides, agenda]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Build a flat ID list for the SortableContext.
  // Agenda headers use id "ag:<id>"; slides use plain UUID.
  const flatIds = useMemo(() => {
    const ids: string[] = [];
    const unassigned = groups.get("") ?? [];
    for (const s of unassigned) ids.push(s.id);
    for (const a of agenda) {
      ids.push("ag:" + a.id);
      if (!collapsed[a.id]) {
        for (const s of groups.get(a.id) ?? []) ids.push(s.id);
      }
    }
    return ids;
  }, [groups, agenda, collapsed]);

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // Case A: dragging an agenda header — reorder agendas; slides follow naturally
    if (activeId.startsWith("ag:")) {
      if (!overId.startsWith("ag:")) return;
      const ids = agenda.map((a) => a.id);
      const oldIdx = ids.indexOf(activeId.slice(3));
      const newIdx = ids.indexOf(overId.slice(3));
      if (oldIdx < 0 || newIdx < 0) return;
      const nextOrder = arrayMove(ids, oldIdx, newIdx);
      qc.setQueryData(["deck", deckId], (old: ReturnType<typeof useQueryWrap> | undefined) =>
        old
          ? {
              ...old,
              agenda: nextOrder.map((id: string, i: number) => ({ ...old.agenda.find((a) => a.id === id)!, position: i })),
            }
          : old,
      );
      reorderAg({ data: { deck_id: deckId, ordered_ids: nextOrder } }).then(() =>
        qc.invalidateQueries({ queryKey: ["deck", deckId] }),
      );
      return;
    }

    // Case B: dragging a slide.
    // Determine target group + target index within that group.
    // Walk flatIds from the over position upward to find the enclosing agenda header.
    const newFlat = arrayMove(flatIds, flatIds.indexOf(activeId), flatIds.indexOf(overId)) as string[];
    let targetGroup: string | null = null;
    let collected: string[] = [];
    // Walk the new flat order; partition into groups by agenda header markers
    const acc: Record<string, string[]> = { "": [] };
    let cur = "";
    for (const id of newFlat) {
      if (id.startsWith("ag:")) {
        cur = id.slice(3);
        if (!acc[cur]) acc[cur] = [];
      } else {
        if (!acc[cur]) acc[cur] = [];
        acc[cur].push(id);
        if (id === activeId) {
          targetGroup = cur === "" ? null : cur;
          collected = acc[cur];
        }
      }
    }
    if (targetGroup === null && cur === "") targetGroup = null;
    // Apply: reorder within targetGroup (which now contains the dragged slide
    // even if it moved from another group).
    const groupKey = targetGroup ?? "";
    const orderedIds = acc[groupKey] ?? collected;

    // Optimistic local update
    qc.setQueryData(["deck", deckId], (old: ReturnType<typeof useQueryWrap> | undefined) => {
      if (!old) return old;
      const slideById = new Map(old.slides.map((s) => [s.id, s]));
      // Rebuild slides array per acc order
      const newSlides: SlideRow[] = [];
      // Unassigned first
      for (const id of acc[""] ?? []) {
        const s = slideById.get(id);
        if (s) newSlides.push({ ...s, agenda_item_id: null });
      }
      for (const a of old.agenda) {
        for (const id of acc[a.id] ?? []) {
          const s = slideById.get(id);
          if (s) newSlides.push({ ...s, agenda_item_id: a.id });
        }
      }
      return {
        ...old,
        slides: newSlides.map((s, i) => ({ ...s, position: i })),
      };
    });

    // Persist:
    // 1) reassign + position the dragged slide to its new group
    // 2) reorder that group fully
    const assignTo = targetGroup;
    const posInGroup = (acc[groupKey] ?? []).indexOf(activeId);
    (async () => {
      try {
        await assignFn({
          data: { slide_id: activeId, agenda_item_id: assignTo, position: Math.max(posInGroup, 0) },
        });
        await reorderGrp({
          data: { agenda_item_id: assignTo, ordered_ids: acc[groupKey] ?? [activeId] },
        });
      } finally {
        qc.invalidateQueries({ queryKey: ["deck", deckId] });
      }
    })();
  }

  if (authLoading || !session || deckQ.isLoading) {
    return <div className="flex h-screen items-center justify-center bg-background">Loading…</div>;
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b bg-primary px-4 py-3 text-primary-foreground">
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate({ to: "/" })}
            aria-label="Back to decks"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <img src={logoAsset.url} alt="SAU" className="h-7" />
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (title.trim() && title !== deckQ.data?.deck.title) renameMut.mutate(title.trim());
            }}
            className="ml-2 h-9 w-72 border-none bg-primary/40 text-primary-foreground placeholder:text-primary-foreground/60"
          />
        </div>
        <Button
          onClick={() => navigate({ to: "/present/$deckId", params: { deckId } })}
          variant="secondary"
        >
          <Play className="mr-1.5 h-4 w-4" /> Present
        </Button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: grouped slide list */}
        <aside className="w-80 shrink-0 overflow-y-auto border-r bg-card">
          <div className="border-b p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {agenda.length} agenda item{agenda.length === 1 ? "" : "s"} · {slides.length} slide
              {slides.length === 1 ? "" : "s"}
            </p>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={flatIds} strategy={verticalListSortingStrategy}>
              <div className="divide-y">
                {/* Unassigned tray */}
                {(groups.get("") ?? []).length > 0 || agenda.length === 0 ? (
                  <div>
                    <div className="bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Unassigned
                    </div>
                    <ul className="divide-y">
                      {(groups.get("") ?? []).map((s, i) => (
                        <SortableSlide
                          key={s.id}
                          slide={s}
                          index={i}
                          active={s.id === selectedId}
                          onSelect={() => setSelectedId(s.id)}
                          onDelete={() => delMut.mutate(s.id)}
                          onRename={(t) => renameSlideMut.mutate({ id: s.id, title: t })}
                        />
                      ))}
                    </ul>
                  </div>
                ) : null}

                {/* Agenda folders */}
                {agenda.map((a, ai) => {
                  const items = groups.get(a.id) ?? [];
                  const isCollapsed = !!collapsed[a.id];
                  return (
                    <AgendaFolder
                      key={a.id}
                      agenda={a}
                      index={ai}
                      collapsed={isCollapsed}
                      onToggleCollapse={() =>
                        setCollapsed((c) => ({ ...c, [a.id]: !c[a.id] }))
                      }
                      onEdit={() => setEditingAgendaId(a.id)}
                      onDelete={() => {
                        if (confirm("Delete this agenda item? Its slides will become unassigned."))
                          delAgMut.mutate(a.id);
                      }}
                    >
                      {!isCollapsed ? (
                        <ul className="divide-y">
                          {items.map((s, i) => (
                            <SortableSlide
                              key={s.id}
                              slide={s}
                              index={i}
                              active={s.id === selectedId}
                              onSelect={() => setSelectedId(s.id)}
                              onDelete={() => delMut.mutate(s.id)}
                              onRename={(t) => renameSlideMut.mutate({ id: s.id, title: t })}
                              inset
                            />
                          ))}
                          {items.length === 0 ? (
                            <li className="px-6 py-3 text-xs italic text-muted-foreground">
                              Drag slides here
                            </li>
                          ) : null}
                        </ul>
                      ) : null}
                    </AgendaFolder>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        </aside>

        {/* Main: add resource / edit slide / edit agenda */}
        <main className="flex-1 overflow-y-auto p-8">
          {editingAgendaId ? (
            <AgendaItemEditor
              item={agenda.find((a) => a.id === editingAgendaId)!}
              onBack={() => setEditingAgendaId(null)}
              onSave={(patch) => updAgMut.mutate({ id: editingAgendaId, ...patch })}
            />
          ) : selected ? (
            <SlideEditor
              key={selected.id}
              slide={selected}
              onBack={() => setSelectedId(null)}
              onSaved={() => qc.invalidateQueries({ queryKey: ["deck", deckId] })}
            />
          ) : (
            <AddResourcePanel
              deckId={deckId}
              onAdded={() => qc.invalidateQueries({ queryKey: ["deck", deckId] })}
            />
          )}
        </main>
      </div>
    </div>
  );
}

// Helper for query type narrowing
type DeckData = {
  deck: { id: string; title: string };
  slides: SlideRow[];
  signedUrls: Record<string, string>;
  agenda: AgendaRow[];
};
function useQueryWrap(): DeckData {
  throw new Error("type-only");
}

function AgendaFolder({
  agenda,
  index,
  collapsed,
  onToggleCollapse,
  onEdit,
  onDelete,
  children,
}: {
  agenda: AgendaRow;
  index: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onEdit: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: "ag:" + agenda.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="bg-card">
      <div className="group flex items-center gap-2 border-b bg-accent/30 px-3 py-2">
        <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground" aria-label="Drag agenda item">
          <GripVertical className="h-4 w-4" />
        </button>
        <button onClick={onToggleCollapse} aria-label="Collapse" className="text-muted-foreground">
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <div className="flex-1">
          <p className="text-sm font-semibold">
            {index + 1}. {agenda.title}
          </p>
          {agenda.leader ? (
            <p className="text-xs text-muted-foreground">{agenda.leader}</p>
          ) : null}
        </div>
        <button
          onClick={onEdit}
          className="rounded p-1 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100"
          aria-label="Edit agenda item"
          title="Edit"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="Delete agenda item"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}

function SortableSlide({
  slide,
  index,
  active,
  onSelect,
  onDelete,
  onRename,
  inset,
}: {
  slide: SlideRow;
  index: number;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  inset?: boolean;
}) {
  return (
    <SortableItem
      slide={slide}
      index={index}
      active={active}
      onSelect={onSelect}
      onDelete={onDelete}
      onRename={onRename}
      inset={inset}
    />
  );
}



function SortableItem({
  slide,
  index,
  active,
  onSelect,
  onDelete,
  onRename,
  inset,
}: {

  slide: SlideRow;
  index: number;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  inset?: boolean;
}) {

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slide.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const Icon = kindIcon(slide.kind);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(slide.title ?? "");
  useEffect(() => {
    if (!editing) setDraft(slide.title ?? "");
  }, [slide.title, editing]);

  function commit() {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed && trimmed !== (slide.title ?? "")) onRename(trimmed);
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-2 p-3 ${inset ? "pl-8" : ""} ${active ? "bg-accent-soft" : ""}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted-foreground"
        aria-label="Drag"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <button onClick={onSelect} className="flex flex-1 items-center gap-2 text-left">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <span className="flex flex-1 flex-col">
          {editing ? (
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setDraft(slide.title ?? "");
                  setEditing(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className="h-7 text-sm"
            />
          ) : (
            <span className="text-sm font-medium">
              {index + 1}. {slide.title || labelFor(slide.kind)}
            </span>
          )}
          <span className="text-xs capitalize text-muted-foreground">{slide.kind}</span>
        </span>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        className="rounded p-1 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100"
        aria-label="Rename slide"
        title="Rename"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onDelete}
        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        aria-label="Delete slide"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function kindIcon(k: SlideRow["kind"]) {
  return {
    youtube: Youtube,
    pdf: FileText,
    image: ImageIcon,
    text: Type,
    website: Globe,
    docx: FileType2,
  }[k];
}
function labelFor(k: SlideRow["kind"]) {
  return {
    youtube: "YouTube video",
    pdf: "PDF",
    image: "Image",
    text: "Text slide",
    website: "Website",
    docx: "Word document",
  }[k];
}

// ----------- Add Resource -----------

function AddResourcePanel({ deckId, onAdded }: { deckId: string; onAdded: () => void }) {
  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="text-xl font-semibold">Add a resource</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Add a slide to this deck. Select a slide on the left to edit it.
      </p>
      <Tabs defaultValue="agenda" className="mt-6">
        <TabsList className="grid grid-cols-4 sm:grid-cols-7">
          <TabsTrigger value="agenda">
            <ListOrdered className="mr-1 h-3.5 w-3.5" /> Agenda
          </TabsTrigger>
          <TabsTrigger value="youtube">YouTube</TabsTrigger>
          <TabsTrigger value="pdf">PDF</TabsTrigger>
          <TabsTrigger value="image">Image</TabsTrigger>
          <TabsTrigger value="text">Text</TabsTrigger>
          <TabsTrigger value="website">Website</TabsTrigger>
          <TabsTrigger value="docx">Word</TabsTrigger>
        </TabsList>
        <TabsContent value="agenda">
          <AgendaPasteTab deckId={deckId} onAdded={onAdded} />
        </TabsContent>
        <TabsContent value="youtube">
          <AddYouTube deckId={deckId} onAdded={onAdded} />
        </TabsContent>
        <TabsContent value="pdf">
          <AddUpload deckId={deckId} kind="pdf" onAdded={onAdded} accept="application/pdf" />
        </TabsContent>
        <TabsContent value="image">
          <AddUpload deckId={deckId} kind="image" onAdded={onAdded} accept="image/*" />
        </TabsContent>
        <TabsContent value="text">
          <AddText deckId={deckId} onAdded={onAdded} />
        </TabsContent>
        <TabsContent value="website">
          <AddWebsite deckId={deckId} onAdded={onAdded} />
        </TabsContent>
        <TabsContent value="docx">
          <AddDocx deckId={deckId} onAdded={onAdded} />
        </TabsContent>
      </Tabs>

    </div>
  );
}

function AddYouTube({ deckId, onAdded }: { deckId: string; onAdded: () => void }) {
  const add = useServerFn(addSlide);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const id = parseYouTubeId(url);
  const mut = useMutation({
    mutationFn: () =>
      add({
        data: {
          deck_id: deckId,
          kind: "youtube",
          title: title || null,
          payload: { url },
        },
      }),
    onSuccess: () => {
      setUrl("");
      setTitle("");
      toast.success("YouTube slide added");
      onAdded();
    },
  });
  return (
    <div className="mt-6 space-y-4 rounded-lg border bg-card p-6">
      <div>
        <Label htmlFor="yt-url">YouTube URL</Label>
        <Input
          id="yt-url"
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          The remote's play/pause button will control this video during the presentation.
        </p>
      </div>
      <div>
        <Label htmlFor="yt-title">Title (optional)</Label>
        <Input id="yt-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <Button disabled={!id || mut.isPending} onClick={() => mut.mutate()}>
        Add YouTube slide
      </Button>
      {url && !id ? (
        <p className="text-xs text-destructive">Couldn't find a video ID in that URL.</p>
      ) : null}
    </div>
  );
}

function AddText({ deckId, onAdded }: { deckId: string; onAdded: () => void }) {
  const add = useServerFn(addSlide);
  const [heading, setHeading] = useState("");
  const [body, setBody] = useState("");
  const mut = useMutation({
    mutationFn: () =>
      add({
        data: {
          deck_id: deckId,
          kind: "text",
          title: heading || null,
          payload: { heading, body },
        },
      }),
    onSuccess: () => {
      setHeading("");
      setBody("");
      toast.success("Text slide added");
      onAdded();
    },
  });
  return (
    <div className="mt-6 space-y-4 rounded-lg border bg-card p-6">
      <div>
        <Label htmlFor="t-h">Heading</Label>
        <Input id="t-h" value={heading} onChange={(e) => setHeading(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="t-b">Body</Label>
        <Textarea
          id="t-b"
          rows={6}
          placeholder="One bullet per line, or a paragraph."
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      <Button disabled={!heading && !body} onClick={() => mut.mutate()}>
        Add text slide
      </Button>
    </div>
  );
}

function AddWebsite({ deckId, onAdded }: { deckId: string; onAdded: () => void }) {
  const add = useServerFn(addSlide);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const mut = useMutation({
    mutationFn: () =>
      add({
        data: {
          deck_id: deckId,
          kind: "website",
          title: title || null,
          payload: { url },
        },
      }),
    onSuccess: () => {
      setUrl("");
      setTitle("");
      toast.success("Website slide added");
      onAdded();
    },
  });
  return (
    <div className="mt-6 space-y-4 rounded-lg border bg-card p-6">
      <div>
        <Label htmlFor="w-u">Website URL</Label>
        <Input id="w-u" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <p className="mt-1 text-xs text-muted-foreground">
          Heads-up: some sites (Google, banks, news sites) block being shown in a frame. If the
          slide is blank during presentation, use the "Open in new tab" button on the slide.
        </p>
      </div>
      <div>
        <Label htmlFor="w-t">Title (optional)</Label>
        <Input id="w-t" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <Button
        disabled={!url || mut.isPending}
        onClick={() => {
          try {
            new URL(url);
            mut.mutate();
          } catch {
            toast.error("Please enter a full URL including https://");
          }
        }}
      >
        Add website slide
      </Button>
    </div>
  );
}

async function uploadToBucket(
  deckId: string,
  file: File,
): Promise<{ path: string }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const url = await createUploadUrl({ data: { deck_id: deckId, filename: safeName } });
  const { error } = await supabase.storage
    .from("presenter-files")
    .uploadToSignedUrl(url.path, url.token, file, { contentType: file.type });
  if (error) throw error;
  return { path: url.path };
}

function AddUpload({
  deckId,
  kind,
  accept,
  onAdded,
}: {
  deckId: string;
  kind: "pdf" | "image";
  accept: string;
  onAdded: () => void;
}) {
  const add = useServerFn(addSlide);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const { path } = await uploadToBucket(deckId, file);
      await add({
        data: {
          deck_id: deckId,
          kind,
          title: file.name,
          payload: { filename: file.name, mime: file.type },
          storage_path: path,
        },
      });
      toast.success(`${kind === "pdf" ? "PDF" : "Image"} added`);
      onAdded();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Upload failed: " + msg);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="mt-6 space-y-4 rounded-lg border bg-card p-6">
      <p className="text-sm text-muted-foreground">
        {kind === "pdf"
          ? "Upload a PDF. Each page becomes a step in the presentation — arrows page through it, then advance to the next slide."
          : "Upload a JPG, PNG, or WebP image. It will be shown full-screen on a black background."}
      </p>
      <input ref={inputRef} type="file" accept={accept} hidden onChange={onPick} />
      <Button disabled={busy} onClick={() => inputRef.current?.click()}>
        <Upload className="mr-1.5 h-4 w-4" />
        {busy ? "Uploading…" : `Choose ${kind === "pdf" ? "a PDF" : "an image"}`}
      </Button>
    </div>
  );
}

function AddDocx({ deckId, onAdded }: { deckId: string; onAdded: () => void }) {
  const add = useServerFn(addSlide);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const { path } = await uploadToBucket(deckId, file);
      await add({
        data: {
          deck_id: deckId,
          kind: "docx",
          title: file.name.replace(/\.docx?$/i, ""),
          payload: { filename: file.name },
          storage_path: path,
        },
      });
      toast.success("Word document added");
      onAdded();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Could not upload that document: " + msg);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="mt-6 space-y-4 rounded-lg border bg-card p-6">
      <p className="text-sm text-muted-foreground">
        Upload a .docx file. It's rendered with the original styles, fonts, page size, and
        embedded images preserved.
      </p>
      <input ref={inputRef} type="file" accept=".docx" hidden onChange={onPick} />
      <Button disabled={busy} onClick={() => inputRef.current?.click()}>
        <Upload className="mr-1.5 h-4 w-4" />
        {busy ? "Converting…" : "Choose a .docx file"}
      </Button>
    </div>
  );
}

// ----------- Slide editor (right pane when a slide is selected) -----------

function SlideEditor({ slide, onSaved, onBack }: { slide: SlideRow; onSaved: () => void; onBack: () => void }) {
  const upd = useServerFn(updateSlide);
  const [title, setTitle] = useState(slide.title ?? "");
  const [draft, setDraft] = useState<Record<string, unknown>>(slide.payload ?? {});

  const mut = useMutation({
    mutationFn: () => upd({ data: { id: slide.id, title: title || null, payload: draft } }),
    onSuccess: () => {
      toast.success("Saved");
      onSaved();
    },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-3 -ml-2">
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Add a resource
      </Button>
      <h2 className="text-xl font-semibold capitalize">{labelFor(slide.kind)}</h2>
      <p className="mt-1 text-sm text-muted-foreground">Edit this slide.</p>

      <div className="mt-6 space-y-4 rounded-lg border bg-card p-6">
        <div>
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        {slide.kind === "youtube" || slide.kind === "website" ? (
          <div>
            <Label>URL</Label>
            <Input
              value={String(draft.url ?? "")}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            />
          </div>
        ) : null}

        {slide.kind === "text" ? (
          <>
            <div>
              <Label>Heading</Label>
              <Input
                value={String(draft.heading ?? "")}
                onChange={(e) => setDraft({ ...draft, heading: e.target.value })}
              />
            </div>
            <div>
              <Label>Body</Label>
              <Textarea
                rows={6}
                value={String(draft.body ?? "")}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </div>
          </>
        ) : null}

        {slide.kind === "pdf" || slide.kind === "image" || slide.kind === "docx" ? (
          <p className="text-sm text-muted-foreground">
            To replace the file, delete this slide and upload a new one.
          </p>
        ) : null}

        <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
          Save changes
        </Button>
      </div>
    </div>
  );
}

function AgendaItemEditor({
  item,
  onBack,
  onSave,
}: {
  item: AgendaRow;
  onBack: () => void;
  onSave: (patch: { title?: string; leader?: string | null; transition_delay_ms?: number }) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [leader, setLeader] = useState(item.leader ?? "");
  const [delay, setDelay] = useState(item.transition_delay_ms);
  useEffect(() => {
    setTitle(item.title);
    setLeader(item.leader ?? "");
    setDelay(item.transition_delay_ms);
  }, [item.id]);

  return (
    <div className="mx-auto max-w-2xl">
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-3 -ml-2">
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
      </Button>
      <h2 className="text-xl font-semibold">Agenda item</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        These settings drive the transition screen shown before this section's slides.
      </p>

      <div className="mt-6 space-y-5 rounded-lg border bg-card p-6">
        <div>
          <Label htmlFor="ag-title">Title</Label>
          <Input id="ag-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ag-lead">Leader (optional)</Label>
          <Input id="ag-lead" value={leader} onChange={(e) => setLeader(e.target.value)} />
        </div>
        <div>
          <Label>Transition pause before scrolling</Label>
          <div className="mt-2 flex items-center gap-4">
            <Slider
              min={0}
              max={5000}
              step={100}
              value={[delay]}
              onValueChange={(v) => setDelay(v[0] ?? 0)}
              className="flex-1"
            />
            <span className="w-16 text-right text-sm tabular-nums text-muted-foreground">
              {(delay / 1000).toFixed(1)}s
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            How long the previous agenda item stays in the center box before scrolling up.
          </p>
        </div>
        <Button
          onClick={() => {
            onSave({
              title: title.trim() || item.title,
              leader: leader.trim() || null,
              transition_delay_ms: delay,
            });
            onBack();
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function AgendaPasteTab({ deckId, onAdded }: { deckId: string; onAdded: () => void }) {
  const parseFn = useServerFn(parseAndReplaceAgenda);
  const [text, setText] = useState("");
  const mut = useMutation({
    mutationFn: () => parseFn({ data: { deck_id: deckId, text } }),
    onSuccess: (r) => {
      toast.success(`Saved ${r.count} agenda item${r.count === 1 ? "" : "s"}`);
      setText("");
      onAdded();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  return (
    <div className="mt-6 space-y-4 rounded-lg border bg-card p-6">
      <div>
        <Label htmlFor="ag-paste">Paste your numbered agenda</Label>
        <Textarea
          id="ag-paste"
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"1. Welcome\tJane Doe\n2. Q3 numbers\tJohn Smith\n3. Open discussion"}
          className="font-mono"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          One item per line, prefixed with a number. Use a Tab to separate the title from the
          team member leading that item. Replacing the agenda keeps existing slides attached
          to items whose titles still match.
        </p>
      </div>
      <Button disabled={!text.trim() || mut.isPending} onClick={() => mut.mutate()}>
        {mut.isPending ? "Saving…" : "Parse & replace agenda"}
      </Button>
    </div>
  );
}
