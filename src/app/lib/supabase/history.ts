import type { User } from "@supabase/supabase-js";
import { getSupabase } from "./client";

export const HISTORY_UPDATED_EVENT = "translation-history-updated";

export type HistoryItem = {
  id: string;
  file_name: string;
  target_lang: string;
  created_at: string;
  expires_at: string;
};

export const getCurrentUser = async (): Promise<User | null> => {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    return data.session?.user ?? null;
  } catch {
    return null;
  }
};

/** Subscribe to login/logout. Returns an unsubscribe function. */
export const onUserChange = (cb: (user: User | null) => void): (() => void) => {
  const sb = getSupabase();
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null));
  return () => data.subscription.unsubscribe();
};

/** Email a magic link. Clicking it signs the browser in on this page. */
export const sendMagicLink = async (email: string): Promise<void> => {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not available in this environment");
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href.split("#")[0] },
  });
  if (error) throw error;
};

export const signOut = async (): Promise<void> => {
  await getSupabase()?.auth.signOut();
};

/**
 * Save a finished output. Fire-and-forget: callers do not await it, so a slow or
 * failed upload never holds up the translation loop. Does nothing when signed out.
 */
export const saveTranslationOutput = async (fileName: string, targetLang: string, content: string): Promise<void> => {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const user = await getCurrentUser();
    if (!user) return;
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
