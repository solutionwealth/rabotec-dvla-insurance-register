'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import type { UserResponse } from '@supabase/supabase-js';

export default function SetPassword() {
  const client = supabase();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!client) return; void client.auth.getUser().then((result: UserResponse) => setReady(!!result.data.user)); }, [client]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!client) return;
    if (password.length < 12) { setMessage('Use at least 12 characters.'); return; }
    if (password !== confirm) { setMessage('The passwords do not match.'); return; }
    setBusy(true); setMessage('');
    const result = await client.auth.updateUser({ password });
    setBusy(false);
    if (result.error) setMessage(result.error.message);
    else { setPassword(''); setConfirm(''); setMessage('Password saved. You can now use it to sign in.'); }
  }
  return <main className="min-h-screen grid place-items-center p-5"><div className="card p-8 w-full max-w-md"><h1 className="text-2xl font-bold">Set your staff password</h1><p className="muted mt-2 mb-5">Choose a password for your individual Rabotec account.</p>{ready ? <form className="flex flex-col gap-4" onSubmit={submit}><label className="field">New password<input type="password" autoComplete="new-password" required value={password} onChange={event => setPassword(event.target.value)}/></label><label className="field">Confirm password<input type="password" autoComplete="new-password" required value={confirm} onChange={event => setConfirm(event.target.value)}/></label><button className="btn btn-primary" disabled={busy}>Save password</button></form> : <p className="error">Open your invitation link to sign in before setting a password.</p>}{message && <p className="mt-4" role="status">{message}</p>}<a className="block text-blue-800 font-bold mt-5" href="/">Return to tracker</a></div></main>;
}
