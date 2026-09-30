/**
 * Rabotec Fleet Safety — Google Apps Script backend (v2: personal accounts)
 * ------------------------------------------------------------
 * Stores the vehicle register in a Google Sheet and serves it to the
 * GitHub Pages front end (index.html). Everyone signs in with their own
 * email and password; admins decide who has access on the Team page.
 *
 * Tabs it manages (created by setup()):
 *   Vehicles  — one row per vehicle (edit through the app, not by hand)
 *   Activity  — append-only audit trail of every change
 *   Users     — who may sign in, their role and a scrambled (hashed) password
 *
 * After any change to this file: Deploy ▸ Manage deployments ▸ Edit ▸
 * Version: New version ▸ Deploy (keeps the same web address).
 */

/* ============ SETTINGS — edit these, then save ============ */
const SETTINGS = {
  // The owner is always an admin and can never be removed or demoted.
  OWNER_EMAIL: 'nyarko.emmanuel.va@gmail.com',
  // Optional self sign-up: anyone with an email at these domains may create a
  // Viewer account without being added first, e.g. 'rabotecghana.com'. '' = off.
  ALLOW_DOMAINS: '',
  // Daily expiry email (07:00 GMT). Comma-separated addresses, or '' for none.
  ALERT_EMAILS: '',
  // Link used in emails so people can open the app.
  APP_URL: 'https://solutionwealth.github.io/rabotec-fleet-safety/',
  // ID of the Google Sheet that holds the register (from its link). Leave '' if this script was opened from the Sheet.
  SHEET_ID: '',
  // How long a sign-in lasts on a device before the person must sign in again.
  SESSION_DAYS: 14,
};
/* ========================================================== */

const VEH_SHEET = 'Vehicles';
const ACT_SHEET = 'Activity';
const USR_SHEET = 'Users';
const COLS = ['id','reg','fleetNo','group','site','op','model','responsible','rwNo','rwIssue','rwExp',
              'insurer','policyNo','insExp','notes','archived','rev','createdAt','updatedAt','updatedBy'];
const HEADINGS = ['ID','Registration','Fleet no.','Group','Site','Operating status','Make / model','Responsible person',
                  'Roadworthy cert. no.','Roadworthy issued','Roadworthy expiry','Insurer','Policy no.','Insurance expiry',
                  'Notes','Archived','Revision','Created (UTC)','Updated (UTC)','Updated by'];
const ACT_COLS = ['at','vehicleId','reg','action','by','changes','byEmail'];
const ACT_HEADINGS = ['Time (UTC)','Vehicle ID','Registration','Action','By','Changes (JSON)','By (email)'];
const USR_COLS = ['email','name','role','status','hash','salt','pwv','failed','lockedUntil','codeHash','codeExpires','codeTries',
                  'createdAt','addedBy','lastLogin'];
const USR_HEADINGS = ['Email','Name','Role','Status','Password hash (do not edit)','Salt','Password version','Failed sign-ins',
                      'Locked until (UTC)','Code hash','Code expires (UTC)','Code tries','Added (UTC)','Added by','Last sign-in (UTC)'];
const EDITABLE = ['reg','fleetNo','group','site','op','model','responsible','rwNo','rwIssue','rwExp','insurer','policyNo','insExp','notes','archived'];
const DATE_KEYS = ['rwIssue','rwExp','insExp'];
const GROUPS = ['LV','DT','ADT','ST','LB'];
const SITES = ['Abore Pit','Esaase Pit','Other'];
const OPS = ['Active','Under maintenance','Grounded'];
const ROLES = ['admin','editor','viewer'];
const ACTIVITY_RETURNED = 500;
const WINDOW_DAYS = 30;
const HASH_ROUNDS = 300;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const CODE_MINUTES = 15;
const MIN_PASSWORD = 8;

/* ---------------- web entry points ---------------- */
function doGet() {
  return json_({ ok: true, app: 'Rabotec Fleet Safety API', message: 'Backend is running. Open the app page to use it.' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'The request could not be read.' }); }
  try {
    switch (req.action) {
      // ---- no sign-in needed ----
      case 'requestCode': return json_(withLock_(() => requestCode_(req.email)));
      case 'setPassword': return json_(withLock_(() => setPassword_(req.email, req.code, req.password, req.name)));
      case 'login':       return json_(withLock_(() => login_(req.email, req.password)));
    }
    const me = auth_(req.token);
    switch (req.action) {
      case 'me':   return json_({ ok: true, user: publicUser_(me) });
      case 'list': return json_(Object.assign({ ok: true, user: publicUser_(me) }, list_()));
      case 'save':
        requireRole_(me, 'editor');
        return json_(withLock_(() => save_(req.vehicle, req.rev, me, req.label)));
      case 'saveMany':
        requireRole_(me, 'editor');
        return json_(withLock_(() => saveMany_(req.items, me)));
      case 'users':
        requireRole_(me, 'admin');
        return json_({ ok: true, users: users_().map(publicUser_) });
      case 'userSave':
        requireRole_(me, 'admin');
        return json_(withLock_(() => userSave_(me, req.email, req.name, req.role, req.invite)));
      case 'userStatus':
        requireRole_(me, 'admin');
        return json_(withLock_(() => userStatus_(me, req.email, req.status)));
      case 'userRemove':
        requireRole_(me, 'admin');
        return json_(withLock_(() => userRemove_(me, req.email)));
      default: throw err_('Unknown request.', 'bad');
    }
  } catch (err) {
    return json_({ ok: false, error: err.message || String(err), code: err.code || 'error' });
  }
}

/* ---------------- accounts ---------------- */
function normEmail_(e) {
  const s = String(e || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length > 120) throw err_('Enter a valid email address.', 'bad');
  return s;
}
function isOwner_(email) { return email === String(SETTINGS.OWNER_EMAIL || '').trim().toLowerCase(); }
function domainAllowed_(email) {
  const doms = String(SETTINGS.ALLOW_DOMAINS || '').toLowerCase().split(',').map(s => s.trim().replace(/^@/, '')).filter(String);
  return doms.indexOf(email.split('@')[1]) >= 0;
}
function users_() { return rows_(sheet_(USR_SHEET), USR_COLS).map(fromUserRow_); }
function fromUserRow_(r) {
  const u = {};
  USR_COLS.forEach(c => u[c] = text_(r[c]));
  u.email = u.email.toLowerCase();
  u.failed = Number(r.failed) || 0;
  u.pwv = Number(r.pwv) || 0;
  u.codeTries = Number(r.codeTries) || 0;
  if (isOwner_(u.email)) { u.role = 'admin'; if (u.status === 'disabled') u.status = u.hash ? 'active' : 'invited'; }
  if (ROLES.indexOf(u.role) < 0) u.role = 'viewer';
  return u;
}
function publicUser_(u) {
  return { email: u.email, name: u.name, role: u.role, status: u.status, lastLogin: u.lastLogin, createdAt: u.createdAt,
           addedBy: u.addedBy, owner: isOwner_(u.email) };
}
/** Finds a user row; creates the owner's row on first use. Returns {u, row} (row = sheet row number) or null. */
function findUser_(email) {
  const sh = sheet_(USR_SHEET);
  const all = rows_(sh, USR_COLS);
  const i = all.findIndex(r => String(r.email).trim().toLowerCase() === email);
  if (i >= 0) return { u: fromUserRow_(all[i]), row: i + 2 };
  if (isOwner_(email)) {
    const u = blankUser_(email, 'admin', 'Owner', '');
    sh.appendRow(userRow_(u));
    return { u: u, row: sh.getLastRow() };
  }
  return null;
}
function blankUser_(email, role, addedBy, name) {
  return { email: email, name: name || '', role: role, status: 'invited', hash: '', salt: '', pwv: 0, failed: 0, lockedUntil: '',
           codeHash: '', codeExpires: '', codeTries: 0, createdAt: new Date().toISOString(), addedBy: addedBy || '', lastLogin: '' };
}
function userRow_(u) { return USR_COLS.map(c => safeCell_(u[c] == null ? '' : String(u[c]))); }
function writeUser_(ref) { sheet_(USR_SHEET).getRange(ref.row, 1, 1, USR_COLS.length).setValues([userRow_(ref.u)]); }

function hash_(secret, salt) {
  let h = salt + '|' + secret;
  for (let i = 0; i < HASH_ROUNDS; i++) h = Utilities.base64Encode(Utilities.computeHmacSha256Signature(h + salt, secret));
  return h;
}
function newSalt_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }
function sixDigits_() {
  const hex = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  return String(parseInt(hex, 16) % 1000000).padStart(6, '0');
}

function requestCode_(rawEmail) {
  const email = normEmail_(rawEmail);
  let ref = findUser_(email);
  if (!ref && domainAllowed_(email)) {
    const sh = sheet_(USR_SHEET);
    const u = blankUser_(email, 'viewer', 'Self sign-up', '');
    sh.appendRow(userRow_(u));
    ref = { u: u, row: sh.getLastRow() };
  }
  if (!ref) throw err_('This email has not been given access yet. Ask the HSE office to add you on the Team page.', 'noaccess');
  if (ref.u.status === 'disabled') throw err_('This account has been switched off. Contact the HSE office.', 'disabled');
  const now = Date.now();
  if (ref.u.codeExpires && Date.parse(ref.u.codeExpires) - CODE_MINUTES * 60000 + 60000 > now) {
    throw err_('A code was sent less than a minute ago. Check your inbox (and spam folder) before asking again.', 'wait');
  }
  const code = sixDigits_();
  ref.u.codeHash = hash_(code, ref.u.email);
  ref.u.codeExpires = new Date(now + CODE_MINUTES * 60000).toISOString();
  ref.u.codeTries = 0;
  writeUser_(ref);
  MailApp.sendEmail({
    to: email,
    subject: 'Your Rabotec Fleet Safety code: ' + code,
    htmlBody: mailWrap_('<p>Your code is</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;color:#164C9D;margin:8px 0">' + code +
      '</p><p>Enter it in the app to set your password. It expires in ' + CODE_MINUTES + ' minutes.</p>' +
      '<p style="color:#666">If you did not ask for this, ignore this email. Nobody can sign in without the code.</p>'),
  });
  return { ok: true, sent: true, isNew: !ref.u.hash };
}

function setPassword_(rawEmail, code, password, name) {
  const email = normEmail_(rawEmail);
  const ref = findUser_(email);
  if (!ref) throw err_('This email has not been given access yet.', 'noaccess');
  const u = ref.u;
  if (u.status === 'disabled') throw err_('This account has been switched off. Contact the HSE office.', 'disabled');
  if (!u.codeHash || !u.codeExpires || Date.parse(u.codeExpires) < Date.now()) throw err_('That code has expired. Ask for a new one.', 'code');
  if (u.codeTries >= 5) throw err_('Too many wrong codes. Ask for a new one.', 'code');
  if (!safeEqual_(hash_(String(code || '').replace(/\s/g, ''), u.email), u.codeHash)) {
    u.codeTries++; writeUser_(ref);
    throw err_('That code is not correct. Check the latest email and try again.', 'code');
  }
  const pw = String(password || '');
  if (pw.length < MIN_PASSWORD) throw err_('Use a password of at least ' + MIN_PASSWORD + ' characters.', 'bad');
  if (pw.length > 200) throw err_('That password is too long.', 'bad');
  const nm = String(name || u.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (nm.length < 2) throw err_('Enter your full name.', 'bad');
  u.name = nm;
  u.salt = newSalt_();
  u.hash = hash_(pw, u.salt);
  u.pwv = (u.pwv || 0) + 1;           // signs out every other device
  u.status = 'active';
  u.codeHash = ''; u.codeExpires = ''; u.codeTries = 0;
  u.failed = 0; u.lockedUntil = '';
  u.lastLogin = new Date().toISOString();
  writeUser_(ref);
  return { ok: true, token: token_(u), user: publicUser_(u) };
}

function login_(rawEmail, password) {
  const email = normEmail_(rawEmail);
  const ref = findUser_(email);
  const fail = () => err_('Email or password is not correct.', 'login');
  if (!ref) { Utilities.sleep(600); throw fail(); }
  const u = ref.u;
  if (u.status === 'disabled') throw err_('This account has been switched off. Contact the HSE office.', 'disabled');
  if (!u.hash) throw err_('You have not set a password yet. Choose "First time or forgot password" to get a code.', 'nopassword');
  if (u.lockedUntil && Date.parse(u.lockedUntil) > Date.now()) {
    throw err_('Too many wrong passwords. Try again after ' + Utilities.formatDate(new Date(u.lockedUntil), 'UTC', 'HH:mm') + ' GMT, or reset your password.', 'locked');
  }
  if (!safeEqual_(hash_(String(password || ''), u.salt), u.hash)) {
    u.failed++;
    if (u.failed >= MAX_FAILED) { u.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString(); u.failed = 0; }
    writeUser_(ref);
    throw fail();
  }
  u.failed = 0; u.lockedUntil = ''; u.lastLogin = new Date().toISOString();
  writeUser_(ref);
  return { ok: true, token: token_(u), user: publicUser_(u) };
}

/* Session token: email|passwordVersion|expiry|signature (HMAC with a secret kept in Script Properties). */
let SECRET_ = null;
function secret_() {
  if (SECRET_) return SECRET_;
  const p = PropertiesService.getScriptProperties();
  let s = p.getProperty('SESSION_SECRET');
  if (!s) { s = newSalt_() + newSalt_(); p.setProperty('SESSION_SECRET', s); }
  return (SECRET_ = s);
}
function sign_(payload) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret_())); }
function token_(u) {
  const payload = u.email + '|' + u.pwv + '|' + (Date.now() + SETTINGS.SESSION_DAYS * 864e5);
  return payload + '|' + sign_(payload);
}
function auth_(token) {
  const parts = String(token || '').split('|');
  const expired = () => err_('Please sign in again.', 'auth');
  if (parts.length !== 4) throw expired();
  const payload = parts.slice(0, 3).join('|');
  if (!safeEqual_(sign_(payload), parts[3])) throw expired();
  if (Number(parts[2]) < Date.now()) throw expired();
  const ref = findUser_(parts[0]);
  if (!ref || ref.u.status !== 'active' || String(ref.u.pwv) !== parts[1]) throw expired();
  return ref.u;
}
function requireRole_(u, need) {
  const rank = { viewer: 1, editor: 2, admin: 3 };
  if (rank[u.role] < rank[need]) {
    throw err_(need === 'admin' ? 'Only admins can manage the team.' : 'Your account can view the register but not change it. Ask an admin for Editor access.', 'forbidden');
  }
}

/* ---------------- team management (admins) ---------------- */
function userSave_(me, rawEmail, name, role, invite) {
  const email = normEmail_(rawEmail);
  if (ROLES.indexOf(role) < 0) throw err_('Choose a role: admin, editor or viewer.', 'bad');
  const nm = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  let ref = findUser_(email);
  let created = false;
  if (!ref) {
    const sh = sheet_(USR_SHEET);
    const u = blankUser_(email, role, me.email, nm);
    sh.appendRow(userRow_(u));
    ref = { u: u, row: sh.getLastRow() };
    created = true;
  } else {
    if (isOwner_(email) && role !== 'admin') throw err_('The owner is always an admin.', 'bad');
    if (email === me.email && role !== 'admin') throw err_('You cannot remove your own admin rights. Ask another admin.', 'bad');
    ref.u.role = role;
    if (nm) ref.u.name = nm;
    writeUser_(ref);
  }
  let invited = false;
  if (created && invite !== false) {
    MailApp.sendEmail({
      to: email,
      subject: 'You have been given access to Rabotec Fleet Safety',
      htmlBody: mailWrap_('<p>' + esc_(me.name || me.email) + ' has added you to the Rabotec Fleet Safety register as <b>' + role + '</b>.</p>' +
        '<p><a href="' + esc_(SETTINGS.APP_URL) + '" style="display:inline-block;background:#164C9D;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Open the app</a></p>' +
        '<p>Choose <b>First time or forgot password</b>, enter this email address (' + esc_(email) + '), and we will send you a code to create your password.</p>'),
    });
    invited = true;
  }
  return { ok: true, created: created, invited: invited, user: publicUser_(ref.u) };
}
function userStatus_(me, rawEmail, status) {
  const email = normEmail_(rawEmail);
  if (['active', 'disabled'].indexOf(status) < 0) throw err_('Unknown status.', 'bad');
  if (isOwner_(email) || email === me.email) throw err_('You cannot switch off this account.', 'bad');
  const ref = findUser_(email);
  if (!ref) throw err_('That person is not on the team.', 'bad');
  ref.u.status = status === 'active' ? (ref.u.hash ? 'active' : 'invited') : 'disabled';
  if (status === 'disabled') ref.u.pwv++;   // signs them out everywhere
  writeUser_(ref);
  return { ok: true, user: publicUser_(ref.u) };
}
function userRemove_(me, rawEmail) {
  const email = normEmail_(rawEmail);
  if (isOwner_(email) || email === me.email) throw err_('You cannot remove this account.', 'bad');
  const ref = findUser_(email);
  if (!ref) return { ok: true };
  sheet_(USR_SHEET).deleteRow(ref.row);
  return { ok: true };
}
function mailWrap_(inner) {
  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#19232B;max-width:520px">' +
    '<div style="background:#164C9D;color:#fff;padding:12px 16px;border-radius:6px 6px 0 0;font-weight:700;letter-spacing:.04em">RABOTEC · FLEET SAFETY</div>' +
    '<div style="border:1px solid #d6dbe3;border-top:0;padding:16px;border-radius:0 0 6px 6px">' + inner + '</div></div>';
}
function esc_(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

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
        return { at: iso_(r[0]), vehicleId: text_(r[1]), reg: text_(r[2]), action: text_(r[3]), by: text_(r[4]), changes: changes, byEmail: text_(r[6]) };
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

function saveMany_(items, me) {
  if (!Array.isArray(items) || !items.length || items.length > 100) throw err_('Send between 1 and 100 vehicles at a time.', 'bad');
  const ctx = context_();
  const results = items.map(it => {
    try { return save_(it.vehicle, it.rev, me, it.label, ctx); }
    catch (e) { return { ok: false, error: e.message, reg: it && it.vehicle && it.vehicle.reg }; }
  });
  return { ok: true, results: results };
}

function context_() {
  const vs = sheet_(VEH_SHEET);
  const all = rows_(vs, COLS);
  return { vs: vs, as: sheet_(ACT_SHEET), all: all };
}

function save_(input, rev, me, label, ctx) {
  ctx = ctx || context_();
  const by = me.name || me.email;
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
  ctx.as.appendRow([now, row.id, row.reg, action, by, JSON.stringify(changes), me.email].map(safeCell_));
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
  const bad = items.filter(i => i.left === null || i.left < 0).length;
  const td = 'padding:6px 10px;border-bottom:1px solid #ddd';
  const rowsHtml = items.map(i => {
    const when = i.left === null ? 'Not recorded' : i.left < 0 ? (-i.left) + ' days overdue' : i.left === 0 ? 'Expires today' : i.left + ' days left';
    const col = i.left === null ? '#5a4f9a' : i.left < 0 ? '#b3261e' : '#a45a00';
    return '<tr><td style="' + td + '"><b>' + esc_(i.v.reg) + '</b> ' + esc_(i.v.fleetNo) + '</td><td style="' + td + '">' + esc_(i.v.site) +
      '</td><td style="' + td + '">' + i.doc + '</td><td style="' + td + '">' + (i.date || '—') + '</td><td style="' + td + ';color:' + col + ';font-weight:600">' + when + '</td></tr>';
  }).join('');
  MailApp.sendEmail({
    to: to,
    subject: 'Rabotec fleet: ' + (bad ? bad + ' not road-legal, ' : '') + items.length + ' document' + (items.length === 1 ? '' : 's') + ' need attention',
    htmlBody: mailWrap_('<p>Documents expired, missing or due within ' + WINDOW_DAYS + ' days as of ' + today + ' (GMT). Vehicles with an expired or missing document must not be dispatched.</p>' +
      '<table style="border-collapse:collapse"><tr style="background:#eef1f6"><th align="left" style="padding:6px 10px">Vehicle</th><th align="left" style="padding:6px 10px">Site</th><th align="left" style="padding:6px 10px">Document</th><th align="left" style="padding:6px 10px">Expiry</th><th align="left" style="padding:6px 10px">Status</th></tr>' +
      rowsHtml + '</table><p><a href="' + esc_(SETTINGS.APP_URL) + '">Open Rabotec Fleet Safety</a></p>'),
  });
}

/** Run once to switch on the 07:00 GMT daily email. */
function setupDailyEmail() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'sendExpiryDigest').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendExpiryDigest').timeBased().atHour(7).everyDays(1).inTimezone('Africa/Accra').create();
}

/* ---------------- one-time setup ---------------- */
/** Run once from the Apps Script editor (safe to run again). Creates and formats the tabs. */
function setup() {
  const ss = book_();
  [[VEH_SHEET, HEADINGS], [ACT_SHEET, ACT_HEADINGS], [USR_SHEET, USR_HEADINGS]].forEach(([name, heads]) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, heads.length).setValues([heads]).setFontWeight('bold').setBackground('#164C9D').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    // Plain-text format so Sheets never turns dates or registrations into numbers.
    sh.getRange(2, 1, sh.getMaxRows() - 1, heads.length).setNumberFormat('@');
  });
  const owner = String(SETTINGS.OWNER_EMAIL || '').trim().toLowerCase();
  if (owner) findUser_(owner);
  secret_();
  return 'Setup complete: Vehicles, Activity and Users tabs are ready.';
}

/* ---------------- helpers ---------------- */
// Opened once per request and reused: opening a Sheet is the slowest step in Apps Script.
let BOOK_ = null;
const SHEETS_ = {};
function book_() {
  if (BOOK_) return BOOK_;
  BOOK_ = SETTINGS.SHEET_ID ? SpreadsheetApp.openById(SETTINGS.SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  if (!BOOK_) throw err_('Set SHEET_ID in Code.gs to the ID of the register Sheet.', 'setup');
  return BOOK_;
}
function sheet_(name) {
  if (SHEETS_[name]) return SHEETS_[name];
  const sh = book_().getSheetByName(name);
  if (!sh) throw err_('The "' + name + '" tab is missing. Run setup() in Apps Script.', 'setup');
  return (SHEETS_[name] = sh);
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
function safeEqual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
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
