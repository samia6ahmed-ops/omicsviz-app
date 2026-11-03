import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// If Supabase hasn't been configured yet (no .env set up), we export null
// instead of throwing, so the app still runs fully in "no accounts" mode.
export const supabase = url && key ? createClient(url, key) : null;

export const authConfigured = Boolean(supabase);
