import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  createDeck,
  deleteDeck,
  listMyDecks,
  getMe,
  clearMyData,
  renameDeck,
} from "@/lib/decks.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Play, Trash2, Settings, LogOut, ShieldCheck, Pencil } from "lucide-react";
import { toast } from "sonner";
import logoAsset from "@/assets/sau-logo-white.png.asset.json";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "My Decks — SAU Meeting Presenter" },
      {
        name: "description",
        content: "Build and run mixed-media presentations for your team meetings.",
      },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: Dashboard,
});

function Dashboard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const list = useServerFn(listMyDecks);
  const create = useServerFn(createDeck);
  const del = useServerFn(deleteDeck);
  const me = useServerFn(getMe);
  const wipe = useServerFn(clearMyData);
  const rename = useServerFn(renameDeck);

  useEffect(() => {
    if (!authLoading && !session) navigate({ to: "/auth", replace: true });
  }, [authLoading, navigate, session]);

  const decksQ = useQuery({ queryKey: ["decks"], queryFn: () => list(), enabled: !!session });
  const meQ = useQuery({ queryKey: ["me"], queryFn: () => me(), enabled: !!session });

  const createMut = useMutation({
    mutationFn: () => create({ data: {} }),
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ["decks"] });
      window.location.href = `/decks/${id}`;
    },
  });
  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["decks"] }),
  });
  const renameMut = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      rename({ data: { id, title } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["decks"] }),
  });
  const wipeMut = useMutation({
    mutationFn: () => wipe(),
    onSuccess: (r) => {
      toast.success(`Cleared all your data (${r.removed_files} files removed).`);
      qc.invalidateQueries({ queryKey: ["decks"] });
    },
  });

  if (authLoading || !session) {
    return <div className="flex min-h-screen items-center justify-center bg-background">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <img src={logoAsset.url} alt="SAU" className="h-8" />
            <span className="hidden text-sm font-medium opacity-90 md:block">
              Meeting Presenter
            </span>
          </div>
          <div className="flex items-center gap-2">
            {meQ.data?.isAdmin ? (
              <Link to="/admin">
                <Button variant="secondary" size="sm">
                  <ShieldCheck className="mr-1.5 h-4 w-4" /> Admin
                </Button>
              </Link>
            ) : null}
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">My decks</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {meQ.data?.profile?.email ? `Signed in as ${meQ.data.profile.email}` : ""}
            </p>
          </div>
          <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
            <Plus className="mr-1.5 h-4 w-4" /> New deck
          </Button>
        </div>

        {decksQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (decksQ.data?.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-12 text-center">
            <h2 className="text-lg font-medium">No decks yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first deck and start adding YouTube videos, PDFs, images, and text
              slides.
            </p>
            <Button className="mt-4" onClick={() => createMut.mutate()}>
              <Plus className="mr-1.5 h-4 w-4" /> New deck
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {decksQ.data?.map((d) => (
              <DeckCard
                key={d.id}
                deck={d}
                onDelete={() => delMut.mutate(d.id)}
                onRename={(title) => renameMut.mutate({ id: d.id, title })}
              />
            ))}
          </div>
        )}

        <div className="mt-16 rounded-xl border border-destructive/20 bg-destructive/5 p-6">
          <h3 className="text-base font-medium text-destructive">Danger zone</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Delete every deck, slide, and uploaded file in your account. This cannot be undone.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" className="mt-3">
                Clear all my data
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear everything?</AlertDialogTitle>
                <AlertDialogDescription>
                  All your decks, slides, and uploaded files will be permanently deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => wipeMut.mutate()}>
                  Yes, delete everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </main>
    </div>
  );
}

function SignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await supabase.auth.signOut();
        window.location.href = "/auth";
      }}
    >
      <LogOut className="mr-1.5 h-4 w-4" /> Sign out
    </Button>
  );
}

type DeckSummary = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

function DeckCard({
  deck,
  onDelete,
  onRename,
}: {
  deck: DeckSummary;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(deck.title);
  useEffect(() => {
    if (!editing) setDraft(deck.title);
  }, [deck.title, editing]);

  function commit() {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed && trimmed !== deck.title) onRename(trimmed);
  }

  return (
    <div className="group flex flex-col rounded-xl border bg-card p-5 transition hover:border-primary/40 hover:shadow-md">
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
              setDraft(deck.title);
              setEditing(false);
            }
          }}
          className="h-9 text-lg font-medium"
        />
      ) : (
        <div className="flex items-start justify-between gap-2">
          <Link
            to="/decks/$deckId"
            params={{ deckId: deck.id }}
            className="flex-1 min-w-0"
          >
            <h3 className="line-clamp-2 text-lg font-medium">{deck.title}</h3>
          </Link>
          <button
            onClick={() => setEditing(true)}
            className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100"
            aria-label="Rename deck"
            title="Rename"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        Updated {new Date(deck.updated_at).toLocaleString()}
      </p>
      <div className="mt-4 flex items-center gap-2">
        <Link to="/decks/$deckId" params={{ deckId: deck.id }} className="flex-1">
          <Button variant="secondary" size="sm" className="w-full">
            <Settings className="mr-1.5 h-3.5 w-3.5" /> Edit
          </Button>
        </Link>
        <Link to="/present/$deckId" params={{ deckId: deck.id }}>
          <Button size="sm">
            <Play className="mr-1.5 h-3.5 w-3.5" /> Present
          </Button>
        </Link>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="Delete">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this deck?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes the deck, its slides, and any uploaded files.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
