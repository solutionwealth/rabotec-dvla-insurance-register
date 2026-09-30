/**
 * Rabotec Fleet Safety — Google Apps Script backend
 * ------------------------------------------------------------
 * Stores the vehicle register in this Google Sheet and serves it to the
 * GitHub Pages front end (index.html).
 *
 * Tabs it manages (created by setup()):
 *   Vehicles  — one row per vehicle (edit through the app, not by hand)
 *   Activity  — append-only audit trail of every change
 *
 * Deploy: Extensions ▸ Apps Script ▸ paste this file ▸ edit SETTINGS ▸
 *         run setup() once ▸ Deploy ▸ New deployment ▸ Web app
 *         (Execute as: Me · Who has access: Anyone). Full steps in SETUP.md.
 */

/* ============ SETTINGS — edit these, then save ============ */
const SETTINGS = {
  // Staff who add and update vehicles type this code when they sign in.
  EDIT_CODE: 'CHANGE-ME-edit-code',
  // Optional: a second code that can only view and export. Leave '' to disable.
  VIEW_CODE: '',
  // Daily expiry email (07:00 GMT). Comma-separated addresses, or '' for none.
  ALERT_EMAILS: '',
  // Link included in the daily email so people can open the app.
  APP_URL: 'https://solutionwealth.github.io/rabotec-fleet-safety/',
  // ID of the Google Sheet that holds the register (from its link). Leave '' if this script was opened from the Sheet.
  SHEET_ID: '',
};
/* ========================================================== */

const VEH_SHEET = 'Vehicles';
const ACT_SHEET = 'Activity';
const COLS = ['id','reg','fleetNo','group','site','op','model','responsible','rwNo','rwIssue','rwExp',
              'insurer','policyNo','insExp','notes','archived','rev','createdAt','updatedAt','updatedBy'];
const HEADINGS = ['ID','Registration','Fleet no.','Group','Site','Operating status','Make / model','Responsible person',
                  'Roadworthy cert. no.','Roadworthy issued','Roadworthy expiry','Insurer','Policy no.','Insurance expiry',
                  'Notes','Archived','Revision','Created (UTC)','Updated (UTC)','Updated by'];
const ACT_COLS = ['at','vehicleId','reg','action','by','changes'];
const ACT_HEADINGS = ['Time (UTC)','Vehicle ID','Registration','Action','By','Changes (JSON)'];
const EDITABLE = ['reg','fleetNo','group','site','op','model','responsible','rwNo','rwIssue','rwExp','insurer','policyNo','insExp','notes','archived'];
const DATE_KEYS = ['rwIssue','rwExp','insExp'];
const GROUPS = ['LV','DT','ADT','ST','LB'];
const SITES = ['Abore Pit','Esaase Pit','Other'];
const OPS = ['Active','Under maintenance','Grounded'];
const ACTIVITY_RETURNED = 500;
const WINDOW_DAYS = 30;

/* ---------------- web entry points ---------------- */
function doGet() {
  return json_({ ok: true, app: 'Rabotec Fleet Safety API', message: 'Backend is running. Open the app page to use it.' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'The request could not be read.' }); }
  try {
    const role = roleFor_(req.key);
    const name = cleanName_(req.name);
    switch (req.action) {
      case 'ping': return json_({ ok: true, role: role, name: name });
      case 'list': return json_(Object.assign({ ok: true, role: role }, list_()));
      case 'save':
        requireEdit_(role);
        return json_(withLock_(() => save_(req.vehicle, req.rev, name, req.label)));
      case 'saveMany':
        requireEdit_(role);
        return json_(withLock_(() => saveMany_(req.items, name)));
      default: throw err_('Unknown request.', 'bad');
    }
  } catch (err) {
    return json_({ ok: false, error: err.message || String(err), code: err.code || 'error' });
  }
}

/* ---------------- access ---------------- */
function roleFor_(key) {
  const k = String(key || '');
  if (!SETTINGS.EDIT_CODE || SETTINGS.EDIT_CODE.indexOf('CHANGE-ME') === 0) {
    throw err_('The app has not been set up yet: set EDIT_CODE in Code.gs and redeploy.', 'setup');
  }
  if (k && safeEqual_(k, SETTINGS.EDIT_CODE)) return 'edit';
  if (k && SETTINGS.VIEW_CODE && safeEqual_(k, SETTINGS.VIEW_CODE)) return 'view';
  Utilities.sleep(800); // slows down guessing
  throw err_('That access code is not correct.', 'auth');
}
function requireEdit_(role) {
  if (role !== 'edit') throw err_('Your access code is view-only. Ask the HSE office for the editing code.', 'forbidden');
}
function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function cleanName_(n) {
  const s = String(n || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (s.length < 2) throw err_('Enter your name so changes can be credited to you.', 'auth');
  return s;
}

/* ---------------- read ---------------- */
function list_() {
  const vs = sheet_(VEH_SHEET), as = sheet_(ACT_SHEET);
  const vehicles = rows_(vs, COLS).map(fromRow_);
  const n = Math.max(0, as.getLastRow() - 1);
  const take = Math.min(n, ACTIVITY_RETURNED);
  let activity = [];
  if (take) {
    activity = as.getRange(as.getLastRow() - take + 1, 1, take, ACT_COLS.length).getValues()
      .map(r => {
        let changes = [];
        try { changes = JSON.parse(String(r[5] || '[]')); } catch (e) {}
        return { at: iso_(r[0]), vehicleId: text_(r[1]), reg: text_(r[2]), action: text_(r[3]), by: text_(r[4]), changes: changes };
      }).reverse();
  }
  return { vehicles: vehicles, activity: activity, serverTime: new Date().toISOString() };
}

/* ---------------- write ---------------- */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw err_('The register is busy. Wait a few seconds and try again.', 'busy');
  try { return fn(); } finally { lock.releaseLock(); }
}

function saveMany_(items, by) {
  if (!Array.isArray(items) || !items.length || items.length > 100) throw err_('Send between 1 and 100 vehicles at a time.', 'bad');
  const ctx = context_();
  const results = items.map(it => {
    try { return save_(it.vehicle, it.rev, by, it.label, ctx); }
    catch (e) { return { ok: false, error: e.message, reg: it && it.vehicle && it.vehicle.reg }; }
  });
  return { ok: true, results: results };
}

function context_() {
  const vs = sheet_(VEH_SHEET);
  const all = rows_(vs, COLS);
  return { vs: vs, as: sheet_(ACT_SHEET), all: all };
}

function save_(input, rev, by, label, ctx) {
  ctx = ctx || context_();
  const v = sanitize_(input);
  const now = new Date().toISOString();
  const idx = v.id ? ctx.all.findIndex(r => r.id === v.id) : -1;
  if (v.id && idx < 0) throw err_('This vehicle no longer exists. Refresh the register.', 'gone');
  const key = regKey_(v.reg);
  const dup = ctx.all.find(r => r.id !== v.id && regKey_(r.reg) === key);
  if (dup) throw err_('Registration ' + v.reg + ' is already on the register (check archived vehicles too).', 'duplicate');

  let action, changes, row;
  if (idx >= 0) {
    const prev = fromRow_(ctx.all[idx]);
    if (Number(rev) !== Number(prev.rev)) {
      throw err_('Someone else saved ' + prev.reg + ' while you were editing. Reopen the vehicle and make your change again.', 'conflict');
    }
    changes = EDITABLE.filter(k => String(prev[k]) !== String(v[k])).map(k => ({ f: k, from: prev[k], to: v[k] }));
    if (!changes.length) return { ok: true, unchanged: true, vehicle: prev };
    action = cleanLabel_(label) || (prev.archived !== v.archived ? (v.archived ? 'Vehicle archived' : 'Vehicle restored') : 'Vehicle updated');
    row = Object.assign({}, prev, v, { rev: prev.rev + 1, updatedAt: now, updatedBy: by });
    ctx.vs.getRange(idx + 2, 1, 1, COLS.length).setValues([toRow_(row)]);
    ctx.all[idx] = row;
  } else {
    action = cleanLabel_(label) || 'Vehicle added';
    changes = [{ f: 'reg', from: '', to: v.reg }];
    row = Object.assign({}, v, { id: Utilities.getUuid(), rev: 1, createdAt: now, updatedAt: now, updatedBy: by });
    ctx.vs.appendRow(toRow_(row));
    ctx.all.push(row);
  }
  ctx.as.appendRow([now, row.id, row.reg, action, by, JSON.stringify(changes)].map(safeCell_));
  return { ok: true, vehicle: fromRow_(row) };
}

function sanitize_(x) {
  if (!x || typeof x !== 'object') throw err_('Missing vehicle details.', 'bad');
  const v = { id: text_(x.id).slice(0, 60) };
  EDITABLE.forEach(k => {
    if (k === 'archived') { v.archived = x.archived === true || x.archived === 'true'; return; }
    const s = text_(x[k]).trim();
    if (s.length > (k === 'notes' ? 2000 : 120)) throw err_(k + ' is too long.', 'bad');
    v[k] = s;
  });
  v.reg = v.reg.toUpperCase().replace(/\s+/g, ' ');
  if (!v.reg) throw err_('Registration is required.', 'bad');
  if (GROUPS.indexOf(v.group) < 0) throw err_('Choose a valid vehicle group for ' + v.reg + '.', 'bad');
  if (SITES.indexOf(v.site) < 0) v.site = 'Other';
  if (OPS.indexOf(v.op) < 0) v.op = 'Active';
  DATE_KEYS.forEach(k => { if (v[k] && !validDate_(v[k])) throw err_('Enter a valid date for ' + k + ' on ' + v.reg + '.', 'bad'); });
  if (v.rwIssue && v.rwExp && v.rwIssue > v.rwExp) throw err_('Roadworthy issue date must be on or before its expiry.', 'bad');
  return v;
}
function cleanLabel_(s) { return String(s || '').replace(/[^\w .,()\-]/g, '').slice(0, 40); }

/* ---------------- daily email ---------------- */
function sendExpiryDigest() {
  const to = String(SETTINGS.ALERT_EMAILS || '').trim();
  if (!to) return;
  const today = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
  const items = [];
  rows_(sheet_(VEH_SHEET), COLS).map(fromRow_).filter(v => !v.archived).forEach(v => {
    [['Roadworthy', v.rwExp], ['Insurance', v.insExp]].forEach(d => {
      const left = d[1] ? Math.round((Date.parse(d[1] + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 864e5) : null;
      if (left === null || left <= WINDOW_DAYS) items.push({ v: v, doc: d[0], date: d[1], left: left });
    });
  });
  if (!items.length) return;
  items.sort((a, b) => (a.left === null ? -1e6 : a.left) - (b.left === null ? -1e6 : b.left));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const bad = items.filter(i => i.left === null || i.left < 0).length;
  const rowsHtml = items.map(i => {
    const when = i.left === null ? 'Not recorded' : i.left < 0 ? (-i.left) + ' days overdue' : i.left === 0 ? 'Expires today' : i.left + ' days left';
    const col = i.left === null ? '#5a4f9a' : i.left < 0 ? '#b3261e' : '#a45f00';
    return '<tr><td style="padding:6px 10px;border-bottom:1px solid #ddd"><b>' + esc(i.v.reg) + '</b> ' + esc(i.v.fleetNo) +
      '</td><td style="padding:6px 10px;border-bottom:1px solid #ddd">' + esc(i.v.site) + '</td><td style="padding:6px 10px;border-bottom:1px solid #ddd">' + i.doc +
      '</td><td style="padding:6px 10px;border-bottom:1px solid #ddd">' + (i.date || '—') + '</td><td style="padding:6px 10px;border-bottom:1px solid #ddd;color:' + col + ';font-weight:600">' + when + '</td></tr>';
  }).join('');
  MailApp.sendEmail({
    to: to,
    subject: 'Rabotec fleet: ' + (bad ? bad + ' not road-legal, ' : '') + items.length + ' document' + (items.length === 1 ? '' : 's') + ' need attention',
    htmlBody: '<div style="font-family:Arial,sans-serif;font-size:14px;color:#172224">' +
      '<p>Documents expired, missing or due within ' + WINDOW_DAYS + ' days as of ' + today + ' (GMT). Vehicles with an expired or missing document must not be dispatched.</p>' +
      '<table style="border-collapse:collapse"><tr style="background:#eceee9"><th align="left" style="padding:6px 10px">Vehicle</th><th align="left" style="padding:6px 10px">Site</th><th align="left" style="padding:6px 10px">Document</th><th align="left" style="padding:6px 10px">Expiry</th><th align="left" style="padding:6px 10px">Status</th></tr>' +
      rowsHtml + '</table><p><a href="' + esc(SETTINGS.APP_URL) + '">Open Rabotec Fleet Safety</a></p></div>',
  });
}

/** Run once to switch on the 07:00 GMT daily email. */
function setupDailyEmail() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'sendExpiryDigest').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendExpiryDigest').timeBased().atHour(7).everyDays(1).inTimezone('Africa/Accra').create();
}

/* ---------------- one-time setup ---------------- */
/** Run once from the Apps Script editor. Creates and formats the two tabs. */
function setup() {
  const ss = book_();
  [[VEH_SHEET, HEADINGS, COLS], [ACT_SHEET, ACT_HEADINGS, ACT_COLS]].forEach(([name, heads]) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, heads.length).setValues([heads]).setFontWeight('bold').setBackground('#15282a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    // Plain-text format so Sheets never turns dates or registrations into numbers.
    sh.getRange(2, 1, sh.getMaxRows() - 1, heads.length).setNumberFormat('@');
  });
  return 'Setup complete: Vehicles and Activity tabs are ready.';
}

/* ---------------- helpers ---------------- */
function book_() {
  if (SETTINGS.SHEET_ID) return SpreadsheetApp.openById(SETTINGS.SHEET_ID);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw err_('Set SHEET_ID in Code.gs to the ID of the register Sheet.', 'setup');
  return ss;
}
function sheet_(name) {
  const sh = book_().getSheetByName(name);
  if (!sh) throw err_('The "' + name + '" tab is missing. Run setup() in Apps Script.', 'setup');
  return sh;
}
function rows_(sh, cols) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, cols.length).getValues()
    .filter(r => String(r[0]).trim() !== '')
    .map(r => { const o = {}; cols.forEach((c, i) => o[c] = r[i]); return o; });
}
function fromRow_(r) {
  const v = {};
  COLS.forEach(c => v[c] = r[c]);
  COLS.forEach(c => { if (c !== 'archived' && c !== 'rev') v[c] = text_(v[c]); });
  DATE_KEYS.forEach(k => { v[k] = dateText_(r[k]); });
  v.archived = r.archived === true || String(r.archived).toUpperCase() === 'TRUE';
  v.rev = Number(r.rev) || 1;
  return v;
}
function toRow_(v) {
  return COLS.map(c => c === 'archived' ? (v.archived ? 'TRUE' : 'FALSE') : c === 'rev' ? String(v.rev) : safeCell_(v[c]));
}
// Stops text like "=HYPERLINK(...)" being run as a formula in the Sheet.
function safeCell_(s) { s = String(s == null ? '' : s); return /^[=+\-@]/.test(s) ? "'" + s : s; }
function text_(x) {
  if (x instanceof Date) return iso_(x);
  const s = String(x == null ? '' : x);
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}
function dateText_(x) {
  if (x instanceof Date) return Utilities.formatDate(x, 'UTC', 'yyyy-MM-dd');
  const s = text_(x).trim();
  return validDate_(s) ? s : '';
}
function iso_(x) { return x instanceof Date ? x.toISOString() : String(x == null ? '' : x); }
function validDate_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + 'T00:00:00Z');
  return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}
function regKey_(s) { return String(s || '').toUpperCase().replace(/[\s\-]/g, ''); }
function err_(msg, code) { const e = new Error(msg); e.code = code; return e; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
