import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Separate client + storage key from src/lib/supabase.js: a donor session
// must never collide with (or be picked up by) the staff-only App.jsx auth
// check if both are ever opened in the same browser.
export const donorSupabase = url && anonKey
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "ummat-donor-auth" },
    })
  : null;
