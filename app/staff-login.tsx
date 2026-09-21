'use client';
import { useState, type FormEvent } from 'react';

export default function StaffLogin({ configured }: { configured: boolean }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/staff-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Sign in failed.');
      window.location.reload();
    } catch (failure) { setError((failure as Error).message); setBusy(false); }
  }
  return <main className="staff-login"><form onSubmit={submit} className="staff-login-card"><img src="https://rabotecgroup.com/images/header/160x40-px-logo.jpg" width="160" height="40" alt="Rabotec"/><span>FLEET & SAFETY</span><h1>Staff access</h1><p>{configured ? 'Enter the shared access password to open the vehicle register.' : 'Staff access is being configured. Please try again later.'}</p>{configured && <><label htmlFor="staff-password">Access password</label><input id="staff-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)}/><button className="btn primary" disabled={busy}>{busy ? 'Checking…' : 'Open tracker'}</button></>}{error && <div role="alert" className="form-error">{error}</div>}</form></main>;
}
