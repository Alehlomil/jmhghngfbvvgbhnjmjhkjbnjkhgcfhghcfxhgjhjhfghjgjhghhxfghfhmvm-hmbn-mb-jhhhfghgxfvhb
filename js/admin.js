(function () {
  'use strict';
  const cfg = window.MULVAKUN_CONFIG || {};
  const base = String(cfg.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = String(cfg.SUPABASE_PUBLISHABLE_KEY || '').trim();
  function safeBrowserKey(value) {
    if (!value || value.startsWith('sb_secret_') || value.length < 20) return false;
    const chunks = value.split('.');
    if (chunks.length === 3) {
      try { const payload = JSON.parse(atob(chunks[1].replace(/-/g, '+').replace(/_/g, '/'))); if (payload.role === 'service_role') return false; } catch (_) { /* modern publishable keys are not JWTs */ }
    }
    return true;
  }
  const configured = /^https:\/\//i.test(base) && safeBrowserKey(key);
  const authShell = document.getElementById('auth-shell');
  const dashboard = document.getElementById('dashboard');
  const loginForm = document.getElementById('login-form');
  const loginButton = document.getElementById('login-button');
  const loginError = document.getElementById('login-error');
  const alertBox = document.getElementById('dash-alert');
  const toastBox = document.getElementById('admin-toast');
  const confirmDialog = document.getElementById('confirm-dialog');
  const confirmTitle = document.getElementById('confirm-title');
  const confirmMessage = document.getElementById('confirm-message');
  let accessToken = null; // memory only; do not persist administrator access tokens in localStorage
  let userEmail = '';
  let userId = '';
  let activeView = 'overview';
  let overviewPeriod = 'today';
  let downloadPeriod = 'all';
  let visitorPage = 1;
  let serverTimezone = 'UTC';
  let confirmResolver = null;

  const titleMap = { overview: 'Overview', visitors: 'Visitors', downloads: 'Downloads', blocks: 'Blocked addresses', events: 'Security events', settings: 'Settings' };
  function toast(message, isError = false) {
    toastBox.textContent = message; toastBox.hidden = false; toastBox.classList.toggle('error', isError);
    clearTimeout(toastBox.timer); toastBox.timer = setTimeout(() => { toastBox.hidden = true; }, 5500);
  }
  function showAlert(message) { alertBox.textContent = message; alertBox.hidden = false; }
  function clearAlert() { alertBox.textContent = ''; alertBox.hidden = true; }
  function node(tag, className, text) {
    const out = document.createElement(tag);
    if (className) out.className = className;
    if (text !== undefined && text !== null) out.textContent = String(text);
    return out;
  }
  function clear(target) { while (target.firstChild) target.removeChild(target.firstChild); }
  function fmtDate(value) {
    if (!value) return '—';
    const date = new Date(value); if (Number.isNaN(date.getTime())) return '—';
    try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: serverTimezone }).format(date); }
    catch (_) { return date.toLocaleString(); }
  }
  function fmtNum(value) { return new Intl.NumberFormat().format(Number(value || 0)); }
  function shortId(value) { const s = String(value || ''); return s.length > 16 ? s.slice(0, 8) + '…' + s.slice(-5) : s || '—'; }
  async function authRequest(path, options = {}) {
    const response = await fetch(base + '/auth/v1/' + path, { ...options, headers: { 'apikey': key, ...(options.headers || {}) }, cache: 'no-store', credentials: 'omit' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.msg || data.message || data.error_description || data.error || ('Auth request failed (' + response.status + ')'));
    return data;
  }
  async function adminRequest(action, args = {}) {
    if (!accessToken) throw new Error('Session expired. Please sign in again.');
    const response = await fetch(base + '/functions/v1/' + (cfg.ADMIN_FUNCTION || 'admin-api'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': key, 'Authorization': 'Bearer ' + accessToken },
      body: JSON.stringify({ action, ...args }), credentials: 'omit', cache: 'no-store'
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) { forceLogout(); throw new Error('Session expired. Please sign in again.'); }
    if (!response.ok) throw new Error(result.error || ('Request failed (' + response.status + ')'));
    return result;
  }
  function forceLogout() {
    accessToken = null; userId = ''; userEmail = '';
    dashboard.hidden = true; authShell.hidden = false;
    document.getElementById('password').value = '';
  }
  function showDashboard(user) {
    authShell.hidden = true; dashboard.hidden = false;
    userEmail = user.email || ''; userId = user.id || '';
    document.getElementById('admin-email').textContent = userEmail;
    clearAlert(); showView('overview');
  }
  function showView(view) {
    if (!titleMap[view]) return;
    activeView = view;
    document.getElementById('view-title').textContent = titleMap[view];
    document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== view; });
    document.querySelectorAll('.side-nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    document.getElementById('sidebar').classList.remove('open');
    loadView(view).catch(err => showAlert(err.message || 'Unable to load this section.'));
  }
  async function loadView(view) {
    clearAlert();
    if (view === 'overview') return loadOverview();
    if (view === 'visitors') return loadVisitors();
    if (view === 'downloads') return loadDownloads();
    if (view === 'blocks') return loadBlocks();
    if (view === 'events') return loadSecurityEvents();
    if (view === 'settings') return loadSettings();
  }
  function addMetric(target, label, value, note) {
    const card = node('article', 'metric-card');
    card.append(node('small', '', label), node('b', '', fmtNum(value)), node('span', '', note));
    target.append(card);
  }
  function renderTable(target, columns, rows, emptyText = 'No records yet.') {
    clear(target);
    if (!rows || rows.length === 0) { target.append(node('div', 'empty-state', emptyText)); return; }
    const table = node('table');
    const thead = node('thead'); const trh = node('tr');
    columns.forEach(col => trh.append(node('th', '', col.label)));
    thead.append(trh); table.append(thead);
    const tbody = node('tbody');
    rows.forEach(row => {
      const tr = node('tr');
      columns.forEach(col => {
        const td = node('td');
        const value = col.render ? col.render(row) : row[col.key];
        if (value instanceof Node) td.append(value); else td.textContent = value === null || value === undefined || value === '' ? '—' : String(value);
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.append(tbody); target.append(table);
  }
  function eventLabel(type) { return type === 'page_visit' ? 'Page visit' : type === 'download_start' ? 'Download start' : String(type || 'Event').replace(/_/g, ' '); }

  async function loadOverview() {
    const data = await adminRequest('overview', { period: overviewPeriod });
    serverTimezone = data.timezone || serverTimezone;
    const target = document.getElementById('overview-metrics'); clear(target);
    addMetric(target, 'Recorded visits', data.visits, 'Page-visit events');
    addMetric(target, 'Unique browser IDs', data.unique_visitors, 'Random first-party IDs');
    addMetric(target, 'Download starts', data.download_starts, 'Not confirmed completions');
    addMetric(target, 'Active block rules', data.active_blocks, 'For backend endpoints');
    const chart = document.getElementById('platform-chart'); clear(chart);
    const platforms = Array.isArray(data.platforms) ? data.platforms : [];
    if (!platforms.length) chart.append(node('div', 'empty-state', 'No download-start events in this period.'));
    else {
      const max = Math.max(...platforms.map(item => Number(item.count || 0)), 1);
      platforms.forEach(item => {
        const row = node('div', 'platform-row'); row.append(node('span', 'platform-name', item.platform || 'Unknown platform'));
        const track = node('div', 'platform-track'); const fill = node('div', 'platform-fill'); fill.style.width = Math.max(1, Number(item.count || 0) / max * 100) + '%'; track.append(fill);
        row.append(track, node('span', 'platform-count', fmtNum(item.count))); chart.append(row);
      });
    }
    const recentRows = data.recent_events || [];
    renderTable(document.getElementById('recent-events'), [
      { label: 'EVENT', render: r => eventLabel(r.event_type) },
      { label: 'VISITOR ID', render: r => node('span','table-id',shortId(r.visitor_id)) },
      { label: 'PLATFORM / PAGE', render: r => r.platform || r.path || '—' },
      { label: 'COUNTRY', render: r => r.country || r.country_code || '—' },
      { label: 'TIME', render: r => fmtDate(r.created_at) }
    ], recentRows, 'No activity recorded for this period.');
  }
  function setActivePeriod(groupId, period) {
    document.querySelectorAll('#' + groupId + ' button').forEach(b => b.classList.toggle('selected', b.dataset.period === period));
  }

  async function loadVisitors() {
    const params = {
      page: visitorPage,
      query: document.getElementById('visitor-search').value.trim(),
      country: document.getElementById('country-filter').value,
      browser: document.getElementById('browser-filter').value,
      blocked: document.getElementById('blocked-filter').value,
      from: document.getElementById('visitor-from').value ? new Date(document.getElementById('visitor-from').value + 'T00:00:00').toISOString() : '',
      to: document.getElementById('visitor-to').value ? new Date(document.getElementById('visitor-to').value + 'T23:59:59.999').toISOString() : '',
      sort: document.getElementById('visitor-sort').value
    };
    const data = await adminRequest('visitors', params);
    const countrySelect = document.getElementById('country-filter'); const chosen = countrySelect.value;
    const known = new Set(Array.from(countrySelect.options).map(o => o.value));
    (data.countries || []).forEach(country => {
      if (country.code && !known.has(country.code)) countrySelect.append(new Option(country.name + ' (' + country.code + ')', country.code));
    });
    countrySelect.value = chosen;
    renderTable(document.getElementById('visitor-table'), [
      { label: 'VISITOR ID', render: r => { const b = node('button','plain-action table-id',shortId(r.visitor_id)); b.title = r.visitor_id; b.addEventListener('click', () => loadVisitorHistory(r.visitor_id)); return b; } },
      { label: 'IP ADDRESS', key: 'ip_address' },
      { label: 'COUNTRY', render: r => [r.country, r.country_code].filter(Boolean).join(' · ') },
      { label: 'ISP / ORG', render: r => r.isp || r.asn || '—' },
      { label: 'BROWSER / OS', render: r => [r.browser, r.operating_system].filter(Boolean).join(' / ') },
      { label: 'VISITS', render: r => fmtNum(r.visit_count) },
      { label: 'DOWNLOADS', render: r => fmtNum(r.download_count) },
      { label: 'STATUS', render: r => node('span', 'tag' + (r.blocked ? ' blocked' : ''), r.blocked ? 'BLOCKED' : 'ACTIVE') },
      { label: 'ACTION', render: r => { const b = node('button','table-action' + (r.blocked ? '' : ' danger'),r.blocked ? 'Blocked by rule' : 'Block IP'); b.disabled = Boolean(r.blocked || !r.ip_address); b.addEventListener('click', async () => { if (await askConfirm('Block this address?', 'Block ' + r.ip_address + ' for requests handled by the backend? GitHub Pages and direct public release links cannot be blocked here.')) { await adminRequest('block_ip',{network:r.ip_address,reason:'Blocked from visitor table'}); toast('Block rule saved.'); await loadVisitors(); } }); return b; } }
    ], data.rows, 'No visitor records match these filters.');
    const totalPages = Math.max(1, Math.ceil((data.count || 0) / (data.page_size || 25)));
    document.getElementById('visitor-page-label').textContent = 'Page ' + data.page + ' of ' + totalPages + ' · ' + fmtNum(data.count) + ' records';
    document.getElementById('visitors-prev').disabled = visitorPage <= 1;
    document.getElementById('visitors-next').disabled = visitorPage >= totalPages;
  }
  async function loadVisitorHistory(id) {
    const panel = document.getElementById('visitor-detail'); panel.hidden = false;
    const target = document.getElementById('visitor-history'); clear(target); target.append(node('div','empty-state','Loading visit history…'));
    const data = await adminRequest('visitor_history',{visitor_id:id});
    const r = data.visitor;
    document.getElementById('visitor-detail-title').textContent = r ? `${r.visitor_id} · ${r.ip_address || 'IP unavailable'} · ${r.country || 'GeoIP unavailable'} · ${r.isp || 'ISP unavailable'}` : id;
    renderTable(target,[
      {label:'EVENT',render:e=>eventLabel(e.event_type)}, {label:'PLATFORM / ASSET',render:e=>[e.platform,e.download_id].filter(Boolean).join(' · ')},
      {label:'PATH',key:'path'}, {label:'TIME',render:e=>fmtDate(e.created_at)}
    ],data.events,'No stored history for this visitor.');
    panel.scrollIntoView({behavior:'smooth',block:'start'});
  }

  async function loadDownloads() {
    const data = await adminRequest('downloads',{period:downloadPeriod});
    serverTimezone = data.timezone || serverTimezone;
    const metrics = document.getElementById('download-metrics'); clear(metrics);
    addMetric(metrics,'All download starts',data.total,'Selected reporting period');
    const counts = new Map((data.platforms || []).map(p => [p.platform,Number(p.count || 0)]));
    addMetric(metrics,'Windows',counts.get('windows') || 0,'Installer + portable');
    addMetric(metrics,'Linux',counts.get('linux') || 0,'Portable ZIP');
    renderTable(document.getElementById('download-events'),[
      {label:'TIME',render:r=>fmtDate(r.created_at)},
      {label:'VISITOR ID',render:r=>node('span','table-id',shortId(r.visitor_id))},
      {label:'PLATFORM',key:'platform'}, {label:'APPROVED ASSET',key:'download_id'}
    ],data.rows,'No download-start events in this period.');
  }

  async function loadBlocks() {
    const data = await adminRequest('blocks');
    renderTable(document.getElementById('block-table'),[
      {label:'NETWORK',render:r=>node('span','table-id',r.network)}, {label:'REASON',key:'reason'}, {label:'CREATED',render:r=>fmtDate(r.created_at)},
      {label:'ACTION',render:r=>{const b=node('button','table-action danger','Unblock');b.addEventListener('click',async()=>{if(await askConfirm('Remove block rule?','Requests matching '+r.network+' will no longer be blocked by this rule.')){await adminRequest('unblock_ip',{block_id:r.id});toast('Block rule removed.');await loadBlocks();}});return b;}}
    ],data.rows,'No active block rules.');
  }
  async function loadSecurityEvents() {
    const data = await adminRequest('security_events');
    renderTable(document.getElementById('security-table'),[
      {label:'TIME',render:r=>fmtDate(r.created_at)}, {label:'EVENT',render:r=>eventLabel(r.event_type)},
      {label:'ADMIN',render:r=>r.actor_email || shortId(r.actor_user_id)}, {label:'TARGET',key:'target'},
      {label:'DETAILS',render:r=>{const text=JSON.stringify(r.details || {});return text.length>180?text.slice(0,177)+'…':text;}}
    ],data.rows,'No security events recorded yet. Supabase Auth logs also contain rejected login attempts.');
  }
  async function loadSettings() {
    const data = await adminRequest('settings'); const values = data.values || {};
    document.getElementById('retention-days').value = values.retention_days?.days || 180;
    document.getElementById('server-timezone').value = values.timezone?.timezone || 'UTC';
    document.getElementById('geoip-provider-status').textContent = data.geoip_configured ? 'ipapi.co configured (key is server-side)' : 'Not configured; geographic fields stay empty';
    const geo = document.querySelector('.security-facts div:last-child dd');
    if (geo) geo.textContent = 'GitHub Pages is public and static';
  }
  function askConfirm(title, message) {
    confirmTitle.textContent = title; confirmMessage.textContent = message; confirmDialog.hidden = false;
    return new Promise(resolve => { confirmResolver = resolve; });
  }
  function resolveConfirm(result) { confirmDialog.hidden = true; if (confirmResolver) confirmResolver(result); confirmResolver = null; }
  document.getElementById('confirm-cancel').addEventListener('click', () => resolveConfirm(false));
  document.getElementById('confirm-proceed').addEventListener('click', () => resolveConfirm(true));
  confirmDialog.addEventListener('click', event => { if (event.target === confirmDialog) resolveConfirm(false); });

  loginForm.addEventListener('submit', async event => {
    event.preventDefault(); loginError.hidden = true; loginButton.disabled = true;
    if (!configured) { loginError.textContent = 'Supabase is not configured. Add the project URL and public publishable key in js/config.js.'; loginError.hidden = false; loginButton.disabled = false; return; }
    try {
      const payload = await authRequest('token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value.trim(),password:document.getElementById('password').value})});
      if (!payload.access_token || !payload.user?.id) throw new Error('Authentication response was incomplete');
      accessToken = payload.access_token; userId = payload.user.id;
      const check = await adminRequest('session_started');
      if (!check.ok) throw new Error('Administrator authorization failed');
      showDashboard(payload.user);
    } catch (error) {
      accessToken = null; userId = '';
      loginError.textContent = /invalid login|credentials/i.test(error.message) ? 'Sign-in failed. Check the credentials or Supabase Auth logs.' : error.message;
      loginError.hidden = false;
    } finally { loginButton.disabled = false; }
  });
  document.getElementById('logout-button').addEventListener('click', async () => {
    const token = accessToken;
    try {
      if (token) {
        await adminRequest('logout').catch(() => {});
        await authRequest('logout',{method:'POST',headers:{'Authorization':'Bearer '+token}}).catch(() => {});
      }
    } finally { forceLogout(); toast('Signed out.'); }
  });
  document.querySelectorAll('.side-nav-item').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => showView(b.dataset.go)));
  document.getElementById('sidebar-toggle').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
  document.querySelectorAll('#period-filter button').forEach(b => b.addEventListener('click', () => { overviewPeriod=b.dataset.period;setActivePeriod('period-filter',overviewPeriod);loadOverview().catch(e=>showAlert(e.message)); }));
  document.querySelectorAll('#download-period-filter button').forEach(b => b.addEventListener('click', () => { downloadPeriod=b.dataset.period;setActivePeriod('download-period-filter',downloadPeriod);loadDownloads().catch(e=>showAlert(e.message)); }));
  document.getElementById('visitor-search-button').addEventListener('click', () => {visitorPage=1;loadVisitors().catch(e=>showAlert(e.message));});
  document.getElementById('visitor-search').addEventListener('keydown', e => {if(e.key==='Enter'){e.preventDefault();visitorPage=1;loadVisitors().catch(err=>showAlert(err.message));}});
  ['country-filter','browser-filter','blocked-filter','visitor-sort','visitor-from','visitor-to'].forEach(id => document.getElementById(id).addEventListener('change', () => {visitorPage=1;loadVisitors().catch(e=>showAlert(e.message));}));
  document.getElementById('visitors-prev').addEventListener('click', () => {if(visitorPage>1){visitorPage--;loadVisitors().catch(e=>showAlert(e.message));}});
  document.getElementById('visitors-next').addEventListener('click', () => {visitorPage++;loadVisitors().catch(e=>showAlert(e.message));});
  document.getElementById('close-visitor-detail').addEventListener('click',()=>document.getElementById('visitor-detail').hidden=true);
  document.getElementById('refresh-events').addEventListener('click',()=>loadSecurityEvents().catch(e=>showAlert(e.message)));
  document.getElementById('block-network').addEventListener('input', e => { document.getElementById('cidr-confirm-wrap').hidden = !e.target.value.includes('/'); if(!e.target.value.includes('/'))document.getElementById('cidr-confirm').checked=false; });
  document.getElementById('block-form').addEventListener('submit',async event=>{
    event.preventDefault(); const network=document.getElementById('block-network').value.trim();const isCidr=network.includes('/');
    if(isCidr&&!document.getElementById('cidr-confirm').checked){toast('Confirm the CIDR network range first.',true);return;}
    try{if(await askConfirm('Add block rule?',`Add ${network} to the backend block list? This does not block GitHub Pages itself or direct public release URLs.`)){await adminRequest('block_ip',{network,reason:document.getElementById('block-reason').value.trim(),confirm_cidr:isCidr&&document.getElementById('cidr-confirm').checked});document.getElementById('block-form').reset();document.getElementById('cidr-confirm-wrap').hidden=true;toast('Block rule saved.');await loadBlocks();}}catch(e){toast(e.message,true);}
  });
  document.getElementById('retention-form').addEventListener('submit',async event=>{event.preventDefault();try{await adminRequest('update_retention',{days:Number(document.getElementById('retention-days').value)});toast('Retention setting saved.');}catch(e){toast(e.message,true);}});
  document.getElementById('timezone-form').addEventListener('submit',async event=>{event.preventDefault();try{await adminRequest('update_timezone',{timezone:document.getElementById('server-timezone').value});serverTimezone=document.getElementById('server-timezone').value;toast('Reporting timezone saved.');}catch(e){toast(e.message,true);}});
  document.getElementById('cleanup-button').addEventListener('click',async()=>{try{if(await askConfirm('Run data cleanup?', 'Permanently delete analytics events and inactive visitor records older than the configured retention period, plus expired GeoIP cache entries? This cannot be undone.')){const result=await adminRequest('cleanup');toast('Cleanup complete: '+fmtNum(result.result?.events_deleted)+' events and '+fmtNum(result.result?.visitors_deleted)+' visitor records deleted.');await loadSettings();}}catch(e){toast(e.message,true);}});
})();
