(function () {
  'use strict';
  const cfg = window.MULVAKUN_CONFIG || {};
  const apiUrl = String(cfg.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const publicKey = String(cfg.SUPABASE_PUBLISHABLE_KEY || '').trim();
  function safeBrowserKey(value) {
    if (!value || value.startsWith('sb_secret_') || value.length < 20) return false;
    const chunks = value.split('.');
    if (chunks.length === 3) {
      try { const payload = JSON.parse(atob(chunks[1].replace(/-/g, '+').replace(/_/g, '/'))); if (payload.role === 'service_role') return false; } catch (_) { /* modern publishable keys are not JWTs */ }
    }
    return true;
  }
  const configured = /^https:\/\//i.test(apiUrl) && safeBrowserKey(publicKey);
  const consentKey = 'mulvakun_analytics_consent_v1';
  const visitorKey = 'mulvakun_visitor_id_v1';
  const banner = document.getElementById('consent-banner');
  const statusEl = document.getElementById('site-status');
  const toastEl = document.getElementById('toast');
  const menuButton = document.getElementById('menu-toggle');
  const mobileNav = document.getElementById('mobile-nav');
  document.getElementById('year').textContent = String(new Date().getFullYear());

  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { toastEl.hidden = true; }, 5200);
  }
  function setStatus(state, message) {
    statusEl.dataset.state = state;
    statusEl.lastElementChild.textContent = message;
  }
  function visitorId() {
    try {
      let id = localStorage.getItem(visitorKey);
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
        id = crypto.randomUUID();
        localStorage.setItem(visitorKey, id);
      }
      return id;
    } catch (_) { return null; }
  }
  function consent() {
    try { return localStorage.getItem(consentKey); } catch (_) { return null; }
  }
  async function callTrack(payload) {
    if (!configured) throw new Error('Supabase is not configured');
    const response = await fetch(apiUrl + '/functions/v1/' + (cfg.TRACK_FUNCTION || 'track'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': publicKey },
      body: JSON.stringify(payload), credentials: 'omit', cache: 'no-store'
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || ('HTTP ' + response.status));
    return result;
  }
  async function recordVisit() {
    if (consent() !== 'accepted') return;
    const id = visitorId();
    if (!id) { setStatus('error', 'Analytics skipped: browser storage is unavailable. Downloads still work.'); return; }
    if (!configured) { setStatus('idle', 'Analytics is not connected yet. Published GitHub release links remain available.'); return; }
    try {
      await callTrack({ action: 'visit', visitor_id: id, path: location.pathname.slice(0, 220) || '/' });
      setStatus('success', 'Optional analytics is enabled. Release links point to published binary files.');
    } catch (_) {
      setStatus('error', 'Analytics endpoint is unavailable. Downloads still open the published release files.');
    }
  }
  function setConsent(value) {
    try { localStorage.setItem(consentKey, value); } catch (_) { toast('This browser blocked local storage. Optional analytics remains disabled.'); }
    banner.hidden = true;
    if (value === 'accepted') recordVisit();
    else setStatus('idle', 'Optional analytics is off. Downloads still work normally.');
  }
  document.getElementById('consent-accept').addEventListener('click', () => setConsent('accepted'));
  document.getElementById('consent-reject').addEventListener('click', () => setConsent('rejected'));
  document.getElementById('privacy-settings').addEventListener('click', () => { banner.hidden = false; });
  if (!consent()) banner.hidden = false;
  else if (consent() === 'accepted') recordVisit();
  else setStatus('idle', 'Optional analytics is off. Downloads still work normally.');

  menuButton.addEventListener('click', () => {
    const expanded = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!expanded));
    mobileNav.hidden = expanded;
  });
  mobileNav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    mobileNav.hidden = true; menuButton.setAttribute('aria-expanded', 'false');
  }));

  document.querySelectorAll('[data-download-id]').forEach(link => {
    link.addEventListener('click', async event => {
      if (consent() !== 'accepted' || !configured) return; // preserve the genuine URL fallback
      event.preventDefault();
      const originalUrl = link.href;
      link.setAttribute('aria-busy', 'true');
      const oldText = link.querySelector('small') ? link.querySelector('small').textContent : '';
      if (link.querySelector('small')) link.querySelector('small').textContent = 'Preparing download…';
      try {
        const result = await callTrack({ action: 'download', visitor_id: visitorId(), download_id: link.dataset.downloadId });
        if (!result.redirect_url || !/^https:\/\/github\.com\//i.test(result.redirect_url)) throw new Error('Unexpected download destination');
        location.assign(result.redirect_url);
      } catch (error) {
        toast('Download tracking was unavailable. Opening the published binary link instead.');
        location.assign(originalUrl);
      } finally {
        link.removeAttribute('aria-busy');
        if (link.querySelector('small')) link.querySelector('small').textContent = oldText || 'Latest published build';
      }
    });
  });

  // The API is used only to display the actual latest tag when GitHub responds.
  // The direct release links above remain the fallback, not fabricated URLs.
  if (cfg.GITHUB_RELEASES_API) {
    fetch(cfg.GITHUB_RELEASES_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('release lookup failed')))
      .then(release => {
        const label = document.getElementById('version-label');
        const version = release && (release.tag_name || release.name);
        if (label && version) label.textContent = 'Release ' + String(version).slice(0, 60);
      }).catch(() => {});
  }
  if (!configured && consent() === 'accepted') setStatus('idle', 'Analytics is not connected yet. Published GitHub release links remain available.');
})();
