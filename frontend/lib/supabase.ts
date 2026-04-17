import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Clients are created lazily so the build doesn't fail when env vars are absent.
// API routes and hooks should call getSupabase() / getSupabaseAdmin() rather than
// importing the clients directly.

let _public: SupabaseClient | null = null;
let _admin: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return null;
  if (!_public) _public = createClient(url, anon);
  return _public;
}

export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return null;
  if (!_admin) _admin = createClient(url, service);
  return _admin;
}
