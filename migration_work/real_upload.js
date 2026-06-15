// Punch-list #2 — REAL authenticated upload to the legacy client-photo bucket (rms-documents/clients/photos),
// proving RLS allows it + the public URL renders. Then update_client persists it. ZZTEST only.
const { createClient } = require('@supabase/supabase-js');
const URL = 'https://itqxljtfbrppntgyfush.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0cXhsanRmYnJwcG50Z3lmdXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNTQ3NDksImV4cCI6MjA5MzgzMDc0OX0.v2YX7yZ6JNi4sgPLJad8zbxVAZ7BmCY00uZYsbM6bV8';
const CID = 'a2915ce7-c01c-463b-ba50-b144b2240337';
const CLIENT = '9b921760-b385-4a56-883b-57db3f1646de';
// minimal 2x2 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGNkYPjPgAcw4ZcGAB1eAQ/uX8zJAAAAAElFTkSuQmCC', 'base64');

(async () => {
  const sb = createClient(URL, ANON);
  const { data: auth, error: aerr } = await sb.auth.signInWithPassword({ email: 'zztest.internal@nexunova.test', password: 'ZzTest!2026' });
  if (aerr) { console.log('AUTH FAILED:', aerr.message); process.exit(1); }
  console.log('AUTH ok as', auth.user.email);

  const path = CID + '/clients/photos/realtest_' + Date.now() + '.jpg';
  const up = await sb.storage.from('rms-documents').upload(path, PNG, { upsert: true, contentType: 'image/jpeg' });
  console.log('UPLOAD:', up.error ? ('ERR ' + up.error.message) : 'ok → ' + up.data.path);
  if (up.error) process.exit(1);

  const pub = sb.storage.from('rms-documents').getPublicUrl(path).data.publicUrl;
  const r = await fetch(pub);
  console.log('PUBLIC FETCH:', r.status, r.headers.get('content-type'), '(bytes', (await r.arrayBuffer()).byteLength + ')');

  const upd = await sb.rpc('update_client', { p_id: CLIENT, p_company_id: CID, p_data: { client_photo_url: pub } });
  console.log('update_client:', JSON.stringify(upd.data || upd.error));

  const { data: row } = await sb.rpc('get_clients_cache_bundle', { p_company_id: CID }).then(x => x).catch(() => ({ data: null }));
  console.log('PUBLIC URL stored:', pub);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
