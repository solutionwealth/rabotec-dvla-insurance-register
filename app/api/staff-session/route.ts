import { clearSessionCookie, sessionCookie, staffAuthConfigured, verifyPassword } from '@/lib/staff-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!staffAuthConfigured()) return Response.json({ error: 'Staff access is being configured.' }, { status: 503 });
  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
  let password: unknown;
  try { password = (await request.json() as {password?: unknown}).password; } catch { return Response.json({ error: 'Enter the access password.' }, { status: 400 }); }
  if (typeof password !== 'string' || !await verifyPassword(password)) return Response.json({ error: 'Incorrect password.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': await sessionCookie(), 'Cache-Control': 'no-store' } });
}

export async function DELETE(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie, 'Cache-Control': 'no-store' } });
}
