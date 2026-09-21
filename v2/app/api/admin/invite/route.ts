import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  if (request.headers.get('origin') !== origin) return reply({ error: 'Invalid request origin.' }, 403);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !serviceKey) return reply({ error: 'Staff invitations are not configured.' }, 503);
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return reply({ error: 'Sign in as an administrator.' }, 401);
  const publicClient = createClient(url, anon, { auth: { persistSession: false } });
  const account = await publicClient.auth.getUser(token);
  if (!account.data.user || account.error) return reply({ error: 'Session expired. Sign in again.' }, 401);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const profile = await admin.from('profiles').select('role').eq('id', account.data.user.id).single();
  if (profile.error || profile.data?.role !== 'Admin') return reply({ error: 'Administrator access required.' }, 403);
  let email: unknown;
  try { email = (await request.json() as { email?: unknown }).email; } catch { return reply({ error: 'Enter a valid email address.' }, 400); }
  if (typeof email !== 'string' || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: 'Enter a valid email address.' }, 400);
  const invited = await admin.auth.admin.inviteUserByEmail(email.trim().toLowerCase());
  if (invited.error) return reply({ error: invited.error.message }, 400);
  return reply({ ok: true });
}
