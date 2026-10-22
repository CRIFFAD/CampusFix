/* CampusFix — staff dashboard */
(() => {
  const $ = s => document.querySelector(s);
  const PAGE = 25;
  const state = { q: '', status: 'all', category: 'all', priority: 'all', sort: 'new', shown: PAGE };
  let issues = [], currentId = null;

  const opts = arr => arr.map(v => `<option>${Util.esc(v)}</option>`).join('');
  $('#a-status').innerHTML = '<option value="all">All statuses</option>' + opts(STATUSES.map(s => s.key));
  $('#a-category').innerHTML = '<option value="all">All categories</option>' + opts(CATEGORIES);
  $('#a-priority').innerHTML = '<option value="all">All urgencies</option>' + opts(PRIORITIES);
  $('#m-status').innerHTML = opts(STATUSES.map(s => s.key));

  function show(signedIn) {
    $('#login').classList.toggle('hidden', signedIn);
    $('#dash').classList.toggle('hidden', !signedIn);
    if (!signedIn) $('#email').focus();
  }
  function handle(e) { // any 401 sends staff back to sign-in
    if (e.status === 401) { show(false); Util.toast('Please sign in again.', true); } else Util.toast(e.message, true);
  }

  async function load() {
    try { issues = await DB.listAdmin(); show(true); render(); }
    catch (e) { if (e.status === 401) show(false); else { show(false); $('#login-err').textContent = e.message; } }
  }

  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault(); const btn = $('#login-btn'); btn.disabled = true; btn.textContent = 'Signing in…';
    try { await DB.signIn($('#email').value, $('#pass').value); $('#pass').value = ''; $('#login-err').textContent = ''; await load(); }
    catch (err) { $('#login-err').textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = 'Sign in'; }
  });
  $('#logout').addEventListener('click', async () => { try { await DB.signOut(); } catch { /* ignore */ } issues = []; show(false); });

  function render() {
    const n = k => issues.filter(i => i.status === k).length;
    const urgent = issues.filter(i => i.priority === 'Urgent' && i.status !== 'Resolved').length;
    const box = (num, lbl, cls = '') => `<div class="stat ${cls}"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`;
    $('#stats').innerHTML = box(issues.length, 'Total reports') + box(n('Pending'), 'Pending') + box(n('In Progress'), 'In progress') + box(urgent, 'Urgent and unresolved', 'urgent');
    $('#dist').innerHTML = STATUSES.map(s => `<span class="d-${s.cls}" data-v="${n(s.key)}"></span>`).join('');
    $('#dist').querySelectorAll('span').forEach(el => { el.style.flex = `${el.dataset.v} 1 0`; });

    const list = Util.query(issues, state), visible = list.slice(0, state.shown);
    $('#a-count').textContent = `Showing ${visible.length} of ${list.length} reports`;
    $('#rows').innerHTML = visible.length ? visible.map(i => `
      <tr>
        <td data-label="Ref"><span class="ref">${Util.esc(i.ref)}</span></td>
        <td data-label="Issue"><div class="t">${Util.esc(i.title)}</div><div class="c">${Util.esc(i.category)}${i.image ? ' · photo attached' : ''}</div></td>
        <td data-label="Location">${Util.esc(i.location)}</td>
        <td data-label="Urgency"><span class="prio ${i.priority.toLowerCase()}">${Util.esc(i.priority)}</span></td>
        <td data-label="Reported" title="${Util.date(i.createdAt)}">${Util.ago(i.createdAt)}</td>
        <td data-label="Status"><label class="sr-only" for="st-${Util.esc(i.id)}">Status for ${Util.esc(i.ref)}</label>
          <select id="st-${Util.esc(i.id)}" data-status-for="${Util.esc(i.id)}">${STATUSES.map(s => `<option${s.key === i.status ? ' selected' : ''}>${s.key}</option>`).join('')}</select></td>
        <td class="act"><button class="btn small dark" data-manage="${Util.esc(i.id)}" type="button">Manage</button></td>
      </tr>`).join('')
      : `<tr><td colspan="7" class="none"><div class="empty">${issues.length ? '<strong>No reports match these filters</strong>' : '<strong>No reports yet</strong>New reports will show up here.'}</div></td></tr>`;
    $('#a-more').classList.toggle('hidden', list.length <= visible.length);
  }

  const reset = () => { state.shown = PAGE; render(); };
  $('#a-search').addEventListener('input', e => { state.q = e.target.value; reset(); });
  [['a-status', 'status'], ['a-category', 'category'], ['a-priority', 'priority'], ['a-sort', 'sort']]
    .forEach(([id, k]) => $('#' + id).addEventListener('change', e => { state[k] = e.target.value; reset(); }));
  $('#a-more-btn').addEventListener('click', () => { state.shown += PAGE; render(); });

  function replace(updated) { issues = issues.map(i => i.id === updated.id ? updated : i); }

  $('#rows').addEventListener('change', async e => {
    const id = e.target.dataset.statusFor; if (!id) return;
    try { replace(await DB.update(id, e.target.value, '')); Util.toast(`Status changed to ${e.target.value}.`); }
    catch (err) { handle(err); }
    render();
  });

  const dlg = $('#manage');
  function openManage(id) {
    const i = issues.find(x => x.id === id); if (!i) return;
    currentId = id; $('#m-title').textContent = i.title; $('#m-detail').innerHTML = Util.detailHTML(i);
    $('#m-status').value = i.status; $('#m-note').value = ''; if (!dlg.open) dlg.showModal();
  }
  $('#rows').addEventListener('click', e => { const b = e.target.closest('[data-manage]'); if (b) openManage(b.dataset.manage); });
  $('#m-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

  $('#m-form').addEventListener('submit', async e => {
    e.preventDefault(); const btn = $('#m-save'); btn.disabled = true;
    try { replace(await DB.update(currentId, $('#m-status').value, $('#m-note').value)); Util.toast('Report updated.'); openManage(currentId); render(); }
    catch (err) { handle(err); } finally { btn.disabled = false; }
  });
  $('#m-delete').addEventListener('click', async () => {
    const i = issues.find(x => x.id === currentId);
    if (!i || !confirm(`Delete ${i.ref} permanently? This cannot be undone.`)) return;
    try { await DB.remove(i); issues = issues.filter(x => x.id !== currentId); dlg.close(); Util.toast('Report deleted.'); render(); }
    catch (err) { handle(err); }
  });

  $('#export').addEventListener('click', () => {
    const q = v => { let s = String(v ?? '').replace(/"/g, '""'); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s + '"'; };
    const head = ['Reference', 'Title', 'Category', 'Location', 'Urgency', 'Status', 'Reporter', 'Email', 'Reported', 'Description'];
    const rows = Util.query(issues, state).map(i => [i.ref, i.title, i.category, i.location, i.priority, i.status, i.reporter || '', i.email || '', new Date(i.createdAt).toISOString(), i.description].map(q).join(','));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([[head.map(q).join(','), ...rows].join('\n')], { type: 'text/csv' }));
    a.download = 'campusfix-reports.csv'; a.click(); URL.revokeObjectURL(a.href);
  });

  load(); setInterval(() => { if (!document.hidden && !$('#dash').classList.contains('hidden') && !dlg.open) load(); }, 60000);
})();
