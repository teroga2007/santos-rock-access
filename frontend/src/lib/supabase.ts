import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
// Accept the legacy variable name, but never initialize a browser client with a secret key.
const publicKey = key && !key.startsWith('sb_secret_') ? key : null;
export const supabase = url && publicKey ? createClient(url, publicKey) : null;
