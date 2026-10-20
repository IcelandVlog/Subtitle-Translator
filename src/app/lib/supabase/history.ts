import { getSupabase } from "./client";

export const HISTORY_UPDATED_EVENT = "translation-history-updated";

export type HistoryItem = {
  id: string;
  file_name: string;
  target_lang: string;
  created_at: string;
  expires_at: string;
};

/**
 * Make sure this browser has a Supabase session. No login: the first visit creates an
 * anonymous user (Supabase "anonymous sign-in"), and RLS keeps each browser's rows private.
 * Returns false when Supabase is unavailable (SSR, or the network/provider is down).
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

/**
 * Save a finished output. Fire-and-forget: callers do not await it, so a slow or
 * failed upload never holds up the translation loop.
 */
export const saveTranslationOutput = async (fileName: string, targetLang: string, content: string): Promise<void> => {
  try {
    const sb = getSupabase();
    if (!sb) return;
    if (!(await ensureSession())) return;
    const { error } = await sb.from("translation_outputs").insert({ file_name: fileName, target_lang: targetLang, content });
    if (error) {
      console.warn("Translation history save failed:", error.message);
      return;
    }
    window.dispatchEvent(new Event(HISTORY_UPDATED_EVENT));
  } catch (error) {
    console.warn("Translation history save failed:", error);
  }
};

export const listTranslationOutputs = async (): Promise<HistoryItem[]> => {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("translation_outputs")
    .select("id, file_name, target_lang, created_at, expires_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as HistoryItem[];
};

export const getTranslationOutputContent = async (id: string): Promise<string> => {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not available");
  const { data, error } = await sb.from("translation_outputs").select("content").eq("id", id).single();
  if (error) throw error;
  return (data as { content: string }).content;
};

export const deleteTranslationOutput = async (id: string): Promise<void> => {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not available");
  const { error } = await sb.from("translation_outputs").delete().eq("id", id);
  if (error) throw error;
};
