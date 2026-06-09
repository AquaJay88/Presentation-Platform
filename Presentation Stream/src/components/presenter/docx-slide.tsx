import { useEffect, useRef, useState } from "react";

// docx-preview renders a .docx file into a DOM container using its own
// embedded styles, fonts, and layout — much higher fidelity than mammoth.
export function DocxSlide({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setReady(false);
    (async () => {
      try {
        if (!containerRef.current) return;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        const blob = await res.blob();
        const { renderAsync } = await import("docx-preview");
        if (cancelled || !containerRef.current) return;
        // Clear before rendering (StrictMode double-effect safety).
        containerRef.current.innerHTML = "";
        await renderAsync(blob, containerRef.current, undefined, {
          className: "docx-preview",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          experimental: true,
          useBase64URL: true,
        });
        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled) {
          console.error("Docx render error", e);
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="h-full w-full overflow-auto bg-neutral-200 py-8">
      {error ? (
        <div className="mx-auto max-w-md p-6 text-center text-sm text-red-700">
          <p className="mb-2 font-medium">Could not display Word document.</p>
          <p className="text-xs opacity-70">{error}</p>
        </div>
      ) : null}
      {!ready && !error ? (
        <p className="text-center text-sm text-neutral-600">Loading document…</p>
      ) : null}
      <div ref={containerRef} className="docx-preview-host" />
    </div>
  );
}
