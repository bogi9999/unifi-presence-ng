/* Unifi-Presence NG 4.3 – Weboberfläche (Vanilla JS, keine Build-Kette nötig) */
(function () {
  'use strict';

  var L = window.UPNG_L || {};
  var root = document.getElementById('upng');
  if (!root) return;
  var page = root.getAttribute('data-page');
  var lastStatus = null;

  /* ------------------------------------------------------------ Helfer */
  function t(key, fallback) { return L[key] || fallback || key; }
  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function api(action, data) {
    return fetch('ajax.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: action }, data || {}))
    }).then(function (r) {
      return r.text().then(function (txt) {
        try { return JSON.parse(txt); } catch (e) { return { ok: false, error: 'HTTP ' + r.status + ': ' + txt.slice(0, 200) }; }
      });
    }).catch(function (e) { return { ok: false, error: String(e) }; });
  }
  function msg(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.className = (el.tagName === 'SPAN' && el.parentNode && el.parentNode.id === 'saveBar') ? (kind || '') : 'u-msg' + (kind ? ' ' + kind : '');
  }
  function busy(btn, on) {
    if (!btn) return;
    btn.disabled = !!on;
    btn.classList.toggle('busy', !!on);
  }
  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem('upng.' + key));
      localStorage.setItem('upng.' + key, JSON.stringify(value));
    } catch (e) { return null; }
    return null;
  }
  function mqttName(name) {
    return String(name || '').replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '') || 'unbekannt';
  }
  function gwName(topic) { return String(topic || '').replace(/^\/+|\/+$/g, '').replace(/[\/%]/g, '_'); }
  function fmtAgo(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
    if (s < 60) return t('TIME.NOW');
    if (s < 3600) return Math.round(s / 60) + ' min';
    if (s < 86400) return Math.floor(s / 3600) + ' h ' + Math.round((s % 3600) / 60) + ' min';
    return Math.floor(s / 86400) + ' d ' + Math.floor((s % 86400) / 3600) + ' h';
  }
  function fmtClock(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var today = new Date();
    var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    if (d.toDateString() === today.toDateString()) return hm;
    return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '. ' + hm;
  }
  function fmtUptime(sec) {
    sec = parseInt(sec, 10);
    if (!sec || isNaN(sec)) return '';
    var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
    return (d ? d + ' d ' : '') + h + ' h';
  }
  function statusClass(s) {
    if (s === 'CONNECTED') return 'ok';
    if (s === 'CONNECTING' || s === 'STARTING' || s === 'DISCONNECTED') return 'warn';
    return 'bad';
  }
  function errorText(res) {
    if (!res) return t('COMMON.ERROR');
    if (res.code && L['STATUS.S_' + res.code] && res.code !== 'ERROR') return t('STATUS.S_' + res.code) + (res.error ? ' – ' + res.error : '');
    return res.error || t('COMMON.ERROR');
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignorieren */ }
    document.body.removeChild(ta);
    return Promise.resolve();
  }
  function download(filename, content, type) {
    var blob = new Blob([content], { type: type || 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  var ICON_WIFI = '<svg viewBox="0 0 24 24"><path d="M12 18h.01M9.2 15.2a4 4 0 0 1 5.6 0M6.3 12.3a8 8 0 0 1 11.4 0M3.5 9.4a12 12 0 0 1 17 0"/></svg>';
  var ICON_LAN = '<svg viewBox="0 0 24 24"><rect x="3" y="14" width="6" height="6" rx="1"/><rect x="15" y="14" width="6" height="6" rx="1"/><rect x="9" y="3" width="6" height="6" rx="1"/><path d="M6 14v-2h12v2M12 9v3"/></svg>';

  /* Umschalter-Leisten: Klick setzt das versteckte Feld */
  function initSegs() {
    Array.prototype.forEach.call(root.querySelectorAll('.u-seg'), function (seg) {
      var target = $(seg.getAttribute('data-target'));
      seg.addEventListener('click', function (ev) {
        var b = ev.target.closest('button');
        if (!b || !target) return;
        setSeg(target.id, b.getAttribute('data-value'));
        target.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  }
  function setSeg(id, value) {
    var input = $(id);
    if (!input) return;
    input.value = value;
    var seg = root.querySelector('.u-seg[data-target="' + id + '"]');
    if (seg) Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-value') === value);
    });
  }

  /* ------------------------------------------------------------ Hell / Dunkel */
  var THEMES = ['dark', 'light', 'auto'];
  var mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var painted = [];
  function themeMode() { var m = store('theme'); return THEMES.indexOf(m) === -1 ? 'dark' : m; }
  function applyTheme() {
    var mode = themeMode();
    var dark = mode === 'auto' ? !!(mql && mql.matches) : mode === 'dark';
    document.documentElement.setAttribute('data-upng-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-theme-mode', mode);
    var btn = $('btnTheme');
    if (btn) btn.title = t('THEME.' + mode.toUpperCase()) + ' – ' + t('THEME.SWITCH');
    // Hintergrund des LoxBerry-Inhaltsbereichs rund um das Plugin mitfaerben
    painted.forEach(function (p) { p.el.style.backgroundColor = p.orig; });
    painted = [];
    if (!dark) return;
    var page = getComputedStyle(root).getPropertyValue('--u-page').trim() || '#1c1d20';
    for (var el = root.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      var bg = getComputedStyle(el).backgroundColor;
      if (!bg || bg === 'transparent' || /rgba\(.*,\s*0\)$/.test(bg)) continue;
      painted.push({ el: el, orig: el.style.backgroundColor });
      el.style.backgroundColor = page;
    }
  }
  $('btnTheme').addEventListener('click', function () {
    store('theme', THEMES[(THEMES.indexOf(themeMode()) + 1) % THEMES.length]);
    applyTheme();
  });
  if (mql) {
    var onScheme = function () { if (themeMode() === 'auto') applyTheme(); };
    if (mql.addEventListener) mql.addEventListener('change', onScheme); else if (mql.addListener) mql.addListener(onScheme);
  }
  applyTheme();

  /* ------------------------------------------------------------ Kopfzeile */
  var statusListeners = [];
  function refreshHeader() {
    return api('status').then(function (res) {
      if (!res.ok) return;
      var s = res.status || {}, c = s.controller || {};
      lastStatus = s;
      $('hDot').className = 'u-dot ' + statusClass(s.status);
      $('hState').textContent = t('STATUS.S_' + s.status, s.status);
      var parts = [];
      if (c.host) parts.push((c.deviceType || (c.type === 'unifios' ? 'UniFi OS' : 'Network')) + (c.name ? ' ' + t('COMMON.Q_OPEN') + c.name + t('COMMON.Q_CLOSE') : ''));
      if (c.version) parts.push('Network ' + c.version);
      if (c.host) parts.push(c.host + ':' + c.port);
      $('hSub').textContent = parts.join(' · ') || ' ';
      var err = s.running ? (s.status !== 'CONNECTED' ? (s.error || '') : '') : t('STATUS.NOT_RUNNING');
      $('hError').textContent = err;
      var mq = $('hMqtt');
      mq.textContent = 'MQTT ' + (s.mqttBroker || '–');
      mq.className = 'u-badge ' + (s.running ? (s.mqtt ? 'ok' : 'bad') : '');
      mq.title = s.mqttSource === 'custom' ? t('SETTINGS.MQTT_CUSTOM') : 'LoxBerry';
      statusListeners.forEach(function (fn) { fn(s); });
    });
  }
  function checkUpdate() {
    api('update').then(function (res) {
      if (!res.ok) return;
      var el = $('hUpdate');
      var target = res.newRelease ? res.release : (res.newPrerelease ? res.prerelease : null);
      if (!target) return;
      el.textContent = (res.newRelease ? t('UPDATE.AVAILABLE') : t('UPDATE.PRE_AVAILABLE')) + ' ' + target.version;
      el.href = target.info || target.archive || '#';
      el.title = t('UPDATE.HINT');
      el.classList.remove('u-hidden');
    });
  }
  $('btnRestart').addEventListener('click', function () {
    var btn = this;
    busy(btn, true);
    $('hState').textContent = t('STATUS.RESTARTED');
    api('restart').then(function (res) {
      setTimeout(function () { busy(btn, false); refreshHeader(); }, 2500);
      if (!res.ok) $('hError').textContent = res.output || res.error;
    });
  });

  /* ------------------------------------------------------------ Einstellungen */
  function initSettings() {
    var form = $('settingsForm');
    var cfg = null, snapshot = '';
    var wt = $('wiredTimeout'), pi = $('pollInterval');

    function label(s) {
      if (s < 60) return s + ' ' + t('SETTINGS.SECONDS');
      return (s / 60) + ' ' + (s === 60 ? t('SETTINGS.MINUTE') : t('SETTINGS.MINUTES'));
    }
    [10, 20, 30, 45, 60, 90, 120, 180, 300, 600].forEach(function (s) { wt.add(new Option(label(s), s)); });
    [10, 15, 30, 60, 120, 300].forEach(function (s) { pi.add(new Option(label(s), s)); });
    function setSelect(sel, value) {
      var v = String(value);
      if (!Array.prototype.some.call(sel.options, function (o) { return o.value === v; })) sel.add(new Option(v, v));
      sel.value = v;
    }

    function collect() {
      return {
        ipaddress: $('ipaddress').value.trim(), port: $('port').value.trim(), controllerType: $('controllerType').value,
        username: $('username').value.trim(), password: $('password').value, site: $('site').value,
        topic: $('topic').value.trim(), summaryTopic: $('summaryTopic').value.trim(), retain: $('retain').checked,
        wiredTimeout: wt.value, pollInterval: pi.value, loglevel: $('loglevel').value, token: $('token').value.trim(),
        mqttMode: $('mqttMode').value, mqttHost: $('mqttHost').value.trim(), mqttPort: $('mqttPort').value.trim(),
        mqttUser: $('mqttUser').value.trim(), mqttPassword: $('mqttPassword').value,
        mqttClearPassword: $('mqttClearPassword').checked, mqttTls: $('mqttTls').checked
      };
    }
    function summaries(c) {
      var typ = { auto: t('SETTINGS.TYPE_AUTO_SHORT'), unifios: 'UniFi OS', classic: t('SETTINGS.TYPE_CLASSIC_SHORT') }[c.controllerType] || '';
      $('sumController').textContent = c.ipaddress ? [c.ipaddress + (c.port ? ':' + c.port : ''), c.username, typ, c.site].filter(Boolean).join(' · ') : t('SETTINGS.NOT_CONFIGURED');
      var m = c.mqtt || {};
      var broker = m.mode === 'custom' ? (m.host + ':' + m.port + (m.tls ? ' TLS' : '')) : 'LoxBerry';
      $('sumMqtt').textContent = [broker, c.topic, c.summaryTopic].filter(Boolean).join(' · ');
      $('sumDetect').textContent = t('SETTINGS.WIRED_SHORT') + ' ' + label(+c.wiredTimeout) + ' · ' + t('SETTINGS.POLL_SHORT') + ' ' + label(+c.pollInterval) + ' · Log ' + c.loglevel;
    }
    var lbInfo = '';
    function toggleMqtt() {
      var custom = $('mqttMode').value === 'custom';
      Array.prototype.forEach.call(form.querySelectorAll('.u-custom'), function (el) { el.classList.toggle('u-hidden', !custom); });
      $('mqttLbInfo').textContent = custom ? t('SETTINGS.MQTT_SUB_HINT') : lbInfo;
    }
    function fill(c) {
      cfg = c;
      $('ipaddress').value = c.ipaddress || '';
      $('port').value = c.port || '';
      setSeg('controllerType', c.controllerType || 'auto');
      $('username').value = c.username || '';
      $('password').value = '';
      $('password').placeholder = c.hasPassword ? t('SETTINGS.PASSWORD_KEEP') : '';
      setSelect($('site'), c.site || 'default');
      $('topic').value = c.topic || 'UniFi/clients';
      $('summaryTopic').value = c.summaryTopic === undefined ? 'UniFi/presence' : c.summaryTopic;
      $('retain').checked = !!c.retain;
      setSelect(wt, c.wiredTimeout || 60);
      setSelect(pi, c.pollInterval || 30);
      setSeg('loglevel', c.loglevel || 'info');
      var m = c.mqtt || {};
      setSeg('mqttMode', m.mode || 'loxberry');
      $('mqttHost').value = m.host || '';
      $('mqttPort').value = m.port || '';
      $('mqttUser').value = m.user || '';
      $('mqttPassword').value = '';
      $('mqttPassword').placeholder = m.hasPassword ? t('SETTINGS.PASSWORD_KEEP') : '';
      $('mqttClearPassword').checked = false;
      $('mqttClearRow').classList.toggle('u-hidden', !m.hasPassword);
      $('mqttTls').checked = !!m.tls;
      var lb = c.loxberryMqtt;
      lbInfo = lb ? t('SETTINGS.MQTT_LB_INFO') + ' ' + lb.host + ':' + lb.port + (lb.user ? ' (' + lb.user + ')' : '') : t('SETTINGS.MQTT_LB_NONE');
      toggleMqtt();
      summaries(c);
      snapshot = JSON.stringify(collect());
      updateDirty();
    }
    function updateDirty() {
      var dirty = JSON.stringify(collect()) !== snapshot;
      $('saveBar').classList.toggle('u-hidden', !dirty);
      if (dirty) msg($('saveMsg'), t('COMMON.UNSAVED'));
    }
    form.addEventListener('input', updateDirty);
    form.addEventListener('change', function (ev) {
      if (ev.target.id === 'mqttMode') toggleMqtt();
      if (ev.target.id === 'mqttTls') {
        var p = $('mqttPort');
        if (ev.target.checked && (p.value === '' || p.value === '1883')) p.value = 8883;
        if (!ev.target.checked && p.value === '8883') p.value = 1883;
      }
      if (ev.target.closest('#secBackup')) return;
      updateDirty();
    });
    ['backupPassword', 'restorePassword', 'backupFile'].forEach(function (id) {
      $(id).addEventListener('input', function (ev) { ev.stopPropagation(); });
    });

    function clearFieldErrors() {
      Array.prototype.forEach.call(root.querySelectorAll('.invalid'), function (el) { el.classList.remove('invalid'); });
    }
    function markFields(fields) {
      Object.keys(fields || {}).forEach(function (f) {
        if (!$(f)) return;
        $(f).classList.add('invalid');
        var sec = $(f).closest('details');
        if (sec) sec.open = true;
      });
    }
    function loadSites(silent) {
      var btn = $('btnSites');
      busy(btn, true);
      return api('sites').then(function (res) {
        busy(btn, false);
        if (!res.ok) { if (!silent) msg($('detectMsg'), errorText(res), 'bad'); return; }
        var sel = $('site'), cur = sel.value;
        sel.innerHTML = '';
        res.sites.forEach(function (s) { sel.add(new Option(s.label + (s.label !== s.value ? ' (' + s.value + ')' : ''), s.value)); });
        setSelect(sel, cur || 'default');
        updateDirty();
      });
    }

    api('getconfig').then(function (res) {
      if (!res.ok) { $('hError').textContent = errorText(res); return; }
      fill(res.config);
      var configured = res.config.ipaddress && res.config.hasPassword;
      if (!configured) { $('secController').open = true; $('secMqtt').open = true; }
      if (configured) loadSites(true);
    });

    $('btnDetect').addEventListener('click', function () {
      var btn = this;
      busy(btn, true);
      msg($('detectMsg'), t('SETTINGS.DETECTING'));
      api('detect', { ipaddress: $('ipaddress').value, port: $('port').value }).then(function (res) {
        busy(btn, false);
        if (!res.ok) { msg($('detectMsg'), errorText(res), 'bad'); return; }
        var c = res.controller;
        msg($('detectMsg'), t('SETTINGS.DETECTED') + ': ' + (c.type === 'unifios' ? 'UniFi OS' : t('SETTINGS.TYPE_CLASSIC_SHORT')) + ', Port ' + c.port, 'ok');
      });
    });
    $('btnSites').addEventListener('click', function () { loadSites(false); });
    $('btnMqtt').addEventListener('click', function () {
      var btn = this, d = collect();
      busy(btn, true);
      clearFieldErrors();
      api('mqtttest', d).then(function (res) {
        busy(btn, false);
        markFields(res.fields);
        msg($('mqttMsg'), res.ok ? t('SETTINGS.MQTT_OK') + ' ' + res.broker : errorText(res), res.ok ? 'ok' : 'bad');
      });
    });
    $('btnDiscard').addEventListener('click', function () { if (cfg) fill(cfg); clearFieldErrors(); });
    $('btnSave').addEventListener('click', function () {
      var btn = this, d = collect();
      clearFieldErrors();
      d.forceLogin = !!d.token || !lastStatus || lastStatus.status !== 'CONNECTED';
      busy(btn, true);
      msg($('saveMsg'), t('COMMON.SAVING'));
      api('saveconfig', d).then(function (res) {
        busy(btn, false);
        if (!res.ok) { markFields(res.fields); msg($('saveMsg'), errorText(res), 'bad'); return; }
        var login = res.login;
        fill(res.config);
        if (login && !login.ok) {
          $('saveBar').classList.remove('u-hidden');
          if (login.code === 'TWO_FA_REQUIRED') { $('tokenRow').classList.remove('u-hidden'); $('secController').open = true; $('token').focus(); }
          msg($('saveMsg'), errorText(login), 'bad');
          return;
        }
        $('tokenRow').classList.add('u-hidden');
        $('token').value = '';
        if (login && login.ok) loadSites(true);
        setTimeout(refreshHeader, 2500);
      });
    });

    /* Sicherung */
    $('btnBackup').addEventListener('click', function () {
      var btn = this;
      clearFieldErrors();
      busy(btn, true);
      api('backup', { password: $('backupPassword').value }).then(function (res) {
        busy(btn, false);
        if (!res.ok) { markFields(res.fields); msg($('backupMsg'), errorText(res), 'bad'); return; }
        download(res.filename, JSON.stringify(res.backup, null, 2), 'application/json');
        $('backupPassword').value = '';
        msg($('backupMsg'), t('BACKUP.DONE'), 'ok');
      });
    });
    var restoreText = null;
    $('backupFile').addEventListener('change', function () {
      restoreText = null;
      $('btnRestoreApply').classList.add('u-hidden');
      $('restorePreview').classList.add('u-hidden');
      var f = this.files && this.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { restoreText = String(r.result); };
      r.readAsText(f);
    });
    function restore(apply) {
      clearFieldErrors();
      if (!restoreText) { markFields({ backupFile: 1 }); msg($('restoreMsg'), t('BACKUP.NO_FILE'), 'bad'); return; }
      var btn = apply ? $('btnRestoreApply') : $('btnRestoreCheck');
      busy(btn, true);
      api('restore', { file: restoreText, password: $('restorePassword').value, apply: apply }).then(function (res) {
        busy(btn, false);
        if (!res.ok) { markFields(res.fields); msg($('restoreMsg'), errorText(res), 'bad'); return; }
        var p = res.preview;
        $('restorePreview').innerHTML =
          '<b>' + esc(t('BACKUP.FROM')) + '</b> ' + esc(p.created ? fmtClock(p.created) : '–') + ' (' + esc(p.plugin || '?') + ')<br>' +
          '<b>Controller</b> ' + esc(p.ipaddress) + ' · ' + esc(p.username) + '<br>' +
          '<b>MQTT</b> ' + esc(p.mqtt) + ' · ' + esc(p.topic) + '<br>' +
          '<b>' + esc(t('NAV.CLIENTS')) + '</b> ' + esc(p.clients);
        $('restorePreview').classList.remove('u-hidden');
        if (apply) {
          msg($('restoreMsg'), t('BACKUP.APPLIED'), 'ok');
          $('btnRestoreApply').classList.add('u-hidden');
          $('restorePassword').value = '';
          setTimeout(function () { api('getconfig').then(function (r) { if (r.ok) fill(r.config); }); refreshHeader(); }, 3000);
        } else {
          msg($('restoreMsg'), t('BACKUP.CHECKED'), 'ok');
          $('btnRestoreApply').classList.remove('u-hidden');
        }
      });
    }
    $('btnRestoreCheck').addEventListener('click', function () { restore(false); });
    $('btnRestoreApply').addEventListener('click', function () { restore(true); });

    /* Kennzahlen und Anwesenheit aus dem Status */
    statusListeners.push(function (s) {
      var st = s.stats || {}, sum = s.summary;
      $('kActive').textContent = s.activeClients !== undefined && s.activeClients !== null ? s.activeClients : '–';
      $('kActiveSub').textContent = st.isp ? st.isp + (st.uptime ? ' · ' + fmtUptime(st.uptime) : '') : ' ';
      $('kPresent').textContent = sum ? sum.count + ' / ' + sum.total : '–';
      $('kPresentSub').textContent = sum ? (sum.present || t('STATUS.NOBODY')) : ' ';
      [['kCpu', 'kCpuBar', st.cpu], ['kMem', 'kMemBar', st.mem]].forEach(function (x) {
        var v = parseFloat(x[2]);
        $(x[0]).textContent = isNaN(v) ? '–' : Math.round(v) + ' %';
        var bar = $(x[1]);
        bar.style.width = isNaN(v) ? '0' : Math.min(100, v) + '%';
        bar.className = v >= 90 ? 'bad' : (v >= 75 ? 'warn' : '');
      });
      var clients = s.clients || {};
      var list = Object.keys(clients).map(function (k) { return clients[k]; });
      list.sort(function (a, b) { return (b.connected - a.connected) || String(a.name).localeCompare(String(b.name)); });
      var box = $('presence');
      if (!list.length) { box.innerHTML = '<div class="u-empty">' + esc(t('STATUS.NO_WATCHED')) + '</div>'; return; }
      box.innerHTML = list.map(function (c) {
        var when = c.since ? (c.connected ? t('TIME.SINCE') + ' ' + fmtClock(c.since) : t('TIME.AWAY') + ' ' + fmtAgo(c.since)) : '';
        return '<div class="u-person ' + (c.connected ? 'on' : 'off') + '" title="' + esc(c.topic) + '">' +
          '<span class="d"></span><span class="n">' + esc(c.name) + '</span><span class="t">' + esc(when) + '</span></div>';
      }).join('');
    });
  }

  /* ------------------------------------------------------------ Geräte */
  function initClients() {
    var clients = [], live = {}, sortKey = 'watched', sortDir = 1, saveTimer = null;

    function defaultPerson(c) { return c.type !== 'WIRED'; }
    function isPerson(c) { return c.person === undefined || c.person === null ? defaultPerson(c) : !!c.person; }
    function watchedList() {
      return clients.filter(function (c) { return c.watched; }).map(function (c) {
        var e = { mac: c.mac, name: c.name, type: c.type, alias: c.alias || '', system: c.system || '', userId: c.userId || '', group: c.group || '' };
        if (c.person !== undefined && c.person !== null) e.person = !!c.person;
        return e;
      });
    }
    function scheduleSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        api('setclients', { clients: watchedList() }).then(function (res) {
          msg($('clientsMsg'), res.ok ? t('CLIENTS.SAVED') : errorText(res), res.ok ? 'ok' : 'bad');
          setTimeout(function () { msg($('clientsMsg'), ''); }, 3000);
          updateGroups();
        });
      }, 400);
    }
    function updateGroups() {
      var set = {};
      clients.forEach(function (c) { String(c.group || '').split(',').forEach(function (g) { g = g.trim(); if (g) set[g] = 1; }); });
      $('groupList').innerHTML = Object.keys(set).sort().map(function (g) { return '<option value="' + esc(g) + '">'; }).join('');
    }
    function bars(p) {
      if (!p) return '';
      var n = p > 75 ? 4 : p > 50 ? 3 : p > 25 ? 2 : 1, h = '<span class="u-bars" title="' + p + ' %">';
      for (var i = 1; i <= 4; i++) h += '<i class="' + (i <= n ? 'on' : '') + '" style="height:' + (i * 3 + 1) + 'px"></i>';
      return h + '</span>';
    }
    function sw(cls, mac, checked) {
      return '<label class="u-switch"><input type="checkbox" class="' + cls + '" data-mac="' + esc(mac) + '" data-role="none"' + (checked ? ' checked' : '') + '><span></span></label>';
    }
    function render() {
      var q = $('search').value.trim().toLowerCase();
      var fw = $('fWifi').checked, fl = $('fWired').checked, fo = $('fOffline').checked, fwa = $('fWatched').checked;
      var list = clients.filter(function (c) {
        if (c.type === 'WIRELESS' && !fw) return false;
        if (c.type === 'WIRED' && !fl) return false;
        if (!c.online && !fo && !c.watched) return false;
        if (fwa && !c.watched) return false;
        if (q && [c.name, c.alias, c.mac, c.ip, c.ssid, c.ap, c.system, c.group].join(' ').toLowerCase().indexOf(q) === -1) return false;
        return true;
      });
      list.sort(function (a, b) {
        if (sortKey === 'watched') {
          if (!!a.watched !== !!b.watched) return a.watched ? -1 : 1;
          if (!!a.online !== !!b.online) return a.online ? -1 : 1;
          return String(a.name).localeCompare(String(b.name));
        }
        var x = a[sortKey], y = b[sortKey];
        if (x === undefined || x === null) x = '';
        if (y === undefined || y === null) y = '';
        return String(x).localeCompare(String(y), undefined, { numeric: true }) * sortDir;
      });
      var tbody = $('clientsTable').querySelector('tbody');
      if (!list.length) { tbody.innerHTML = '<tr><td colspan="8" class="u-empty">' + esc(t('CLIENTS.EMPTY')) + '</td></tr>'; return; }
      tbody.innerHTML = list.map(function (c) {
        var lv = live[c.mac], state = '';
        if (c.watched) state = lv ? '<span class="u-pill ' + (lv.connected ? 'ok' : 'bad') + '">' + esc(lv.connected ? t('CLIENTS.ONLINE') : t('CLIENTS.OFFLINE')) + '</span>' : '<span class="u-pill">–</span>';
        var net = c.type === 'WIRED' ? '<span class="u-net">' + ICON_LAN + 'LAN</span>'
          : '<span class="u-net">' + ICON_WIFI + (c.online ? esc(c.ssid || t('CLIENTS.SHOW_WIFI')) + ' ' + bars(c.signalPercentage) : esc(t('CLIENTS.OFFLINE'))) + '</span>' +
            (c.online && c.ap ? '<div class="sub">' + esc(c.ap) + '</div>' : '');
        return '<tr class="' + (c.watched ? 'watched' : '') + (c.online ? '' : ' offline') + '">' +
          '<td>' + sw('w', c.mac, c.watched) + '</td>' +
          '<td><b>' + esc(c.name) + '</b>' + (c.system ? '<div class="sub">' + esc(c.system) + '</div>' : '') +
            (c.missing ? '<div class="sub warn">' + esc(t('CLIENTS.NOT_IN_LIST')) + '</div>' : '') + '</td>' +
          '<td>' + (c.watched ? '<input type="text" class="alias" data-mac="' + esc(c.mac) + '" value="' + esc(c.alias || '') + '" placeholder="' + esc(mqttName(c.name)) + '" data-role="none">' : '') + '</td>' +
          '<td>' + (c.watched ? sw('person', c.mac, isPerson(c)) : '') + '</td>' +
          '<td>' + (c.watched ? '<input type="text" class="group" list="groupList" data-mac="' + esc(c.mac) + '" value="' + esc(c.group || '') + '" placeholder="–" data-role="none">' : '') + '</td>' +
          '<td>' + net + '</td>' +
          '<td><span class="u-mono">' + esc(c.mac) + '</span>' + (c.online && c.ip ? '<div class="sub u-mono">' + esc(c.ip) + '</div>' : '') + '</td>' +
          '<td>' + state + '</td></tr>';
      }).join('');
    }
    function byMac(mac) {
      for (var i = 0; i < clients.length; i++) if (clients[i].mac === mac) return clients[i];
      return null;
    }
    $('clientsTable').addEventListener('change', function (ev) {
      var el = ev.target, c = byMac(el.getAttribute('data-mac'));
      if (!c) return;
      if (el.classList.contains('w')) { c.watched = el.checked; render(); }
      else if (el.classList.contains('person')) c.person = el.checked;
      else if (el.classList.contains('alias')) c.alias = el.value.trim();
      else if (el.classList.contains('group')) c.group = el.value.trim();
      else return;
      scheduleSave();
    });
    Array.prototype.forEach.call($('clientsTable').querySelectorAll('th[data-sort]'), function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
        render();
      });
    });
    ['search', 'fWifi', 'fWired', 'fOffline', 'fWatched'].forEach(function (id) {
      $(id).addEventListener('input', render);
      $(id).addEventListener('change', render);
    });
    function load() {
      var btn = $('btnReload');
      busy(btn, true);
      msg($('clientsMsg'), t('COMMON.LOADING'));
      return Promise.all([api('clients'), api('getconfig')]).then(function (r) {
        var res = r[0], cfgRes = r[1];
        busy(btn, false);
        msg($('clientsMsg'), '');
        $('clientsError').textContent = res.ok ? '' : errorText(res);
        var watched = {};
        if (cfgRes.ok) cfgRes.config.clients.forEach(function (w) { watched[w.mac.toLowerCase()] = w; });
        clients = (res.clients || []).map(function (c) {
          var w = watched[c.mac];
          if (w) { c.person = w.person; c.group = w.group || ''; }
          return c;
        });
        $('androidHint').classList.toggle('u-hidden', !clients.some(function (c) { return /google|samsung|xiaomi|oneplus|huawei/i.test(c.system || ''); }));
        updateGroups();
        render();
      });
    }
    statusListeners.push(function (s) {
      live = s.clients || {};
      var a = document.activeElement;
      if (a && a.tagName === 'INPUT' && a.closest('#clientsTable')) return;
      render();
    });
    $('btnReload').addEventListener('click', load);
    $('btnManual').addEventListener('click', function () {
      var hex = $('mMac').value.replace(/[^0-9a-f]/gi, '').toLowerCase();
      if (hex.length !== 12) { msg($('clientsMsg'), t('CLIENTS.INVALID_MAC'), 'bad'); $('mMac').classList.add('invalid'); return; }
      $('mMac').classList.remove('invalid');
      var mac = hex.match(/.{2}/g).join(':'), c = byMac(mac);
      if (!c) { c = { mac: mac, name: $('mName').value.trim() || mac, type: $('mType').value, online: false, missing: true }; clients.push(c); }
      c.watched = true;
      $('mMac').value = ''; $('mName').value = '';
      scheduleSave();
      render();
    });
    load();
  }

  /* ------------------------------------------------------------ Loxone */
  function initLoxone() {
    var cfg = null, rows = [];
    var saved = store('loxone') || {};
    setSeg('lxTransport', saved.transport || 'http');
    if (saved.port) $('lxPort').value = saved.port;
    if (saved.values) Array.prototype.forEach.call(root.querySelectorAll('.lxv'), function (cb) { cb.checked = saved.values.indexOf(cb.value) !== -1; });

    function persist() {
      store('loxone', {
        transport: $('lxTransport').value, port: $('lxPort').value,
        values: Array.prototype.filter.call(root.querySelectorAll('.lxv'), function (cb) { return cb.checked; }).map(function (cb) { return cb.value; })
      });
    }
    function chosen(v) { var cb = root.querySelector('.lxv[value="' + v + '"]'); return cb && cb.checked; }
    function isUdp() { return $('lxTransport').value === 'udp'; }
    /* HTTP: Name des virtuellen Eingangs (Topic + JSON-Feld, "/" und "%" -> "_")
       UDP:  Befehlserkennung wie im MQTT Gateway: MQTT:\i<Topic>/<JSON-Feld>=\i\v */
    function httpName(r) { return gwName(r.topic + '/' + r.key); }
    function udpCheck(r) { return 'MQTT:\\i' + r.topic.replace(/^\/+|\/+$/g, '') + '/' + r.key + '=\\i\\v'; }
    function rowText(r) { return isUdp() ? udpCheck(r) : httpName(r); }
    function usable(r) { return !(isUdp() && r.kind === 'text'); }
    function num(v) { return v === null || v === undefined ? null : v; }
    function bool(v) { return v === null || v === undefined ? null : (v ? 1 : 0); }
    function buildRows(s) {
      rows = [];
      if (!cfg) return;
      var base = (cfg.topic || 'UniFi/clients').replace(/^\/+|\/+$/g, '');
      var live = (s && s.clients) || {};
      cfg.clients.forEach(function (c) {
        var label = (c.alias || '').trim() || c.name;
        var lv = live[c.mac.toLowerCase()] || {};
        var topic = lv.topic || base + '/' + mqttName(label);
        var wifi = c.type !== 'WIRED';
        function add(v, key, kind, value) { if (chosen(v)) rows.push({ label: label + ' – ' + t('LOXONE.V_' + v.toUpperCase()), topic: topic, key: key, kind: kind, value: value }); }
        add('connected', 'connected', 'digital', bool(lv.connected));
        if (wifi) {
          add('signalPercentage', 'signalPercentage', 'analog', num(lv.signalPercentage));
          add('signalDbm', 'signalDbm', 'analog', num(lv.signalDbm));
          add('experience', 'experience', 'analog', num(lv.experience));
          add('ap', 'ap_name', 'text', lv.ap ? lv.ap.name : null);
          add('ssid', 'ssid', 'text', num(lv.ssid));
        }
        add('ip', 'ip', 'text', num(lv.ip));
      });
      var stopic = (cfg.summaryTopic || '').trim().replace(/^\/+|\/+$/g, '');
      var sum = s && s.summary;
      if (stopic) {
        if (chosen('summary')) {
          rows.push({ label: t('LOXONE.ANYONE'), topic: stopic, key: 'anyone', kind: 'digital', value: sum ? bool(sum.anyone) : null });
          rows.push({ label: t('LOXONE.COUNT'), topic: stopic, key: 'count', kind: 'analog', value: sum ? sum.count : null });
          rows.push({ label: t('LOXONE.TOTAL'), topic: stopic, key: 'total', kind: 'analog', value: sum ? sum.total : null });
        }
        if (chosen('present')) rows.push({ label: t('LOXONE.V_PRESENT'), topic: stopic, key: 'present', kind: 'text', value: sum ? sum.present : null });
        if (chosen('groups') && sum && sum.groups) Object.keys(sum.groups).forEach(function (k) {
          var g = sum.groups[k];
          rows.push({ label: t('LOXONE.GROUP') + ' ' + g.name + ' – ' + t('LOXONE.ANYONE_SHORT'), topic: stopic, key: 'groups_' + k + '_anyone', kind: 'digital', value: bool(g.anyone) });
          rows.push({ label: t('LOXONE.GROUP') + ' ' + g.name + ' – ' + t('LOXONE.COUNT_SHORT'), topic: stopic, key: 'groups_' + k + '_count', kind: 'analog', value: g.count });
          if (chosen('present')) rows.push({ label: t('LOXONE.GROUP') + ' ' + g.name + ' – ' + t('LOXONE.V_PRESENT'), topic: stopic, key: 'groups_' + k + '_present', kind: 'text', value: g.present });
        });
      }
    }
    function kindText(r) {
      if (r.kind === 'text') return isUdp() ? t('LOXONE.TEXT_HTTP_ONLY') : t('LOXONE.TEXT');
      return r.kind === 'analog' ? t('LOXONE.ANALOG') : t('LOXONE.DIGITAL');
    }
    function render(s) {
      buildRows(s);
      var udp = isUdp();
      $('lxPortRow').classList.toggle('u-hidden', !udp);
      $('btnTemplate').classList.toggle('u-hidden', !udp);
      $('lxTransportHint').textContent = udp ? t('LOXONE.HINT_UDP') : t('LOXONE.HINT_HTTP');
      var tb = $('lxTable').querySelector('tbody');
      if (!rows.length) { tb.innerHTML = '<tr><td colspan="4" class="u-empty">' + esc(t('LOXONE.NO_ROWS')) + '</td></tr>'; }
      else tb.innerHTML = rows.map(function (r, i) {
        var ok = usable(r);
        return '<tr class="' + (ok ? '' : 'offline') + '"><td>' + esc(r.label) + '</td><td>' +
          (ok ? '<span class="u-copy"><span class="u-mono">' + esc(rowText(r)) + '</span>' +
            '<button type="button" data-copy="' + i + '" data-role="none">' + esc(t('LOXONE.COPY')) + '</button></span>'
            : '<span class="u-mono u-muted">' + esc(httpName(r)) + '</span>') + '</td>' +
          '<td>' + esc(kindText(r)) + '</td>' +
          '<td class="u-mono">' + esc(r.value === null || r.value === undefined || r.value === '' ? '–' : r.value) + '</td></tr>';
      }).join('');
      var sum = s && s.summary;
      $('lxSummaryTopic').textContent = cfg && cfg.summaryTopic ? cfg.summaryTopic : t('LOXONE.SUMMARY_OFF');
      $('lxSummary').innerHTML = sum ?
        '<div class="u-kpi"><small>' + esc(t('LOXONE.ANYONE')) + '</small><b>' + esc(sum.anyone ? t('COMMON.OPT_YES') : t('COMMON.OPT_NO')) + '</b><span>' + esc(sum.since ? t('TIME.SINCE') + ' ' + fmtClock(sum.since) : ' ') + '</span></div>' +
        '<div class="u-kpi"><small>' + esc(t('LOXONE.COUNT')) + '</small><b>' + sum.count + ' / ' + sum.total + '</b><span>' + esc(sum.present || t('STATUS.NOBODY')) + '</span></div>' : '';
      var groups = sum && sum.groups ? Object.keys(sum.groups).map(function (k) { return sum.groups[k]; }) : [];
      $('lxGroups').innerHTML = groups.length ? groups.map(function (g) {
        return '<div class="u-person ' + (g.anyone ? 'on' : 'off') + '"><span class="d"></span><span class="n">' + esc(g.name) + '</span><span class="t">' + g.count + ' / ' + g.total + '</span></div>';
      }).join('') : '<div class="u-empty">' + esc(t('LOXONE.NO_GROUPS')) + '</div>';
    }
    function xmlEsc(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function template() {
      var port = parseInt($('lxPort').value, 10) || 11883;
      var x = '<?xml version="1.0" encoding="utf-8"?>\n<VirtualInUdp Title="Unifi-Presence NG" Comment="LoxBerry MQTT Gateway (UDP)" Address="" Port="' + port + '">\n';
      rows.filter(usable).forEach(function (r) {
        x += '\t<VirtualInUdpCmd Title="' + xmlEsc(r.label) + '" Comment="' + xmlEsc(r.topic + '/' + r.key) + '" Address="" Check="' + xmlEsc(udpCheck(r)) +
          '" Signed="true" Analog="' + (r.kind === 'analog' ? 'true' : 'false') + '" SourceValLow="0" DestValLow="0" SourceValHigh="100" DestValHigh="100" DefVal="0" MinVal="-2147483648" MaxVal="2147483647"/>\n';
      });
      return x + '</VirtualInUdp>\n';
    }
    root.addEventListener('change', function (ev) {
      if (ev.target.id === 'lxTransport' || ev.target.id === 'lxPort' || ev.target.classList.contains('lxv')) { persist(); render(lastStatus); }
    });
    $('lxTable').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-copy]');
      if (!b) return;
      copyText(rowText(rows[+b.getAttribute('data-copy')])).then(function () { b.textContent = t('LOXONE.COPIED'); setTimeout(function () { b.textContent = t('LOXONE.COPY'); }, 1500); });
    });
    $('btnCopyAll').addEventListener('click', function () {
      copyText(rows.filter(usable).map(rowText).join('\n')).then(function () { msg($('lxMsg'), t('LOXONE.COPIED_ALL'), 'ok'); });
    });
    $('btnTemplate').addEventListener('click', function () {
      download('VIU_Unifi-Presence-NG.xml', template(), 'application/xml');
      msg($('lxMsg'), t('LOXONE.TEMPLATE_DONE'), 'ok');
    });
    api('getconfig').then(function (res) {
      if (res.ok) cfg = res.config;
      render(lastStatus);
    });
    statusListeners.push(function (s) { if (cfg) render(s); });
  }

  /* ------------------------------------------------------------ Log */
  function initLog() {
    function load() {
      api('log').then(function (res) {
        var view = $('logView');
        var atBottom = view.scrollTop + view.clientHeight >= view.scrollHeight - 20;
        view.innerHTML = (res.lines || []).map(function (l) {
          var cls = /<(ERROR|CRITICAL)>/.test(l) ? 'bad' : /<WARNING>/.test(l) ? 'warn' : '';
          return '<span class="' + cls + '">' + esc(l) + '</span>';
        }).join('\n');
        $('logFile').textContent = res.file || '';
        if (atBottom) view.scrollTop = view.scrollHeight;
      });
    }
    $('btnLog').addEventListener('click', load);
    load();
    setInterval(load, 10000);
  }

  initSegs();
  if (page === 'settings') initSettings();
  else if (page === 'clients') initClients();
  else if (page === 'loxone') initLoxone();
  else initLog();
  refreshHeader();
  setInterval(refreshHeader, 5000);
  checkUpdate();
})();
