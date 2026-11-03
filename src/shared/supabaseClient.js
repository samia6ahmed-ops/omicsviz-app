import { createClient } from "@supabase/supabase-js";

// Strip stray whitespace/newlines/quotes that often sneak in when pasting
// values into the Vercel dashboard (they cause "Invalid value" fetch errors).
const clean = (v) => (v || "").replace(/[\s"'​-‍﻿]/g, "");
const url = clean(import.meta.env.VITE_SUPABASE_URL);
const key = clean(import.meta.env.VITE_SUPABASE_ANON_KEY);

// If Supabase hasn't been configured yet (no .env set up), we export null
// instead of throwing, so the app still runs fully in "no accounts" mode.
export const supabase = url && key ? createClient(url, key) : null;

export const authConfigured = Boolean(supabase);
