import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import logoAsset from "@/assets/sau-logo-white.png.asset.json";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — SAU Meeting Presenter" },
      {
        name: "description",
        content: "Sign in with your @southern.edu Google account to use the meeting presenter.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);

  useEffect(() => {
    // If already signed in, send them home
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);

  async function signIn() {
    setLoading(true);
    setUnauthorized(null);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    setLoading(false);
    if (result.error) {
      const msg = result.error.message ?? String(result.error);
      if (/not authorized|not allowed|southern\.edu/i.test(msg)) {
        setUnauthorized(
          "That email isn't authorized. Please sign in with your @southern.edu Google account, or ask an admin to add your address.",
        );
        await supabase.auth.signOut();
      } else {
        toast.error("Sign-in failed: " + msg);
      }
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-primary px-6 py-12">
      <div className="w-full max-w-md rounded-2xl bg-card p-10 shadow-2xl">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-6 rounded-xl bg-primary px-6 py-5">
            <img src={logoAsset.url} alt="Southern Adventist University" className="h-12" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Meeting Presenter
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in with your Southern Adventist University Google account to build and run
            presentations.
          </p>
        </div>

        {unauthorized ? (
          <div className="mb-6 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {unauthorized}
          </div>
        ) : null}

        <Button onClick={signIn} disabled={loading} className="w-full" size="lg">
          {loading ? "Opening Google…" : "Sign in with Google"}
        </Button>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Only @southern.edu accounts (or admin-invited guests) can sign in.
        </p>
      </div>
    </div>
  );
}
