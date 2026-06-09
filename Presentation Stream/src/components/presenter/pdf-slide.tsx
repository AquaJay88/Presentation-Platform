import { useEffect, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Bundle the pdf.js worker via Vite so it ships with the app and the version
// always matches the installed pdfjs-dist. Using `new URL(..., import.meta.url)`
// avoids the fragile `?url` import that sometimes 404s in dev.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export function PdfSlide({
  url,
  page,
  onLoaded,
}: {
  url: string;
  page: number;
  onLoaded?: (totalPages: number) => void;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function measure() {
      setSize({ w: window.innerWidth, h: window.innerHeight });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Reset error if url changes
  useEffect(() => {
    setError(null);
  }, [url]);

  return (
    <div className="flex h-full w-full items-center justify-center bg-black">
      {error ? (
        <div className="max-w-md p-6 text-center text-sm text-red-300">
          <p className="mb-2 font-medium">Could not load PDF.</p>
          <p className="text-xs text-white/60">{error}</p>
        </div>
      ) : (
        <Document
          file={url}
          onLoadSuccess={(info) => onLoaded?.(info.numPages)}
          onLoadError={(e) => {
            console.error("PDF load error", e);
            setError(e?.message ?? String(e));
          }}
          onSourceError={(e) => {
            console.error("PDF source error", e);
            setError(e?.message ?? String(e));
          }}
          loading={<p className="text-white/70">Loading PDF…</p>}
        >
          <Page
            pageNumber={page}
            height={size.h ? size.h - 32 : undefined}
            width={size.w && size.w < (size.h - 32) * 1.2 ? size.w - 32 : undefined}
            renderAnnotationLayer={false}
            renderTextLayer={false}
            onRenderError={(e) => {
              console.error("PDF render error", e);
              setError(e?.message ?? String(e));
            }}
          />
        </Document>
      )}
    </div>
  );
}

export function PdfThumbnail({ url }: { url: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-black">
      <Document file={url} loading={null} error={null}>
        <Page
          pageNumber={1}
          height={140}
          renderAnnotationLayer={false}
          renderTextLayer={false}
        />
      </Document>
    </div>
  );
}
