# Rabotec Fleet Compliance Tracker v2

This is the Supabase and Vercel version described in the supplied build specification. It is separate from the current live tracker. The app uses individual staff accounts, Admin/Editor/Viewer roles, optional site restrictions, vehicle and document records, an audit log, CSV export, and scheduled expiry emails.

## Deploy

1. Create a Supabase project. In **Authentication → Providers → Email**, disable public sign-up. In **Authentication → URL Configuration**, set the Vercel production URL as the site URL and add `https://YOUR-DOMAIN/auth/callback` to redirect URLs.
2. Run [`../supabase/migrations/0001_fleet.sql`](../supabase/migrations/0001_fleet.sql) in the Supabase SQL editor. It creates the database, row security rules, and private document bucket.
3. Invite the first staff account in Supabase Authentication. When its profile appears, promote it with `update public.profiles set role = 'Admin' where id = 'USER_UUID';` in the SQL editor. That Admin can invite and assign roles/sites to other staff in the app.
4. Create a Vercel project from this GitHub repository and set **Root Directory** to `v2`. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` from the Supabase project. Keep the service role key in server-side environment variables only. Deploy, then complete the Supabase URL configuration with the final domain.
5. Deploy the `expiry-alerts` Supabase Edge Function in [`../supabase/functions`](../supabase/functions). Set function secrets `ALERT_CRON_SECRET` (a long random value), `RESEND_API_KEY`, `ALERT_FROM_EMAIL` (a verified Resend sender), `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. The function sends separate 30, 14, and 7 day alerts to Admins and site-matched Editors. For scheduled calls, set the function's JWT verification to off as configured in [`../supabase/config.toml`](../supabase/config.toml); the `x-alert-secret` header is required.
6. Create Supabase Vault secrets named `project_url` and `alert_cron_secret`, using the project URL and the same `ALERT_CRON_SECRET`. Run [`../supabase/schedule-expiry-alerts.sql`](../supabase/schedule-expiry-alerts.sql) in the SQL editor to schedule 07:00 UTC daily delivery.

The email sender requires a verified Resend domain. Test one invitation, one vehicle edit, a document upload, and one scheduled alert before inviting all staff. Do not commit any `.env` file or service key.

## Local development

Copy `.env.example` to `.env.local`, fill the three values, then run `pnpm install` and `pnpm dev` from this directory. Add `http://localhost:3000/auth/callback` to Supabase redirect URLs for local invitation testing.
