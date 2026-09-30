# Rabotec Fleet Safety — setup (GitHub Pages + Google Sheet)

Takes about 15 minutes. You need the Google account that owns the Sheet and your GitHub account.

## 1. Google Sheet + Apps Script (the backend)

1. Open the Google Sheet you want to use. It can be the SafeReport Sheet or a new one. The script only touches its own **Vehicles** and **Activity** tabs.
2. Go to **Extensions ▸ Apps Script**.
   - If the Sheet already has a script (for example SafeReport's), click **+ ▸ Script** to add a new file called `Fleet`. Otherwise, clear the default `Code.gs`.
   - If you add it next to SafeReport, both files share one project. Check that SafeReport's file doesn't already have functions named `doGet`/`doPost`. If it does, use a **separate Sheet** for the fleet instead (simplest).
3. Paste in all of `Code.gs`.
4. At the top, edit `SETTINGS`:
   - `EDIT_CODE`: the code staff type to add or update vehicles. Use at least 10 characters that are hard to guess.
   - `VIEW_CODE`: optional read-only code, for supervisors who only need to look.
   - `ALERT_EMAILS`: for example `'hse@rabotec.com, emmanuel@...'`. Leave it as `''` for no email.
   - `APP_URL`: fill this in after step 2.3.
5. Click **Save**. In the function dropdown, choose **setup** and click **Run**, then approve the permissions. The Vehicles and Activity tabs will appear.
6. Click **Deploy ▸ New deployment ▸ ⚙ ▸ Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**. This only lets the app reach the script; the access code is still checked on every request.
   - Click **Deploy** and copy the **Web app URL**. It ends in `/exec`.
7. Optional daily email: choose **setupDailyEmail** and click **Run**. From then on, an email goes out at 07:00 GMT whenever something is expired, missing or due within 30 days.

## 2. GitHub Pages (the front end)

1. Open `index.html` and find `const API_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";`. Paste your `/exec` URL between the quotes.
2. On GitHub, create a repository (for example `rabotec-fleet-safety`) and upload `index.html`.
3. Go to **Settings ▸ Pages ▸ Source: Deploy from a branch ▸ main / (root) ▸ Save**. After a minute the site is live at `https://<username>.github.io/rabotec-fleet-safety/`.
4. Put that link into `APP_URL` in Code.gs. Then click **Deploy ▸ Manage deployments ▸ ✎ ▸ Version: New version ▸ Deploy**. This keeps the same URL.

## 3. Move the old records across

1. In the old ChatGPT-hosted app, click **Export CSV**.
2. In the new app, sign in with the editing code, click **Import CSV** and choose that file. You'll see a preview of what will be added, updated or skipped before anything is saved.

## Good to know

- **Whenever you change Code.gs**, redeploy with **Manage deployments ▸ Edit ▸ New version**. If you use "New deployment" instead, the URL changes and you'd have to update `index.html`.
- **To change the access code**, edit `EDIT_CODE` and redeploy. Everyone gets signed out and has to use the new code.
- **Don't edit the Vehicles tab by hand.** Use the app, so every change is checked and logged in Activity. Reading the Sheet, filtering it and building charts from it are all fine.
- **Who made a change** is recorded from the name each person types when they sign in. Anyone with the editing code can type any name, so share the code only with the people who update records.
- **The `index.html` on GitHub is public**, but it contains no records and no codes. All data stays in your Google Sheet behind the access code.
