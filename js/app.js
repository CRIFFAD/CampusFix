/* CampusFix — public page */
(() => {
  const $ = s => document.querySelector(s);
  const PAGE = 12;
  const state = { q: '', status: 'all', category: 'all', sort: 'new', shown: PAGE, mine: false, myIds: new Set(), user: null };
  let issues = [], imageData = null, lastRef = '';

  const opts = (arr, sel) => arr.map(v => `<option${v === sel ? ' selected' : ''}>${Util.esc(v)}</option>`).join('');
  $('#category').innerHTML = '<option value="">Choose…</option>' + opts(CATEGORIES);
  $('#priority').innerHTML = opts(PRIORITIES, 'Normal');
  $('#f-category').innerHTML = '<option value="all">All categories</option>' + opts(CATEGORIES);

  // ----- form -----
  const setError = (name, msg) => {
    const box = document.querySelector(`[data-for="${name}"]`); if (box) box.textContent = msg || '';
    const el = document.getElementById(name); if (el) el.classList.toggle('invalid', !!msg);
  };
  function validate() {
    let ok = true;
    const need = (id, msg, min) => { if ($('#' + id).value.trim().length < min) { setError(id, msg); ok = false; } else setError(id, ''); };
    need('title', 'Enter a short title (at least 4 characters).', 4);
    need('location', 'Enter where the problem is.', 2);
    need('description', 'Describe the problem (at least 10 characters).', 10);
    if (!$('#category').value) { setError('category', 'Choose a category.'); ok = false; } else setError('category', '');
    return ok;
  }
  ['title', 'location', 'description', 'category'].forEach(id => $('#' + id).addEventListener('input', () => setError(id, '')));

  async function handleFile(file) {
    setError('image', ''); if (!file) return;
    try { imageData = await Util.compressImage(file); $('#preview-img').src = imageData; $('#preview').classList.remove('hidden'); }
    catch (e) { clearImage(); setError('image', e.message); }
  }
  function clearImage() { imageData = null; $('#image').value = ''; $('#preview').classList.add('hidden'); $('#preview-img').removeAttribute('src'); }
  $('#image').addEventListener('change', e => handleFile(e.target.files[0]));
  $('#remove-img').addEventListener('click', clearImage);
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));

  $('#issue-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!state.user) { openAuth('signin'); return; }
    if (!validate()) { Util.toast('Please fix the highlighted fields.', true); return; }
    const btn = $('#submit'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const r = await DB.submit({
        title: $('#title').value, category: $('#category').value, priority: $('#priority').value, location: $('#location').value,
        description: $('#description').value, website: $('#website').value }, imageData);
      lastRef = r.ref; $('#big-ref').textContent = r.ref;
      $('#form-view').classList.add('hidden'); $('#success-view').classList.remove('hidden');
      e.target.reset(); $('#priority').value = 'Normal'; clearImage();
      await Promise.all([load(), loadMine()]);
    } catch (err) {
      if (err.status === 401) openAuth('signin');
      if (err.field) setError(err.field, err.message);
      Util.toast(err.message, true);
    } finally { btn.disabled = false; btn.textContent = 'Submit report'; }
  });
  $('#another').addEventListener('click', () => { $('#success-view').classList.add('hidden'); $('#form-view').classList.remove('hidden'); $('#title').focus(); });
  $('#copy-ref').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(lastRef); Util.toast('Reference copied.'); } catch { Util.toast('Copy failed. Note it down: ' + lastRef, true); }
  });

  // ----- list -----
  function renderStats() {
    const n = k => issues.filter(i => i.status === k).length;
    const s = (num, lbl) => `<div><div class="n">${num}</div><div class="l">${lbl}</div></div>`;
    $('#hero-stats').innerHTML = s(issues.length, 'Reports received') + s(n('In Progress'), 'Being fixed now') + s(n('Resolved'), 'Resolved');
  }
  function renderChips() {
    const counts = { all: issues.length }; STATUSES.forEach(s => counts[s.key] = issues.filter(i => i.status === s.key).length);
    const chip = (k, label) => `<button type="button" class="chip" data-status="${k}" aria-pressed="${state.status === k}">${label}<span class="n">${counts[k]}</span></button>`;
    const mine = state.user ? `<button type="button" class="chip" data-mine="1" aria-pressed="${state.mine}">My reports<span class="n">${state.myIds.size}</span></button>` : '';
    $('#status-chips').innerHTML = chip('all', 'All') + STATUSES.map(s => chip(s.key, s.key)).join('') + mine;
  }
  const ticket = i => `
    <button type="button" class="ticket s-${Util.cls(i.status)}" data-id="${Util.esc(i.id)}">
      <div class="stub">${i.image ? `<img src="${Util.esc(i.image)}" alt="" loading="lazy">` : `<span class="ico" aria-hidden="true">${ICONS[i.category] || '🔧'}</span>`}</div>
      <div class="body">
        <div class="top"><h3>${Util.esc(i.title)}</h3>${Util.pill(i.status)}</div>
        <div class="meta"><span class="ref">${Util.esc(i.ref)}</span>${state.myIds.has(i.id) ? '<span class="mine-tag">Yours</span>' : ''}<span>${Util.esc(i.location)}</span><span>${Util.esc(i.category)}</span>
          <span class="prio ${i.priority.toLowerCase()}">${Util.esc(i.priority)}</span><span>${Util.ago(i.createdAt)}</span></div>
        <p class="desc">${Util.esc(i.description)}</p>
      </div>
    </button>`;
  function render() {
    renderStats(); renderChips();
    const list = Util.query(issues, state).filter(i => !state.mine || state.myIds.has(i.id)), visible = list.slice(0, state.shown);
    $('#count').textContent = `Showing ${visible.length} of ${list.length} report${list.length === 1 ? '' : 's'}`;
    $('#issues').innerHTML = visible.length ? visible.map(ticket).join('')
      : `<div class="empty"><strong>${issues.length ? 'No reports match your search' : 'No reports yet'}</strong>${issues.length ? 'Try a different keyword or clear the filters.' : 'Be the first to report an issue using the form.'}</div>`;
    $('#more').classList.toggle('hidden', list.length <= visible.length);
  }
  async function load() {
    try { issues = await DB.listPublic(); render(); }
    catch (e) {
      $('#count').textContent = '';
      $('#issues').innerHTML = `<div class="empty"><strong>Could not load reports</strong>${Util.esc(e.message)}<br><br><button class="btn dark" id="retry" type="button">Try again</button></div>`;
    }
  }
  $('#issues').addEventListener('click', e => {
    if (e.target.id === 'retry') return load();
    const t = e.target.closest('[data-id]'); if (!t) return;
    const i = issues.find(x => x.id === t.dataset.id); if (!i) return;
    $('#detail-title').textContent = i.title; $('#detail-body').innerHTML = Util.detailHTML(i); $('#detail').showModal();
  });
  const reset = () => { state.shown = PAGE; render(); };
  $('#status-chips').addEventListener('click', e => {
    const m = e.target.closest('[data-mine]'); if (m) { state.mine = !state.mine; return reset(); }
    const b = e.target.closest('[data-status]'); if (b) { state.status = b.dataset.status; reset(); }
  });
  $('#search').addEventListener('input', e => { state.q = e.target.value; reset(); });
  $('#f-category').addEventListener('change', e => { state.category = e.target.value; reset(); });
  $('#sort').addEventListener('change', e => { state.sort = e.target.value; reset(); });
  $('#clear').addEventListener('click', () => {
    Object.assign(state, { q: '', status: 'all', category: 'all', sort: 'new', mine: false });
    $('#search').value = ''; $('#f-category').value = 'all'; $('#sort').value = 'new'; reset();
  });
  $('#more-btn').addEventListener('click', () => { state.shown += PAGE; render(); });
  const dlg = $('#detail');
  $('#detail-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });


  // ----- accounts -----
  let mode = 'signin', authReady = false;
  const authDlg = $('#auth'), recoverDlg = $('#recover');
  const nameOf = u => (u.user_metadata && u.user_metadata.full_name) || (u.email || 'student').split('@')[0];

  async function loadMine() {
    try { state.myIds = state.user ? new Set(await DB.myIssueIds()) : new Set(); } catch { state.myIds = new Set(); }
    if (!state.user) state.mine = false;
  }
  function renderUserArea() {
    const u = state.user;
    $('#user-area').innerHTML = u
      ? `<span class="who" title="${Util.esc(u.email || '')}">Hi, ${Util.esc(nameOf(u).split(' ')[0])}</span><button class="btn small ghost" id="sign-out" type="button">Sign out</button>`
      : '<button class="btn small primary" id="open-auth" type="button">Sign in</button>';
  }
  async function applyUser(user) {
    const was = state.user ? state.user.id : null, now = user ? user.id : null;
    state.user = user; renderUserArea();
    if (!authReady || was !== now) {
      authReady = true;
      $('#gate-view').classList.toggle('hidden', !!user);
      $('#form-view').classList.toggle('hidden', !user);
      $('#success-view').classList.add('hidden');
      $('#as-user').textContent = user ? `Reporting as ${nameOf(user)}. Maintenance staff can see your name and email. Other students cannot.` : '';
      await loadMine(); render();
    }
  }
  function setMode(m) {
    mode = m;
    document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === m)));
    $('#f-name').classList.toggle('hidden', m !== 'signup');
    $('#auth-title').textContent = m === 'signup' ? 'Create your account' : 'Welcome back';
    $('#auth-submit').textContent = m === 'signup' ? 'Create account' : 'Sign in';
    $('#a-pass').setAttribute('autocomplete', m === 'signup' ? 'new-password' : 'current-password');
    $('#a-hint').textContent = m === 'signup' ? 'At least 8 characters.' : '';
    $('#forgot').classList.toggle('hidden', m === 'signup');
    $('#auth-err').textContent = ''; $('#auth-msg').classList.add('hidden');
  }
  function openAuth(m) { setMode(m); if (!authDlg.open) authDlg.showModal(); (m === 'signup' ? $('#a-name') : $('#a-email')).focus(); }

  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-auth],#open-auth,#sign-out'); if (!t) return;
    if (t.id === 'sign-out') { try { await DB.signOutUser(); } catch (x) { Util.toast(x.message, true); } return; }
    openAuth(t.dataset.auth || 'signin');
  });
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.tab)));
  $('#auth-close').addEventListener('click', () => authDlg.close());
  authDlg.addEventListener('click', e => { if (e.target === authDlg) authDlg.close(); });

  $('#auth-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#auth-err'), msg = $('#auth-msg'); err.textContent = ''; msg.classList.add('hidden');
    const email = $('#a-email').value.trim(), pass = $('#a-pass').value, name = $('#a-name').value.trim();
    if (mode === 'signup' && name.length < 2) return void (err.textContent = 'Enter your full name.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return void (err.textContent = 'Enter a valid email address.');
    if (mode === 'signup' && pass.length < 8) return void (err.textContent = 'Password must be at least 8 characters.');
    if (!pass) return void (err.textContent = 'Enter your password.');
    const btn = $('#auth-submit'); btn.disabled = true; btn.textContent = 'Please wait…';
    try {
      if (mode === 'signup') {
        const r = await DB.signUp(name, email, pass);
        if (r.needsConfirm) { setMode('signin'); msg.textContent = 'Account created. We sent a confirmation link to your email. Click it, then come back and sign in.'; msg.classList.remove('hidden'); }
        else { authDlg.close(); Util.toast(`Welcome, ${name.split(' ')[0]}!`); }
      } else { await DB.signInUser(email, pass); authDlg.close(); }
      $('#a-pass').value = '';
    } catch (x) { err.textContent = x.message; }
    finally { btn.disabled = false; btn.textContent = mode === 'signup' ? 'Create account' : 'Sign in'; }
  });
  $('#forgot').addEventListener('click', async () => {
    const err = $('#auth-err'), msg = $('#auth-msg'); err.textContent = ''; msg.classList.add('hidden');
    const email = $('#a-email').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return void (err.textContent = 'Type your email above first, then tap "Forgot your password?".');
    try { await DB.resetPassword(email); msg.textContent = 'If an account exists for that email, a reset link is on its way.'; msg.classList.remove('hidden'); }
    catch (x) { err.textContent = x.message; }
  });
  function openRecover() { $('#recover-err').textContent = ''; $('#r-pass').value = ''; if (!recoverDlg.open) recoverDlg.showModal(); }
  $('#recover-close').addEventListener('click', () => recoverDlg.close());
  $('#recover-form').addEventListener('submit', async e => {
    e.preventDefault(); const pw = $('#r-pass').value, err = $('#recover-err');
    if (pw.length < 8) { err.textContent = 'Password must be at least 8 characters.'; return; }
    try { await DB.updatePassword(pw); recoverDlg.close(); Util.toast('Password updated. You are signed in.'); }
    catch (x) { err.textContent = x.message; }
  });
  async function initAuth() {
    if (!configured) { applyUser(null); return; }
    try {
      await applyUser(await DB.currentUser());
      DB.onAuth((ev, s) => setTimeout(() => { if (ev === 'PASSWORD_RECOVERY') openRecover(); applyUser(s ? s.user : null); }, 0));
    } catch { applyUser(null); }
  }

  initAuth(); load(); setInterval(() => { if (!document.hidden) load(); }, 60000);
})();
