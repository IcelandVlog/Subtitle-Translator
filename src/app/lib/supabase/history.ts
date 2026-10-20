import { getSupabase } from "./client";
import { downloadFile } from "@/app/utils/fileUtils";

export const HISTORY_UPDATED_EVENT = "translation-history-updated";

export type SavedFile = { name: string; content: string };

export type HistoryItem = {
  type: "file" | "zip" | "job";
  id: string;
  title: string;
  target_lang: string;
  created_at: string;
  expires_at: string;
  file_count: number;
};

export type AccountState = { signedIn: boolean; email: string | null; isAnonymous: boolean };

const notify = () => window.dispatchEvent(new Event(HISTORY_UPDATED_EVENT));

/**
 * Make sure this browser has a Supabase session. Without login the first visit creates an
 * anonymous user, and RLS keeps each browser's rows private.
 */
export const ensureSession = async (): Promise<boolean> => {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { data } = await sb.auth.getSession();
    if (data.session) return true;
    const { error } = await sb.auth.signInAnonymously();
    if (error) {
      console.warn("Anonymous sign-in failed:", error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("Supabase session error:", error);
    return false;
  }
};

// All saves are fire-and-forget so a slow or failed upload never holds up the translation loop.

/** One finished single file. */
export const saveTranslationOutput = async (fileName: string, targetLang: string, content: string): Promise<void> => {
  try {
    const sb = getSupabase();
    if (!sb || !(await ensureSession())) return;
    const { error } = await sb.from("translation_outputs").insert({ file_name: fileName, target_lang: targetLang, content, kind: "file", file_count: 1 });
    if (error) return console.warn("Translation history save failed:", error.message);
    notify();
  } catch (error) {
    console.warn("Translation history save failed:", error);
  }
};

/** A finished batch, stored as one zip entry in history. */
export const saveTranslationBatch = async (files: SavedFile[]): Promise<void> => {
  if (files.length === 0) return;
  try {
    const sb = getSupabase();
    if (!sb || !(await ensureSession())) return;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const { error } = await sb.from("translation_outputs").insert({
      file_name: `translations-${stamp}.zip`,
      target_lang: "",
      content: JSON.stringify(files),
      kind: "zip",
      file_count: files.length,
    });
    if (error) return console.warn("Batch history save failed:", error.message);
    notify();
  } catch (error) {
    console.warn("Batch history save failed:", error);
  }
};

/** A stopped translation: the original files, so it can be continued from the line cache. */
export const saveTranslationJob = async (title: string, files: SavedFile[]): Promise<void> => {
  if (files.length === 0) return;
  try {
    const sb = getSupabase();
    if (!sb || !(await ensureSession())) return;
    const { error } = await sb.from("translation_jobs").insert({ title, file_count: files.length, payload: files });
    if (error) return console.warn("Paused job save failed:", error.message);
    notify();
  } catch (error) {
    console.warn("Paused job save failed:", error);
  }
};

type OutputRow = { id: string; file_name: string; target_lang: string; created_at: string; expires_at: string; kind: string; file_count: number };
type JobRow = { id: string; title: string; created_at: string; expires_at: string; file_count: number };

export const listHistory = async (): Promise<HistoryItem[]> => {
  const sb = getSupabase();
  if (!sb) return [];
  const [outputs, jobs] = await Promise.all([
    sb.from("translation_outputs").select("id, file_name, target_lang, created_at, expires_at, kind, file_count").order("created_at", { ascending: false }).limit(100),
    sb.from("translation_jobs").select("id, title, created_at, expires_at, file_count").order("created_at", { ascending: false }).limit(100),
  ]);
  if (outputs.error) throw outputs.error;
  if (jobs.error) throw jobs.error;
  const rows: HistoryItem[] = [
    ...((outputs.data ?? []) as OutputRow[]).map((r) => ({
      type: r.kind === "zip" ? ("zip" as const) : ("file" as const),
      id: r.id,
      title: r.file_name,
      target_lang: r.target_lang ?? "",
      created_at: r.created_at,
      expires_at: r.expires_at,
      file_count: r.file_count ?? 1,
    })),
    ...((jobs.data ?? []) as JobRow[]).map((r) => ({
      type: "job" as const,
      id: r.id,
      title: r.title,
      target_lang: "",
      created_at: r.created_at,
      expires_at: r.expires_at,
      file_count: r.file_count,
    })),
  ];
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
};

/** Build a zip from saved files. Duplicate names get " (n)". */
export const buildZip = async (files: SavedFile[]): Promise<Blob> => {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const used = new Map<string, number>();
  for (const f of files) {
    const count = used.get(f.name) ?? 0;
    used.set(f.name, count + 1);
    const dot = f.name.lastIndexOf(".");
    const name = count === 0 ? f.name : dot > 0 ? `${f.name.slice(0, dot)} (${count})${f.name.slice(dot)}` : `${f.name} (${count})`;
    zip.file(name, f.content);
  }
  return zip.generateAsync({ type: "blob" });
};

export const downloadHistoryItem = async (item: HistoryItem): Promise<void> => {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not available");
  const { data, error } = await sb.from("translation_outputs").select("content").eq("id", item.id).single();
  if (error) throw error;
  const content = (data as { content: string }).content;
  if (item.type === "zip") {
    const blob = await buildZip(JSON.parse(content) as SavedFile[]);
    await downloadFile(blob, item.title, "application/zip");
  } else {
    await downloadFile(content, item.title);
  }
};

export const loadJobFiles = async (id: string): Promise<SavedFile[]> => {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not available");
  const { data, error } = await sb.from("translation_jobs").select("payload").eq("id", id).single();
  if (error) throw error;
  return (data as { payload: SavedFile[] }).payload;
};

export const deleteHistoryItem = async (item: HistoryItem): Promise<void> => {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not available");
  const table = item.type === "job" ? "translation_jobs" : "translation_outputs";
  const { error } = await sb.from(table).delete().eq("id", item.id);
  if (error) throw error;
};

/** Listen for login / logout / token refresh; also cleans the #access_token from the URL. */
export const onUserChange = (cb: () => void): (() => void) => {
  const sb = getSupabase();
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange(() => {
    if (typeof window !== "undefined" && window.location.hash.includes("access_token=")) {
      try {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      } catch {
        // cosmetic only
      }
    }
    cb();
  });
  return () => data.subscription.unsubscribe();
};

export const getAccountState = async (): Promise<AccountState> => {
  const sb = getSupabase();
  if (!sb) return { signedIn: false, email: null, isAnonymous: true };
  try {
    const { data } = await sb.auth.getSession();
    const user = data.session?.user;
    if (!user) return { signedIn: false, email: null, isAnonymous: true };
    const isAnonymous = Boolean((user as { is_anonymous?: boolean }).is_anonymous);
    return { signedIn: !isAnonymous, email: user.email ?? null, isAnonymous };
  } catch {
    return { signedIn: false, email: null, isAnonymous: true };
  }
};

/** Email login. From an anonymous browser it links the email to the same account (history comes along). */
export const sendEmailLogin = async (email: string): Promise<void> => {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not available");
  const redirect = window.location.href.split("#")[0];
  const { data } = await sb.auth.getSession();
  const isAnonymous = Boolean((data.session?.user as { is_anonymous?: boolean } | undefined)?.is_anonymous);
  if (isAnonymous) {
    const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: redirect });
    if (error) throw error;
    return;
  }
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } });
  if (error) throw error;
};

export const signOutAccount = async (): Promise<void> => {
  await getSupabase()?.auth.signOut();
  await ensureSession();
};
