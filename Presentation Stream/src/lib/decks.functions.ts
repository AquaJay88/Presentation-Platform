import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ----------------- DECKS -----------------

export const listMyDecks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("decks")
      .select("id,title,created_at,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { title?: string }) =>
    z.object({ title: z.string().min(1).max(200).optional() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: deck, error } = await context.supabase
      .from("decks")
      .insert({
        owner_id: context.userId,
        title: data.title ?? "Untitled deck",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: deck.id };
  });

export const getDeck = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: deck, error } = await context.supabase
      .from("decks")
      .select("id,title,owner_id,created_at,updated_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!deck) throw new Error("Deck not found");

    const { data: slides, error: sErr } = await context.supabase
      .from("slides")
      .select("id,position,kind,title,payload,storage_path,agenda_item_id")
      .eq("deck_id", data.id)
      .order("position", { ascending: true });
    if (sErr) throw new Error(sErr.message);

    // Sign URLs for storage-backed slides
    const signed: Record<string, string> = {};
    for (const s of slides ?? []) {
      if (s.storage_path) {
        const { data: urlData } = await context.supabase.storage
          .from("presenter-files")
          .createSignedUrl(s.storage_path, 60 * 60 * 4);
        if (urlData?.signedUrl) signed[s.id] = urlData.signedUrl;
      }
    }

    const { data: agenda, error: aErr } = await context.supabase
      .from("agenda_items")
      .select("id,position,title,leader,transition_delay_ms")
      .eq("deck_id", data.id)
      .order("position", { ascending: true });
    if (aErr) throw new Error(aErr.message);

    return { deck, slides: slides ?? [], signedUrls: signed, agenda: agenda ?? [] };
  });



export const renameDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; title: string }) =>
    z.object({ id: z.string().uuid(), title: z.string().min(1).max(200) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("decks")
      .update({ title: data.title })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    // Gather storage files owned via this deck
    const { data: slides } = await context.supabase
      .from("slides")
      .select("storage_path")
      .eq("deck_id", data.id);
    const paths = (slides ?? []).map((s) => s.storage_path).filter(Boolean) as string[];
    if (paths.length) {
      await context.supabase.storage.from("presenter-files").remove(paths);
    }
    const { error } = await context.supabase.from("decks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ----------------- SLIDES -----------------

const slideKind = z.enum(["youtube", "pdf", "image", "text", "website", "docx"]);

export const addSlide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      deck_id: string;
      kind: string;
      title?: string | null;
      payload?: Record<string, unknown>;
      storage_path?: string | null;
    }) =>
      z
        .object({
          deck_id: z.string().uuid(),
          kind: slideKind,
          title: z.string().max(200).nullable().optional(),
          payload: z.record(z.unknown()).optional(),
          storage_path: z.string().nullable().optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    // next position
    const { data: maxRow } = await context.supabase
      .from("slides")
      .select("position")
      .eq("deck_id", data.deck_id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = (maxRow?.position ?? -1) + 1;

    const { data: row, error } = await context.supabase
      .from("slides")
      .insert({
        deck_id: data.deck_id,
        owner_id: context.userId,
        kind: data.kind,
        title: data.title ?? null,
        payload: (data.payload ?? {}) as never,
        storage_path: data.storage_path ?? null,
        position: nextPos,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // bump deck updated_at
    await context.supabase
      .from("decks")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", data.deck_id);

    return { id: row.id };
  });

export const updateSlide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { id: string; title?: string | null; payload?: Record<string, unknown> }) =>
      z
        .object({
          id: z.string().uuid(),
          title: z.string().max(200).nullable().optional(),
          payload: z.record(z.unknown()).optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    const patch: { title?: string | null; payload?: never } = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.payload !== undefined) patch.payload = data.payload as never;
    const { error } = await context.supabase.from("slides").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSlide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: row } = await context.supabase
      .from("slides")
      .select("storage_path,deck_id")
      .eq("id", data.id)
      .maybeSingle();
    if (row?.storage_path) {
      await context.supabase.storage.from("presenter-files").remove([row.storage_path]);
    }
    const { error } = await context.supabase.from("slides").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderSlides = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { deck_id: string; ordered_ids: string[] }) =>
    z
      .object({
        deck_id: z.string().uuid(),
        ordered_ids: z.array(z.string().uuid()).min(1).max(500),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    // Two-phase update to avoid unique conflicts if they exist (none here, but safe).
    for (let i = 0; i < data.ordered_ids.length; i++) {
      const { error } = await context.supabase
        .from("slides")
        .update({ position: i })
        .eq("id", data.ordered_ids[i])
        .eq("deck_id", data.deck_id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// ----------------- UPLOAD URL (signed) -----------------

export const createUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { deck_id: string; filename: string }) =>
    z
      .object({
        deck_id: z.string().uuid(),
        filename: z
          .string()
          .min(1)
          .max(200)
          .regex(/^[a-zA-Z0-9._-]+$/, "Only letters, numbers, dot, dash, underscore"),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const path = `${context.userId}/${data.deck_id}/${Date.now()}-${data.filename}`;
    const { data: urlData, error } = await context.supabase.storage
      .from("presenter-files")
      .createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    return { path, token: urlData.token, signedUrl: urlData.signedUrl };
  });

// ----------------- ME / ADMIN -----------------

export const getMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("id,email,display_name,avatar_url")
      .eq("id", context.userId)
      .maybeSingle();
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    return { profile, isAdmin };
  });

export const clearMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Delete all storage files under this user's prefix
    const { data: list } = await context.supabase.storage
      .from("presenter-files")
      .list(context.userId, { limit: 1000 });
    // Walk one level into deck folders
    const allPaths: string[] = [];
    for (const entry of list ?? []) {
      const { data: inner } = await context.supabase.storage
        .from("presenter-files")
        .list(`${context.userId}/${entry.name}`, { limit: 1000 });
      for (const f of inner ?? []) {
        allPaths.push(`${context.userId}/${entry.name}/${f.name}`);
      }
    }
    if (allPaths.length) {
      await context.supabase.storage.from("presenter-files").remove(allPaths);
    }
    const { error } = await context.supabase
      .from("decks")
      .delete()
      .eq("owner_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true, removed_files: allPaths.length };
  });

// ----------------- ADMIN -----------------

export const adminListAllowedEmails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("allowed_emails")
      .select("email,created_at,added_by")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminAddAllowedEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string }) =>
    z.object({ email: z.string().email().max(255) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("allowed_emails")
      .insert({ email: data.email.toLowerCase(), added_by: context.userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminRemoveAllowedEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string }) =>
    z.object({ email: z.string().email().max(255) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("allowed_emails")
      .delete()
      .eq("email", data.email.toLowerCase());
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminClearEverything = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Verify admin via RLS-protected lookup
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden");

    // Use admin client to wipe everything across users
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // List every top-level user folder, then drill in
    const { data: topLevel } = await supabaseAdmin.storage
      .from("presenter-files")
      .list("", { limit: 1000 });
    const allPaths: string[] = [];
    for (const u of topLevel ?? []) {
      const { data: decks } = await supabaseAdmin.storage
        .from("presenter-files")
        .list(u.name, { limit: 1000 });
      for (const d of decks ?? []) {
        const { data: files } = await supabaseAdmin.storage
          .from("presenter-files")
          .list(`${u.name}/${d.name}`, { limit: 1000 });
        for (const f of files ?? []) {
          allPaths.push(`${u.name}/${d.name}/${f.name}`);
        }
      }
    }
    if (allPaths.length) {
      await supabaseAdmin.storage.from("presenter-files").remove(allPaths);
    }
    await supabaseAdmin.from("decks").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    return { ok: true, removed_files: allPaths.length };
  });

// ----------------- AGENDA ITEMS -----------------

function parseAgendaText(text: string): { title: string; leader: string | null }[] {
  const items: { title: string; leader: string | null }[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    // Strip leading "N.", "N)", "N -", or just "N "
    const stripped = line.replace(/^\s*\d+\s*[.)-]?\s+/, "");
    if (stripped === line.replace(/^\s+/, "")) {
      // No leading number — treat as continuation of previous title
      if (items.length) {
        items[items.length - 1].title += " " + line.trim();
      } else {
        // Standalone line, accept as item
        const parts = line.split("\t").map((p) => p.trim()).filter(Boolean);
        items.push({ title: parts[0] ?? line.trim(), leader: parts.slice(1).join(", ") || null });
      }
      continue;
    }
    const parts = stripped.split("\t").map((p) => p.trim()).filter(Boolean);
    items.push({ title: parts[0] ?? stripped.trim(), leader: parts.slice(1).join(", ") || null });
  }
  return items;
}

export const parseAndReplaceAgenda = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { deck_id: string; text: string }) =>
    z.object({ deck_id: z.string().uuid(), text: z.string().min(1).max(20000) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const parsed = parseAgendaText(data.text);
    if (!parsed.length) throw new Error("No agenda items found in that text.");

    // Load existing to attempt slide preservation by title match
    const { data: existing } = await context.supabase
      .from("agenda_items")
      .select("id,title")
      .eq("deck_id", data.deck_id);
    const existingByTitle = new Map((existing ?? []).map((e) => [e.title.toLowerCase().trim(), e.id]));

    // Unassign all slides first (FK ON DELETE SET NULL will also kick in, but we want
    // to preserve assignments via title match below)
    const { data: slidesBefore } = await context.supabase
      .from("slides")
      .select("id,agenda_item_id")
      .eq("deck_id", data.deck_id);
    const slideOldAgendaTitle = new Map<string, string>();
    const idToTitle = new Map((existing ?? []).map((e) => [e.id, e.title.toLowerCase().trim()]));
    for (const s of slidesBefore ?? []) {
      if (s.agenda_item_id) {
        const t = idToTitle.get(s.agenda_item_id);
        if (t) slideOldAgendaTitle.set(s.id, t);
      }
    }

    // Delete existing agenda items (cascade sets slides.agenda_item_id to null)
    await context.supabase.from("agenda_items").delete().eq("deck_id", data.deck_id);

    // Insert new items
    const rows = parsed.map((p, i) => ({
      deck_id: data.deck_id,
      owner_id: context.userId,
      position: i,
      title: p.title,
      leader: p.leader,
    }));
    const { data: inserted, error: iErr } = await context.supabase
      .from("agenda_items")
      .insert(rows)
      .select("id,title");
    if (iErr) throw new Error(iErr.message);

    // Reassign slides by title match
    const newByTitle = new Map((inserted ?? []).map((r) => [r.title.toLowerCase().trim(), r.id]));
    for (const [slideId, oldTitle] of slideOldAgendaTitle.entries()) {
      const newId = newByTitle.get(oldTitle);
      if (newId) {
        await context.supabase.from("slides").update({ agenda_item_id: newId }).eq("id", slideId);
      }
    }

    return { ok: true, count: inserted?.length ?? 0 };
  });

export const updateAgendaItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { id: string; title?: string; leader?: string | null; transition_delay_ms?: number }) =>
      z
        .object({
          id: z.string().uuid(),
          title: z.string().min(1).max(300).optional(),
          leader: z.string().max(200).nullable().optional(),
          transition_delay_ms: z.number().int().min(0).max(10000).optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    const patch: { title?: string; leader?: string | null; transition_delay_ms?: number } = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.leader !== undefined) patch.leader = data.leader;
    if (data.transition_delay_ms !== undefined) patch.transition_delay_ms = data.transition_delay_ms;
    const { error } = await context.supabase.from("agenda_items").update(patch).eq("id", data.id);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAgendaItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("agenda_items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderAgendaItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { deck_id: string; ordered_ids: string[] }) =>
    z.object({
      deck_id: z.string().uuid(),
      ordered_ids: z.array(z.string().uuid()).min(1).max(200),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    for (let i = 0; i < data.ordered_ids.length; i++) {
      const { error } = await context.supabase
        .from("agenda_items")
        .update({ position: i })
        .eq("id", data.ordered_ids[i])
        .eq("deck_id", data.deck_id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const assignSlide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { slide_id: string; agenda_item_id: string | null; position: number }) =>
    z.object({
      slide_id: z.string().uuid(),
      agenda_item_id: z.string().uuid().nullable(),
      position: z.number().int().min(0).max(10000),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("slides")
      .update({ agenda_item_id: data.agenda_item_id, position: data.position })
      .eq("id", data.slide_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderSlidesInGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { agenda_item_id: string | null; ordered_ids: string[] }) =>
    z.object({
      agenda_item_id: z.string().uuid().nullable(),
      ordered_ids: z.array(z.string().uuid()).min(1).max(500),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    for (let i = 0; i < data.ordered_ids.length; i++) {
      const q = context.supabase
        .from("slides")
        .update({ position: i, agenda_item_id: data.agenda_item_id })
        .eq("id", data.ordered_ids[i]);
      const { error } = await q;
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
