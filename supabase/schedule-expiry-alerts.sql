-- Run after deploying expiry-alerts and creating these two Vault secrets:
-- project_url: https://YOUR_PROJECT_REF.supabase.co
-- alert_cron_secret: same long random value as the Edge Function secret.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'rabotec-daily-expiry-alerts',
  '0 7 * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/expiry-alerts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'alert_cron_secret')
      ),
      body := '{}'::jsonb
    );
  $$
);
