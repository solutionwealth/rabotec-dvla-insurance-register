'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { blankVehicle, categories, csvCell, daysUntil, expiryStatus, nearestExpiry, operatingStatuses, overallStatus, sites, type Audit, type Profile, type Role, type Vehicle, type VehicleDraft } from '@/lib/fleet';
import { supabase } from '@/lib/supabase';

type View = 'Dashboard' | 'Vehicles' | 'Alerts' | 'Staff';
const dateText = (value: string | null) => value ? new Date(value + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Not recorded';
const statusClass = (status: string) => status === 'Due soon' ? 'pill-Due' : `pill-${status}`;
const readableError = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

export default function Page() {
  const client = supabase();
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('Dashboard');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All groups');
  const [siteFilter, setSiteFilter] = useState('All sites');
  const [statusFilter, setStatusFilter] = useState('All statuses');
  const [editing, setEditing] = useState<(VehicleDraft & { id?: string }) | null>(null);
  const [detail, setDetail] = useState<Vehicle | null>(null);
  const [history, setHistory] = useState<Audit[]>([]);
  const [documentLinks, setDocumentLinks] = useState<{ path: string; url: string }[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const canEdit = profile?.role === 'Admin' || profile?.role === 'Editor';

  const refresh = useCallback(async () => {
    if (!client) return;
    const [account, rows] = await Promise.all([
      client.from('profiles').select('id,full_name,role,site').single(),
      client.from('vehicles').select('*').order('plate_number'),
    ]);
    if (account.error) throw account.error;
    if (rows.error) throw rows.error;
    setProfile(account.data as Profile);
    setVehicles((rows.data || []) as Vehicle[]);
    if ((account.data as Profile).role === 'Admin') {
      const people = await client.from('profiles').select('id,full_name,role,site').order('full_name');
      if (!people.error) setStaff((people.data || []) as Profile[]);
    }
  }, [client]);

  useEffect(() => {
    if (!client) { setLoading(false); return; }
    let active = true;
    const initialize = async () => {
      const result = await client.auth.getUser();
      if (!active) return;
      const id = result.data.user?.id || null;
      setUserId(id);
      if (id) try { await refresh(); } catch (failure) { setError(readableError(failure)); }
      setLoading(false);
    };
    void initialize();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!active) return;
      setUserId(session?.user.id || null);
      if (session) void refresh().catch(failure => setError(readableError(failure)));
      else { setProfile(null); setVehicles([]); }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [client, refresh]);

  const filtered = useMemo(() => vehicles.filter(vehicle =>
    (categoryFilter === 'All groups' || vehicle.category === categoryFilter) &&
    (siteFilter === 'All sites' || vehicle.site === siteFilter) &&
    (statusFilter === 'All statuses' || vehicle.status === statusFilter) &&
    [vehicle.plate_number, vehicle.make_model, vehicle.roadworthy_cert_no, vehicle.insurance_policy_no].join(' ').toLowerCase().includes(search.toLowerCase())
  ), [vehicles, categoryFilter, siteFilter, statusFilter, search]);
  const ordered = useMemo(() => [...filtered].sort((a, b) => (nearestExpiry(a) || '0000').localeCompare(nearestExpiry(b) || '0000')), [filtered]);
  const dueDocuments = useMemo(() => vehicles.flatMap(vehicle => [
    { vehicle, kind: 'Roadworthy', date: vehicle.roadworthy_expiry_date },
    { vehicle, kind: 'Insurance', date: vehicle.insurance_expiry_date },
  ]).filter(item => { const days = daysUntil(item.date); return days === null || days <= 30; }).sort((a, b) => (daysUntil(a.date) ?? -99999) - (daysUntil(b.date) ?? -99999)), [vehicles]);

  async function signIn(event: FormEvent) {
    event.preventDefault(); if (!client) return;
    setBusy(true); setError('');
    const result = await client.auth.signInWithPassword({ email, password });
    if (result.error) setError(result.error.message);
    else setPassword('');
    setBusy(false);
  }

  async function saveVehicle(event: FormEvent) {
    event.preventDefault(); if (!client || !editing || !canEdit) return;
    if (editing.roadworthy_issue_date && editing.roadworthy_expiry_date && editing.roadworthy_issue_date > editing.roadworthy_expiry_date) { setError('Roadworthy issue date must be before its expiry date.'); return; }
    setBusy(true); setError('');
    try {
      const id = editing.id;
      const draft: VehicleDraft = {
        plate_number: editing.plate_number.trim().toUpperCase(), category: editing.category,
        make_model: editing.make_model, site: profile?.site || editing.site, status: editing.status,
        roadworthy_cert_no: editing.roadworthy_cert_no, roadworthy_issue_date: editing.roadworthy_issue_date,
        roadworthy_expiry_date: editing.roadworthy_expiry_date, insurance_provider: editing.insurance_provider,
        insurance_policy_no: editing.insurance_policy_no, insurance_expiry_date: editing.insurance_expiry_date,
        document_urls: editing.document_urls,
      };
      const query = id ? client.from('vehicles').update(draft).eq('id', id) : client.from('vehicles').insert(draft);
      const result = await query.select('*').single();
      if (result.error) throw result.error;
      const saved = result.data as Vehicle;
      let paths = saved.document_urls || [];
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024 || !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Documents must be PDF, JPG, PNG or WebP and no larger than 10 MB.');
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
        const path = `${saved.id}/${crypto.randomUUID()}-${safeName}`;
        const uploaded = await client.storage.from('fleet-documents').upload(path, file, { contentType: file.type, upsert: false });
        if (uploaded.error) throw uploaded.error;
        paths = [...paths, path];
      }
      if (paths.length !== saved.document_urls.length) {
        const updated = await client.from('vehicles').update({ document_urls: paths }).eq('id', saved.id);
        if (updated.error) throw updated.error;
      }
      setEditing(null); setFiles([]); await refresh();
    } catch (failure) { setError(readableError(failure)); }
    setBusy(false);
  }

  async function openDetail(vehicle: Vehicle) {
    if (!client) return;
    setDetail(vehicle); setHistory([]); setDocumentLinks([]);
    const [changes, links] = await Promise.all([
      client.from('audit_log').select('*').eq('vehicle_id', vehicle.id).order('changed_at', { ascending: false }),
      vehicle.document_urls.length ? client.storage.from('fleet-documents').createSignedUrls(vehicle.document_urls, 3600) : Promise.resolve({ data: [], error: null }),
    ]);
    if (changes.error || links.error) setError(changes.error?.message || links.error?.message || 'Could not load vehicle details.');
    setHistory((changes.data || []) as Audit[]);
    setDocumentLinks(((links.data || []) as { signedUrl?: string }[]).map((item, index) => ({ path: vehicle.document_urls[index], url: item.signedUrl || '' })).filter(item => item.url));
  }

  function exportCsv() {
    const headings = ['Plate', 'Category', 'Make / model', 'Site', 'Operating status', 'Roadworthy issue', 'Roadworthy expiry', 'Roadworthy status', 'Insurance provider', 'Policy number', 'Insurance expiry', 'Insurance status'];
    const rows = [headings, ...filtered.map(vehicle => [vehicle.plate_number, vehicle.category, vehicle.make_model, vehicle.site, vehicle.status, vehicle.roadworthy_issue_date, vehicle.roadworthy_expiry_date, expiryStatus(vehicle.roadworthy_expiry_date), vehicle.insurance_provider, vehicle.insurance_policy_no, vehicle.insurance_expiry_date, expiryStatus(vehicle.insurance_expiry_date)])];
    const blob = new Blob(['\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'rabotec-fleet-compliance.csv'; anchor.click(); URL.revokeObjectURL(url);
  }

  async function invite(event: FormEvent) {
    event.preventDefault(); if (!client) return;
    setBusy(true); setError('');
    try {
      const session = await client.auth.getSession();
      const response = await fetch('/api/admin/invite', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.data.session?.access_token || ''}` }, body: JSON.stringify({ email: inviteEmail }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not invite staff member.');
      setInviteEmail(''); alert('Invitation sent. The new account starts as Viewer.');
    } catch (failure) { setError(readableError(failure)); }
    setBusy(false);
  }

  async function updateRole(person: Profile, role: Role) {
    if (!client || profile?.role !== 'Admin') return;
    const result = await client.from('profiles').update({ role }).eq('id', person.id);
    if (result.error) setError(result.error.message);
    else await refresh();
  }

  async function updateSite(person: Profile, site: string | null) {
    if (!client || profile?.role !== 'Admin') return;
    const result = await client.from('profiles').update({ site }).eq('id', person.id);
    if (result.error) setError(result.error.message);
    else await refresh();
  }

  if (!client) return <div className="min-h-screen grid place-items-center p-6"><div className="card p-8 max-w-md"><h1 className="text-2xl font-bold">Tracker setup needed</h1><p className="mt-3 muted">Set the Supabase URL and anonymous key in the Vercel project environment.</p></div></div>;
  if (loading) return <div className="min-h-screen grid place-items-center muted">Loading fleet tracker…</div>;
  if (!userId) return <main className="min-h-screen grid place-items-center p-5"><form onSubmit={signIn} className="card w-full max-w-md overflow-hidden"><div className="brand-line"/><div className="p-8 flex flex-col gap-4"><img src="https://rabotecgroup.com/images/header/160x40-px-logo.jpg" width="160" height="40" alt="Rabotec"/><span className="text-xs tracking-widest font-bold text-blue-800">FLEET COMPLIANCE</span><h1 className="text-2xl font-bold">Staff sign in</h1><p className="muted">Use the account issued by your fleet administrator.</p><label className="field">Email<input type="email" required autoComplete="username" value={email} onChange={event => setEmail(event.target.value)}/></label><label className="field">Password<input type="password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)}/></label>{error && <p className="error" role="alert">{error}</p>}<button className="btn btn-primary" disabled={busy}>Sign in</button></div></form></main>;

  return <div className="min-h-screen"><div className="brand-line"/><header className="bg-white border-b border-slate-200 px-4 md:px-8 py-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-4"><img src="https://rabotecgroup.com/images/header/160x40-px-logo.jpg" width="128" height="32" alt="Rabotec"/><div><strong className="block text-base">Fleet compliance</strong><span className="text-xs muted">Abore Pit · Esaase Pit</span></div></div><div className="flex items-center gap-3 text-sm"><span className="muted">{profile?.full_name || 'Staff'} · {profile?.role}</span><a className="btn btn-light" href="/account/password">Password</a><button className="btn btn-light" onClick={() => void client.auth.signOut()}>Sign out</button></div></header>
    <main className="max-w-7xl mx-auto p-4 md:p-8"><nav className="flex flex-wrap gap-2 mb-6" aria-label="Fleet sections">{(['Dashboard', 'Vehicles', 'Alerts', ...(profile?.role === 'Admin' ? ['Staff'] : [])] as View[]).map(item => <button key={item} className={`btn ${view === item ? 'btn-primary' : 'btn-light'}`} onClick={() => setView(item)}>{item}</button>)}</nav>
    {error && <div className="error mb-5 flex justify-between gap-3" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    {view === 'Dashboard' && <><div className="flex flex-wrap items-end justify-between gap-3 mb-5"><div><h1 className="text-3xl font-bold">Fleet overview</h1><p className="muted mt-1">Roadworthy and insurance status across your accessible sites.</p></div>{canEdit && <button className="btn btn-primary" onClick={() => setEditing({ ...blankVehicle, site: profile?.site || 'Abore Pit' })}>Add vehicle</button>}</div><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">{[['Vehicles', vehicles.length], ['Current', vehicles.filter(vehicle => overallStatus(vehicle) === 'Current').length], ['Due soon', vehicles.filter(vehicle => overallStatus(vehicle) === 'Due soon').length], ['Action required', vehicles.filter(vehicle => ['Expired', 'Missing'].includes(overallStatus(vehicle))).length]].map(([label, count]) => <div className="card p-5" key={label}><span className="muted text-sm">{label}</span><strong className="block text-3xl mt-3">{count}</strong></div>)}</div><div className="card overflow-hidden"><div className="p-5 border-b border-slate-200"><h2 className="text-lg font-bold">Nearest document expiry</h2><p className="muted text-sm">Missing dates appear first and need review.</p></div><VehicleTable vehicles={[...vehicles].sort((a, b) => (nearestExpiry(a) || '0000').localeCompare(nearestExpiry(b) || '0000')).slice(0, 10)} openDetail={openDetail}/></div></>}
    {view === 'Vehicles' && <><div className="flex flex-wrap items-end justify-between gap-3 mb-5"><div><h1 className="text-3xl font-bold">Vehicle register</h1><p className="muted mt-1">{filtered.length} vehicles match your filters.</p></div><div className="flex flex-wrap gap-2"><button className="btn btn-light" onClick={exportCsv}>Export CSV</button>{canEdit && <button className="btn btn-primary" onClick={() => setEditing({ ...blankVehicle, site: profile?.site || 'Abore Pit' })}>Add vehicle</button>}</div></div><div className="card p-4 mb-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3"><input aria-label="Search vehicles" placeholder="Search plate or document number" value={search} onChange={event => setSearch(event.target.value)}/><select aria-label="Category" value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}>{['All groups', ...categories].map(item => <option key={item}>{item}</option>)}</select><select aria-label="Site" value={siteFilter} onChange={event => setSiteFilter(event.target.value)}>{['All sites', ...sites].map(item => <option key={item}>{item}</option>)}</select><select aria-label="Operating status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>{['All statuses', ...operatingStatuses].map(item => <option key={item}>{item}</option>)}</select></div><div className="card overflow-hidden"><VehicleTable vehicles={ordered} openDetail={openDetail}/></div></>}
    {view === 'Alerts' && <><h1 className="text-3xl font-bold mb-1">Renewal alerts</h1><p className="muted mb-5">Missing, expired, and due within 30 days. Email reminders are sent at 30, 14, and 7 days when scheduled alerts are configured.</p><div className="card divide-y divide-slate-200">{dueDocuments.length ? dueDocuments.map(item => <button key={`${item.vehicle.id}-${item.kind}`} className="w-full text-left p-4 flex flex-wrap items-center justify-between gap-2 hover:bg-slate-50" onClick={() => void openDetail(item.vehicle)}><span><strong>{item.vehicle.plate_number}</strong><span className="muted text-sm ml-2">{item.vehicle.site} · {item.kind}</span></span><span className="flex gap-3 items-center"><span>{dateText(item.date)}</span><Status value={expiryStatus(item.date)}/></span></button>) : <p className="p-6 muted">No documents need attention within 30 days.</p>}</div></>}
    {view === 'Staff' && profile?.role === 'Admin' && <><h1 className="text-3xl font-bold mb-1">Staff access</h1><p className="muted mb-5">Invite staff by email, then set their role. Viewers can read records; Editors and Admins can change them.</p><form className="card p-5 flex flex-wrap gap-3 mb-5" onSubmit={invite}><input type="email" required className="flex-1 min-w-56" placeholder="Staff email address" value={inviteEmail} onChange={event => setInviteEmail(event.target.value)}/><button className="btn btn-primary" disabled={busy}>Send invitation</button></form><div className="card divide-y divide-slate-200">{staff.map(person => <div key={person.id} className="p-4 flex flex-wrap items-center justify-between gap-3"><span><strong>{person.full_name || 'Staff member'}</strong><span className="block text-xs muted">{person.id}</span></span><div className="flex gap-2"><select aria-label={`Role for ${person.full_name || person.id}`} value={person.role} onChange={event => void updateRole(person, event.target.value as Role)}>{['Admin', 'Editor', 'Viewer'].map(role => <option key={role}>{role}</option>)}</select><select aria-label={`Site for ${person.full_name || person.id}`} value={person.site || ''} onChange={event => void updateSite(person, event.target.value || null)}><option value="">All sites</option>{sites.map(site => <option key={site} value={site}>{site}</option>)}</select></div></div>)}</div></>}
    </main>
    {editing && <div className="dialog-backdrop" role="presentation"><div className="dialog card" role="dialog" aria-modal="true" aria-label={editing.id ? 'Edit vehicle' : 'Add vehicle'}><div className="flex justify-between gap-3 mb-4"><h2 className="text-xl font-bold">{editing.id ? 'Edit vehicle' : 'Add vehicle'}</h2><button onClick={() => { setEditing(null); setFiles([]); }} aria-label="Close">×</button></div><form onSubmit={saveVehicle}><div className="grid sm:grid-cols-2 gap-4"><Field label="Plate number"><input required value={editing.plate_number} onChange={event => setEditing({ ...editing, plate_number: event.target.value })}/></Field><Field label="Category"><select value={editing.category} onChange={event => setEditing({ ...editing, category: event.target.value })}>{categories.map(item => <option key={item}>{item}</option>)}</select></Field><Field label="Make / model"><input value={editing.make_model} onChange={event => setEditing({ ...editing, make_model: event.target.value })}/></Field><Field label="Site"><select value={editing.site} disabled={!!profile?.site} onChange={event => setEditing({ ...editing, site: event.target.value })}>{sites.map(item => <option key={item}>{item}</option>)}</select></Field><Field label="Operating status"><select value={editing.status} onChange={event => setEditing({ ...editing, status: event.target.value })}>{operatingStatuses.map(item => <option key={item}>{item}</option>)}</select></Field><div/><h3 className="sm:col-span-2 font-bold border-t border-slate-200 pt-4">Roadworthy certificate</h3><Field label="Certificate number"><input value={editing.roadworthy_cert_no} onChange={event => setEditing({ ...editing, roadworthy_cert_no: event.target.value })}/></Field><Field label="Issue date"><input type="date" value={editing.roadworthy_issue_date || ''} onChange={event => setEditing({ ...editing, roadworthy_issue_date: event.target.value || null })}/></Field><Field label="Expiry date"><input type="date" value={editing.roadworthy_expiry_date || ''} onChange={event => setEditing({ ...editing, roadworthy_expiry_date: event.target.value || null })}/></Field><div/><h3 className="sm:col-span-2 font-bold border-t border-slate-200 pt-4">Insurance</h3><Field label="Provider"><input value={editing.insurance_provider} onChange={event => setEditing({ ...editing, insurance_provider: event.target.value })}/></Field><Field label="Policy number"><input value={editing.insurance_policy_no} onChange={event => setEditing({ ...editing, insurance_policy_no: event.target.value })}/></Field><Field label="Expiry date"><input type="date" value={editing.insurance_expiry_date || ''} onChange={event => setEditing({ ...editing, insurance_expiry_date: event.target.value || null })}/></Field><Field label="Documents"><input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={event => setFiles(Array.from(event.target.files || []))}/></Field></div><div className="flex justify-end gap-2 mt-6"><button type="button" className="btn btn-light" onClick={() => { setEditing(null); setFiles([]); }}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save vehicle'}</button></div></form></div></div>}
    {detail && <div className="dialog-backdrop" role="presentation"><div className="dialog card" role="dialog" aria-modal="true" aria-label="Vehicle details"><div className="flex justify-between gap-3 mb-4"><div><h2 className="text-xl font-bold">{detail.plate_number}</h2><p className="muted">{detail.make_model} · {detail.category} · {detail.site}</p></div><button onClick={() => setDetail(null)} aria-label="Close">×</button></div><div className="grid sm:grid-cols-2 gap-4"><div className="card p-4"><h3 className="font-bold mb-2">Roadworthy</h3><p>Certificate: {detail.roadworthy_cert_no || 'Not recorded'}</p><p>Issued: {dateText(detail.roadworthy_issue_date)}</p><p>Expires: {dateText(detail.roadworthy_expiry_date)}</p><Status value={expiryStatus(detail.roadworthy_expiry_date)}/></div><div className="card p-4"><h3 className="font-bold mb-2">Insurance</h3><p>Provider: {detail.insurance_provider || 'Not recorded'}</p><p>Policy: {detail.insurance_policy_no || 'Not recorded'}</p><p>Expires: {dateText(detail.insurance_expiry_date)}</p><Status value={expiryStatus(detail.insurance_expiry_date)}/></div></div><h3 className="font-bold mt-5 mb-2">Documents</h3>{documentLinks.length ? <div className="flex flex-wrap gap-2">{documentLinks.map((item, index) => <a key={item.path} className="btn btn-light" href={item.url} target="_blank" rel="noreferrer">Open document {index + 1}</a>)}</div> : <p className="muted">No documents uploaded.</p>}<h3 className="font-bold mt-5 mb-2">Change history</h3><div className="divide-y divide-slate-200">{history.length ? history.map(item => <div className="py-2 text-sm" key={item.id}><strong>{item.change_summary}</strong><span className="block muted">{new Date(item.changed_at).toLocaleString('en-GB')} · {item.changed_by?.slice(0, 8) || 'System'}</span></div>) : <p className="muted">No changes recorded.</p>}</div>{canEdit && <button className="btn btn-primary mt-5" onClick={() => { setEditing({ ...detail }); setDetail(null); }}>Edit vehicle</button>}</div></div>}
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field">{label}{children}</label>; }
function Status({ value }: { value: string }) { return <span className={`pill ${statusClass(value)}`}>{value}</span>; }
function VehicleTable({ vehicles, openDetail }: { vehicles: Vehicle[]; openDetail: (vehicle: Vehicle) => void }) {
  if (!vehicles.length) return <p className="p-6 muted">No vehicles found.</p>;
  return <><div className="desktop-table overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left"><tr>{['Plate / model', 'Site', 'Operating status', 'Roadworthy', 'Insurance', 'Compliance'].map(item => <th className="p-4" key={item}>{item}</th>)}</tr></thead><tbody className="divide-y divide-slate-200">{vehicles.map(vehicle => <tr key={vehicle.id} className="hover:bg-slate-50"><td className="p-4"><button className="font-bold text-blue-800 hover:underline" onClick={() => openDetail(vehicle)}>{vehicle.plate_number}</button><span className="block muted">{vehicle.make_model || vehicle.category}</span></td><td className="p-4">{vehicle.site}</td><td className="p-4">{vehicle.status}</td><td className="p-4">{dateText(vehicle.roadworthy_expiry_date)}</td><td className="p-4">{dateText(vehicle.insurance_expiry_date)}</td><td className="p-4"><Status value={overallStatus(vehicle)}/></td></tr>)}</tbody></table></div><div className="md:hidden divide-y divide-slate-200">{vehicles.map(vehicle => <button key={vehicle.id} onClick={() => openDetail(vehicle)} className="w-full text-left p-4"><span className="flex justify-between gap-2"><strong>{vehicle.plate_number}</strong><Status value={overallStatus(vehicle)}/></span><span className="block muted text-sm mt-1">{vehicle.make_model || vehicle.category} · {vehicle.site}</span><span className="block text-sm mt-2">Roadworthy {dateText(vehicle.roadworthy_expiry_date)} · Insurance {dateText(vehicle.insurance_expiry_date)}</span></button>)}</div></>;
}

