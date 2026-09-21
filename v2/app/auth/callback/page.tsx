'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function AuthCallback() {
  const [error, setError] = useState('');
  useEffect(() => {
    const client = supabase();
    if (!client) { setError('Supabase is not configured.'); return; }
    const code = new URLSearchParams(window.location.search).get('code');
    const finish = async () => {
      const result = code ? await client.auth.exchangeCodeForSession(code) : await client.auth.getSession();
      if (result.error || !result.data.session) { setError(result.error?.message || 'This invitation link is invalid or expired.'); return; }
      window.location.replace('/account/password');
    };
    void finish();
  }, []);
  return <main className="min-h-screen grid place-items-center p-5"><div className="card p-8 max-w-md"><h1 className="text-xl font-bold">Completing sign in</h1><p className="mt-3 muted">{error || 'Please wait while your staff session is set up.'}</p></div></main>;
}
