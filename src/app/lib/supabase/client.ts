import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Project URL and publishable (anon) key. The publishable key is safe in the browser:
// data access is controlled by Row Level Security policies (see supabase/migrations).
// Override with NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY if needed.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dhunkrhkkjaimugtgmhw.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_IfBXhB4QQfd2kF_SUxUQeA_0N4uQ9CK";

let client: SupabaseClient | null = null;

/** Lazily created browser client. Returns null when running outside the browser (SSR / build). */
export const getSupabase = (): SupabaseClient | null => {
  if (typeof window === "undefined") return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
};
