# Rabotec Fleet Safety — setup and administration

The app has three parts:

- **`index.html`**: the web page, hosted by GitHub Pages at https://solutionwealth.github.io/rabotec-fleet-safety/
- **`Code.gs`**: the Google Apps Script backend (project **Rabotec Fleet Safety API** on script.google.com, account nyarko.emmanuel.va@gmail.com)
- **The Google Sheet "Rabotec Fleet Safety Register"**, which has three tabs:
  - **Vehicles**: one row per vehicle
  - **Activity**: every change, and who made it
  - **Users**: who can sign in

## Signing in

Everyone signs in with their own email address and password. Nobody shares a code.

1. **An admin adds the person.** On the **Team** page, the admin enters their email and picks a role. The person gets an invitation email.
   - **Viewer**: can look and export only
   - **Editor**: can add and update vehicles
   - **Admin**: can also manage the team
2. **The person creates their password.** They open the app, choose **First time or forgot password**, and enter their email. They receive a 6-digit code, enter it, and choose a password of at least 8 characters.
3. **After that**, they sign in with their email and password.

Some safeguards to know about:

- **Wrong passwords:** after 5 wrong passwords, that account is locked for 15 minutes. **Forgot password** unlocks it by setting a new one.
- **Switching someone off:** **Switch off** on the Team page signs that person out on every device immediately. **Remove** deletes their account; their past changes stay in the Activity log.
- **The owner:** the owner (`OWNER_EMAIL`) is always an admin and can't be switched off or removed.
- **Where emails come from:** codes and invitations are sent from the owner's Gmail, which allows about 100 emails a day.

## Settings (top of Code.gs)

| Setting | What it does |
|---|---|
| `OWNER_EMAIL` | The permanent admin. |
| `ALLOW_DOMAINS` | Optional. For example `'rabotecghana.com'` lets anyone with that email domain create a Viewer account without being added first. Use `''` to turn it off. |
| `ALERT_EMAILS` | Addresses for the 07:00 GMT daily expiry email. Run `setupDailyEmail` once to switch it on. |
| `APP_URL` | The link used in emails. |
| `SHEET_ID` | The ID of the register Sheet. |
| `SESSION_DAYS` | How long someone stays signed in on a device. |

## After any change to Code.gs

1. Save with **Ctrl + S**.
2. Go to **Deploy ▸ Manage deployments ▸ ✎ Edit ▸ Version: New version ▸ Deploy**.

This keeps the same web address, so `index.html` doesn't need changing. Don't use **New deployment**: that creates a new address. `ALERT_EMAILS` is the only exception; it works as soon as you save.

## Don't edit by hand

Don't edit the **Users** tab by hand. The password columns are scrambled hashes, and changing them breaks sign-in. Use the Team page instead. You can read, filter and chart the Vehicles tab freely, but make changes through the app so they're checked and logged.
