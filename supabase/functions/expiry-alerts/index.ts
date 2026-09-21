import { createClient } from 'npm:@supabase/supabase-js@2';

type Vehicle = { id: string; plate_number: string; site: string; roadworthy_expiry_date: string | null; insurance_expiry_date: string | null };
type Profile = { id: string; role: string; site: string | null };
const thresholds = [7, 14, 30];

function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function daysUntil(date: string) {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.parse(date + 'T00:00:00Z') - start) / 86400000);
}

Deno.serve(async request => {
  const expected = Deno.env.get('ALERT_CRON_SECRET');
  const supplied = request.headers.get('x-alert-secret') || '';
  if (request.method !== 'POST' || !expected || !equal(supplied, expected)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('ALERT_FROM_EMAIL');
  if (!url || !serviceKey || !resendKey || !from) return Response.json({ error: 'Alerts are not configured' }, { status: 503 });
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const [fleet, contacts] = await Promise.all([
    db.from('vehicles').select('id,plate_number,site,roadworthy_expiry_date,insurance_expiry_date'),
    db.from('profiles').select('id,role,site'),
  ]);
  if (fleet.error || contacts.error) return Response.json({ error: 'Could not load alert data' }, { status: 503 });

  const emailById = new Map<string, string>();
  for (let page = 1; ; page++) {
    const listed = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (listed.error) return Response.json({ error: 'Could not load staff contacts' }, { status: 503 });
    for (const user of listed.data.users) if (user.email) emailById.set(user.id, user.email);
    if (listed.data.users.length < 1000) break;
  }

  let sent = 0;
  for (const vehicle of (fleet.data || []) as Vehicle[]) {
    for (const [kind, date] of [['roadworthy', vehicle.roadworthy_expiry_date], ['insurance', vehicle.insurance_expiry_date]] as const) {
      if (!date) continue;
      const days = daysUntil(date);
      if (days < 0 || days > 30) continue;
      const threshold = thresholds.find(value => days <= value);
      if (!threshold) continue;
      const recipients = [...new Set(((contacts.data || []) as Profile[])
        .filter(person => person.role === 'Admin' || (person.role === 'Editor' && person.site === vehicle.site))
        .map(person => emailById.get(person.id)).filter((email): email is string => !!email))];
      if (!recipients.length) continue;
      const claim = await db.from('alert_deliveries').insert({ vehicle_id: vehicle.id, document_kind: kind, expiry_date: date, days_before: threshold }).select('id').single();
      if (claim.error) {
        if (claim.error.code === '23505') continue;
        console.error('Alert claim failed', claim.error);
        continue;
      }
      const message = `${vehicle.plate_number} at ${vehicle.site}: ${kind} expires on ${date} (${days} days remaining). Open the Rabotec fleet tracker to arrange renewal.`;
      const delivered = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: recipients, subject: `Rabotec ${kind} renewal: ${vehicle.plate_number}`, text: message }),
      });
      if (!delivered.ok) {
        console.error('Email delivery failed', delivered.status, await delivered.text());
        await db.from('alert_deliveries').delete().eq('id', claim.data.id);
        continue;
      }
      sent++;
    }
  }
  return Response.json({ sent });
});
