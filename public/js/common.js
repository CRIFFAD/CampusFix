/* CampusFix — shared helpers */
const STATUSES = [
  { key: 'Pending', cls: 'pending' },
  { key: 'In Progress', cls: 'progress' },
  { key: 'Resolved', cls: 'resolved' }
];
const CATEGORIES = ['Water', 'Electrical', 'Facilities', 'Sanitation', 'Building', 'Network / IT', 'Other'];
const PRIORITIES = ['Low', 'Normal', 'Urgent'];
const ICONS = { Water: '💧', Electrical: '⚡', Facilities: '🪑', Sanitation: '🚽', Building: '🏢', 'Network / IT': '📶', Other: '🔧' };

const Util = {
  esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  cls(status) { return (STATUSES.find(s => s.key === status) || STATUSES[0]).cls; },
  pill(status) { return `<span class="pill ${Util.cls(status)}">${Util.esc(status)}</span>`; },
  date(ts) { return new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); },
  ago(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h} hr ago`;
    const d = Math.floor(h / 24); if (d < 30) return `${d} day${d > 1 ? 's' : ''} ago`;
    return new Date(ts).toLocaleDateString();
  },
  toast(msg, isErr) {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; wrap.setAttribute('role', 'status'); document.body.appendChild(wrap); }
    const t = document.createElement('div'); t.className = 'toast' + (isErr ? ' err' : ''); t.textContent = msg;
    wrap.appendChild(t); setTimeout(() => t.remove(), 4500);
  },
  compressImage(file, maxSide = 1000, quality = 0.75) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file (JPG, PNG, WebP).'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('That image could not be opened.'));
        img.onload = () => {
          const k = Math.min(1, maxSide / Math.max(img.width, img.height));
          const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  },
  detailHTML(i) {
    const idx = STATUSES.findIndex(s => s.key === i.status);
    const steps = STATUSES.map((s, n) => `<li class="${n <= idx ? 'done' : ''} ${n === idx ? 'now' : ''}">${s.key}</li>`).join('');
    const hist = [...i.history].reverse().map(h => `
      <li><div class="when">${Util.date(h.at)}${h.by ? ' · ' + Util.esc(h.by) : ''}</div>
      <div class="what">${Util.esc(h.event)}</div>${h.note ? `<p class="note">${Util.esc(h.note)}</p>` : ''}</li>`).join('');
    return `
      ${i.image ? `<img class="dlg-img" src="${Util.esc(i.image)}" alt="Photo of the reported problem">` : ''}
      <ol class="tracker" aria-label="Progress">${steps}</ol>
      <dl class="facts">
        <dt>Reference</dt><dd><span class="ref">${Util.esc(i.ref)}</span></dd>
        <dt>Status</dt><dd>${Util.pill(i.status)}</dd>
        <dt>Location</dt><dd>${Util.esc(i.location)}</dd>
        <dt>Category</dt><dd>${Util.esc(i.category)}</dd>
        <dt>Urgency</dt><dd>${Util.esc(i.priority)}</dd>
        ${i.reporter !== undefined ? `<dt>Reported by</dt><dd>${Util.esc(i.reporter || 'Unknown')}</dd>` : ''}
        ${i.email ? `<dt>Contact</dt><dd>${Util.esc(i.email)}</dd>` : ''}
        <dt>Reported</dt><dd>${Util.date(i.createdAt)}</dd>
      </dl>
      <h3 class="sec">Description</h3>
      <p class="desc-full">${Util.esc(i.description)}</p>
      <h3 class="sec">Updates</h3>
      <ul class="timeline">${hist}</ul>`;
  },
  query(list, { q = '', status = 'all', category = 'all', priority = 'all', sort = 'new' }) {
    const term = q.trim().toLowerCase();
    const out = list.filter(i =>
      (status === 'all' || i.status === status) && (category === 'all' || i.category === category) &&
      (priority === 'all' || i.priority === priority) &&
      (!term || [i.title, i.description, i.location, i.category, i.ref, i.reporter || ''].join(' ').toLowerCase().includes(term)));
    const rank = { Urgent: 0, Normal: 1, Low: 2 };
    return out.sort((a, b) => sort === 'old' ? a.createdAt - b.createdAt
      : sort === 'urgent' ? (rank[a.priority] - rank[b.priority]) || (b.createdAt - a.createdAt) : b.createdAt - a.createdAt);
  }
};

/* ---------- Supabase data layer ---------- */
const BUCKET = 'issue-photos';
const Cfg = window.CAMPUSFIX_CONFIG || {};
const configured = !!(Cfg.SUPABASE_URL && Cfg.SUPABASE_ANON_KEY && !/YOUR[-_]/i.test(Cfg.SUPABASE_URL + Cfg.SUPABASE_ANON_KEY));
const sb = (configured && window.supabase)
  ? window.supabase.createClient(Cfg.SUPABASE_URL, Cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

const DB = (() => {
  const fail = (error, status) => {
    const msg = String(error?.message || error || '');
    let friendly = msg;
    if (/signups? not allowed|signup is disabled/i.test(msg)) friendly = 'New accounts are switched off right now. Please contact the administrator.';
    else if (/already registered|already been registered/i.test(msg)) friendly = 'An account with this email already exists. Try signing in.';
    else if (/password should be|at least \d+ char/i.test(msg)) friendly = 'Password must be at least 8 characters.';
    else if (/email not confirmed/i.test(msg)) friendly = 'Please confirm your email first. Check your inbox for the link.';
    else if (/rate limit|too many requests|security purposes/i.test(msg)) friendly = 'Too many attempts. Please wait a minute and try again.';
    else if (/failed to fetch|networkerror|load failed/i.test(msg)) friendly = 'Cannot reach the server. Check your connection and try again.';
    else if (/invalid login credentials/i.test(msg)) friendly = 'Incorrect email or password.';
    else if (/jwt|not allowed/i.test(msg)) { friendly = 'Please sign in again.'; status = 401; }
    throw Object.assign(new Error(friendly), { status: status || error?.status || 500 });
  };
  const need = () => { if (!sb) throw Object.assign(new Error('This site is not connected to Supabase yet. Add your project URL and key to config.js.'), { status: 500 }); };
  const imgUrl = p => p ? sb.storage.from(BUCKET).getPublicUrl(p).data.publicUrl : null;
  const ms = t => Date.parse(t);
  const normPublic = r => ({ id: r.id, ref: r.ref, title: r.title, category: r.category, location: r.location, description: r.description,
    priority: r.priority, status: r.status, image: imgUrl(r.image_path), imagePath: r.image_path, createdAt: ms(r.created_at), updatedAt: ms(r.updated_at),
    history: (r.history || []).map(h => ({ at: ms(h.at), event: h.event, note: h.note })) });
  const normAdmin = r => ({ ...normPublic({ ...r, history: [] }), reporter: r.reporter || '', email: r.reporter_email || '',
    history: (r.issue_events || []).slice().sort((a, b) => ms(a.created_at) - ms(b.created_at))
      .map(h => ({ at: ms(h.created_at), event: h.event, note: h.note, by: h.by_name })) });
  const dataUrlToBlob = url => {
    const [head, b64] = url.split(','); const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: head.match(/data:(.*?);/)[1] });
  };
  const fetchAdminIssue = async id => {
    const { data, error } = await sb.from('issues').select('*, issue_events(*)').eq('id', id).single();
    if (error) fail(error); return normAdmin(data);
  };
  const isStaff = async () => {
    const { data: { session } } = await sb.auth.getSession(); if (!session) return false;
    const { data, error } = await sb.rpc('is_admin'); return !error && data === true;
  };

  return {
    // ----- student accounts -----
    onAuth(cb) { need(); sb.auth.onAuthStateChange((ev, session) => cb(ev, session)); },
    async currentUser() { need(); const { data: { session } } = await sb.auth.getSession(); return session ? session.user : null; },
    async signUp(name, email, password) {
      need();
      const { data, error } = await sb.auth.signUp({ email: String(email).trim(), password,
        options: { data: { full_name: String(name).trim() }, emailRedirectTo: location.origin + location.pathname } });
      if (error) fail(error);
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) fail('User already registered');
      return { needsConfirm: !data.session };
    },
    async signInUser(email, password) {
      need();
      const { error } = await sb.auth.signInWithPassword({ email: String(email).trim(), password });
      if (error) fail(error);
    },
    async signOutUser() { need(); const { error } = await sb.auth.signOut(); if (error) fail(error); },
    async resetPassword(email) {
      need();
      const { error } = await sb.auth.resetPasswordForEmail(String(email).trim(), { redirectTo: location.origin + location.pathname });
      if (error) fail(error);
    },
    async updatePassword(password) { need(); const { error } = await sb.auth.updateUser({ password }); if (error) fail(error); },
    async myIssueIds() {
      need();
      const { data, error } = await sb.from('my_issue_ids').select('id');
      if (error) fail(error); return data.map(r => r.id);
    },

    async listPublic() {
      need();
      const { data, error } = await sb.from('public_issues').select('*').order('created_at', { ascending: false }).limit(1000);
      if (error) fail(error); return data.map(normPublic);
    },
    async submit(f, imageDataUrl) {
      need();
      let path = null;
      if (imageDataUrl) {
        path = (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => (Math.random() * 16 | 0).toString(16))) + '.jpg';
        const up = await sb.storage.from(BUCKET).upload(path, dataUrlToBlob(imageDataUrl), { contentType: 'image/jpeg', upsert: false });
        if (up.error) fail(up.error);
      }
      const { data, error } = await sb.rpc('submit_issue', { p_title: f.title, p_category: f.category, p_priority: f.priority, p_location: f.location,
        p_description: f.description, p_image_path: path, p_website: f.website || null });
      if (error) fail(error); return { ref: data };
    },
    async signIn(email, password) {
      need();
      const { error } = await sb.auth.signInWithPassword({ email: String(email).trim(), password });
      if (error) fail(error);
      if (!(await isStaff())) { throw Object.assign(new Error('This account does not have staff access.'), { status: 403 }); }
    },
    async signOut() { if (sb) await sb.auth.signOut(); },
    async listAdmin() {
      need();
      if (!(await isStaff())) throw Object.assign(new Error('Please sign in.'), { status: 401 });
      const { data, error } = await sb.from('issues').select('*, issue_events(*)').order('created_at', { ascending: false }).limit(1000);
      if (error) fail(error); return data.map(normAdmin);
    },
    async update(id, status, note) {
      need();
      const { error } = await sb.rpc('admin_update_issue', { p_id: id, p_status: status, p_note: note || '' });
      if (error) fail(error); return fetchAdminIssue(id);
    },
    async remove(issue) {
      need();
      const { data, error } = await sb.from('issues').delete().eq('id', issue.id).select('id');
      if (error) fail(error);
      if (!data || !data.length) fail('Not allowed.');
      if (issue.imagePath) await sb.storage.from(BUCKET).remove([issue.imagePath]);
    }
  };
})();
