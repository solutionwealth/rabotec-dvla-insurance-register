# Rabotec DVLA & Insurance Register

Asset register for Rabotec Mining and Rabotec Project, covering vehicles, trucks, mining fleet and plant. For road-registered assets it tracks roadworthy certificates and insurance.

- **All assets:** every asset, with filters by business unit, category, fleet type, site, operating status and document status.
- **2-week red flags:** red flags cover any document expiring within 14 days, and anything expired or not recorded. They show on the Overview, on Alerts & renewals, and in the daily email. Documents due in 15 to 30 days are shown in amber.
- **Reports:** filter and segregate the fleet, then generate a PowerPoint report for:
  - the selection
  - any fleet type
  - a unit and site
  - a single asset

  The deck is made in the browser, so no data leaves the device.
- **History:** the old DVLA / insurance trackers (23 Jul 2026) and the Mining asset register (4 Aug 2026) are the starting history for each asset.

The repository holds three files:

- `index.html`: the app, served by GitHub Pages
- `Code.gs`: the Google Apps Script backend that stores records in a Google Sheet
- `SETUP.md`: deployment steps

Everyone signs in with their own email and password; admins manage access on the Team page. No passwords, secrets or fleet data are stored in this repository.
The earlier ChatGPT-built version is kept on the `chatgpt-version` branch.
