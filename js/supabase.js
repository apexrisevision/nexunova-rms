const SUPABASE_URL = 'https://itqxljtfbrppntgyfush.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_OkIT2ttNgBiOm-E4HJLnFw_OmIz-8VG';

const { createClient } = window.supabase;
// flowType:'pkce' is required — v2.34.0 defaults to 'implicit'.
// Without PKCE the reset email lands with #access_token= hash, not ?code=,
// so exchangeCodeForSession() never fires and password reset is broken.
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: true,
  }
});
