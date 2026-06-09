import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  adminAddAllowedEmail,
  adminClearEverything,
  adminListAllowedEmails,
  adminRemoveAllowedEmail,
  getMe,
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
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import logoAsset from "@/assets/sau-logo-white.png.asset.json";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Admin — SAU Meeting Presenter" }],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: AdminPage,
});

function AdminPage() {
  const { session, loading: authLoading } = useAuth();
  const me = useServerFn(getMe);
  const list = useServerFn(adminListAllowedEmails);
  const add = useServerFn(adminAddAllowedEmail);
  const rm = useServerFn(adminRemoveAllowedEmail);
  const wipe = useServerFn(adminClearEverything);
  const qc = useQueryClient();

  const meQ = useQuery({ queryKey: ["me"], queryFn: () => me(), enabled: !!session });
  const listQ = useQuery({
    queryKey: ["admin-emails"],
    queryFn: () => list(),
    enabled: !!session && !!meQ.data?.isAdmin,
  });

  const [email, setEmail] = useState("");
  const addMut = useMutation({
    mutationFn: (e: string) => add({ data: { email: e } }),
    onSuccess: () => {
      setEmail("");
      toast.success("Added");
      qc.invalidateQueries({ queryKey: ["admin-emails"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const rmMut = useMutation({
    mutationFn: (e: string) => rm({ data: { email: e } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-emails"] }),
  });
  const wipeMut = useMutation({
    mutationFn: () => wipe(),
    onSuccess: (r) => toast.success(`Cleared ${r.removed_files} files across all users.`),
  });

  if (authLoading || !session || meQ.isLoading)
    return <div className="flex min-h-screen items-center justify-center">Loading…</div>;
  if (!meQ.data?.isAdmin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p>Admins only.</p>
        <Link to="/">
          <Button variant="secondary">Back</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-4">
          <Link to="/">
            <Button variant="secondary" size="sm" aria-label="Back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <img src={logoAsset.url} alt="SAU" className="h-7" />
          <span className="text-sm font-medium opacity-90">Admin</span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Allowed emails</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Anyone with an <code>@southern.edu</code> Google account can sign in by default. Add
          emails here to invite guests outside the domain.
        </p>

        <form
          className="mt-6 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (email) addMut.mutate(email);
          }}
        >
          <Input
            type="email"
            placeholder="guest@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" disabled={!email || addMut.isPending}>
            <Plus className="mr-1.5 h-4 w-4" /> Add
          </Button>
        </form>

        <div className="mt-6 overflow-hidden rounded-lg border bg-card">
          {listQ.data?.length ? (
            <ul className="divide-y">
              {listQ.data.map((row) => (
                <li key={row.email} className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-medium">{row.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Added {new Date(row.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => rmMut.mutate(row.email)}
                    aria-label={`Remove ${row.email}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-6 text-sm text-muted-foreground">No allow-listed emails yet.</p>
          )}
        </div>

        <div className="mt-16 rounded-xl border border-destructive/30 bg-destructive/5 p-6">
          <h3 className="text-base font-medium text-destructive">Clear everything</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Delete every deck, slide, and uploaded file for <strong>every user</strong>. This
            cannot be undone.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" className="mt-3">
                Wipe all data
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Wipe everything across all users?</AlertDialogTitle>
                <AlertDialogDescription>
                  Every deck, slide, and uploaded file will be permanently deleted for every user.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => wipeMut.mutate()}>
                  Yes, wipe everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </main>
    </div>
  );
}
