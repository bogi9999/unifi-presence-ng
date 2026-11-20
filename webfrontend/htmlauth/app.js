/* Unifi-PresenceNG – Weboberfläche (Vanilla JS, keine Build-Kette nötig) */
(function () {
  'use strict';

  var L = window.UPNG_L || {};
  var root = document.getElementById('upng');
  if (!root) return;
  var page = root.getAttribute('data-page');

  function t(key, fallback) { return L[key] || fallback || key; }
  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function api(action, data) {
    var body = Object.assign({ action: action }, data || {});
    return fetch('ajax.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.text().then(function (txt) {
        var json;
        try { json = JSON.parse(txt); } catch (e) { json = { ok: false, error: 'HTTP ' + r.status + ': ' + txt.slice(0, 200) }; }
        return json;
      });
    }).catch(function (e) { return { ok: false, error: String(e) }; });
  }
  function msg(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'upng-msg' + (kind ? ' ' + kind : '');
  }
  function busy(btn, on) {
    if (!btn) return;
    btn.disabled = !!on;
    btn.classList.toggle('busy', !!on);
  }
  function fmtUptime(sec) {
    sec = parseInt(sec, 10);
    if (!sec || isNaN(sec)) return '–';
    var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return (d ? d + ' d ' : '') + h + ' h ' + m + ' min';
  }
  function statusText(s) { return t('STATUS.S_' + s, s); }
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

  function label(s) {
    if (s < 60) return s + ' ' + t('SETTINGS.SECONDS');
    return (s / 60) + ' ' + (s === 60 ? t('SETTINGS.MINUTE') : t('SETTINGS.MINUTES'));
  }

  /* ------------------------------------------------------------ Einstellungen */
  function initSettings() {
    var form = $('settingsForm');
    var wt = $('wiredTimeout'), pi = $('pollInterval');
    [10, 20, 30, 45, 60, 90, 120, 180, 300, 600].forEach(function (s) {
      var o = document.createElement('option');
      o.value = s;
      o.textContent = label(s);
      wt.appendChild(o);
    });
    [10, 15, 30, 60, 120, 300].forEach(function (s) {
      var o = document.createElement('option');
      o.value = s;
      o.textContent = label(s);
      pi.appendChild(o);
    });

    function setSelect(sel, value) {
      var v = String(value);
      var found = Array.prototype.some.call(sel.options, function (o) { return o.value === v; });
      if (!found) {
        var o = document.createElement('option');
        o.value = v; o.textContent = v;
        sel.appendChild(o);
      }
      sel.value = v;
    }

    function fill(cfg) {
      $('ipaddress').value = cfg.ipaddress || '';
      $('port').value = cfg.port || '';
      $('controllerType').value = cfg.controllerType || 'auto';
      $('username').value = cfg.username || '';
      $('password').value = '';
      $('password').placeholder = cfg.hasPassword ? t('SETTINGS.PASSWORD_KEEP') : '';
      setSelect($('site'), cfg.site || 'default');
      $('topic').value = cfg.topic || 'UniFi/clients';
      $('retain').checked = !!cfg.retain;
      setSelect(wt, cfg.wiredTimeout || 60);
      setSelect(pi, cfg.pollInterval || 30);
      $('loglevel').value = cfg.loglevel || 'info';
      var m = cfg.mqtt || {};
      $('mqttMode').value = m.mode || 'loxberry';
      $('mqttHost').value = m.host || '';
      $('mqttPort').value = m.port || '';
      $('mqttUser').value = m.user || '';
      $('mqttPassword').value = '';
      $('mqttPassword').placeholder = m.hasPassword ? t('SETTINGS.PASSWORD_KEEP') : '';
      $('mqttClearPassword').checked = false;
      $('mqttClearRow').classList.toggle('upng-hidden', !m.hasPassword);
      $('mqttTls').checked = !!m.tls;
      var lb = cfg.loxberryMqtt;
      lbInfo = lb ? t('SETTINGS.MQTT_LB_INFO') + ' ' + lb.host + ':' + lb.port + (lb.user ? ' (' + lb.user + ')' : '') : t('SETTINGS.MQTT_LB_NONE');
      toggleMqtt();
    }

    var lbInfo = '';
    function toggleMqtt() {
      var custom = $('mqttMode').value === 'custom';
      $('mqttCustom').classList.toggle('upng-hidden', !custom);
      $('mqttLbInfo').textContent = custom ? t('SETTINGS.MQTT_SUB_HINT') : lbInfo;
    }
    $('mqttMode').addEventListener('change', toggleMqtt);
    $('mqttTls').addEventListener('change', function () {
      var p = $('mqttPort');
      if (this.checked && (p.value === '' || p.value === '1883')) p.value = 8883;
      if (!this.checked && p.value === '8883') p.value = 1883;
    });
    function mqttData() {
      return {
        mqttMode: $('mqttMode').value,
        mqttHost: $('mqttHost').value.trim(),
        mqttPort: $('mqttPort').value.trim(),
        mqttUser: $('mqttUser').value.trim(),
        mqttPassword: $('mqttPassword').value,
        mqttClearPassword: $('mqttClearPassword').checked,
        mqttTls: $('mqttTls').checked
      };
    }

    function clearFieldErrors() {
      Array.prototype.forEach.call(form.querySelectorAll('.invalid'), function (el) { el.classList.remove('invalid'); });
    }

    function loadSites(silent) {
      var btn = $('btnSites');
      busy(btn, true);
      return api('sites').then(function (res) {
        busy(btn, false);
        if (!res.ok) { if (!silent) msg($('saveMsg'), errorText(res), 'bad'); return; }
        var sel = $('site'), cur = sel.value;
        sel.innerHTML = '';
        res.sites.forEach(function (s) {
          var o = document.createElement('option');
          o.value = s.value; o.textContent = s.label + (s.label !== s.value ? ' (' + s.value + ')' : '');
          sel.appendChild(o);
        });
        setSelect(sel, cur || 'default');
      });
    }

    api('getconfig').then(function (res) {
      if (res.ok) {
        fill(res.config);
        if (res.config.ipaddress && res.config.hasPassword) loadSites(true);
      }
    });

    $('btnDetect').addEventListener('click', function () {
      var btn = this;
      busy(btn, true);
      msg($('detectMsg'), t('SETTINGS.DETECTING'));
      api('detect', { ipaddress: $('ipaddress').value, port: $('port').value }).then(function (res) {
        busy(btn, false);
        if (res.ok) {
          var c = res.controller;
          msg($('detectMsg'), t('SETTINGS.DETECTED') + ': ' + (c.type === 'unifios' ? 'UniFi OS' : t('SETTINGS.TYPE_CLASSIC')) + ', Port ' + c.port, 'ok');
        } else {
          msg($('detectMsg'), errorText(res), 'bad');
        }
      });
    });

    $('btnSites').addEventListener('click', function () { loadSites(false); });

    $('btnMqtt').addEventListener('click', function () {
      var btn = this;
      busy(btn, true);
      clearFieldErrors();
      api('mqtttest', mqttData()).then(function (res) {
        busy(btn, false);
        if (res.fields) Object.keys(res.fields).forEach(function (f) { if ($(f)) $(f).classList.add('invalid'); });
        msg($('mqttMsg'), res.ok ? 'OK (' + res.broker + ')' : errorText(res), res.ok ? 'ok' : 'bad');
      });
    });

    $('btnSave').addEventListener('click', function () {
      var btn = this;
      clearFieldErrors();
      var data = {
        ipaddress: $('ipaddress').value.trim(),
        port: $('port').value.trim(),
        controllerType: $('controllerType').value,
        username: $('username').value.trim(),
        password: $('password').value,
        site: $('site').value,
        topic: $('topic').value.trim(),
        retain: $('retain').checked,
        wiredTimeout: wt.value,
        pollInterval: pi.value,
        loglevel: $('loglevel').value,
        token: $('token').value.trim(),
        forceLogin: true
      };
      Object.assign(data, mqttData());
      busy(btn, true);
      msg($('saveMsg'), t('COMMON.SAVING'));
      api('saveconfig', data).then(function (res) {
        busy(btn, false);
        if (!res.ok) {
          if (res.fields) Object.keys(res.fields).forEach(function (f) { if ($(f)) $(f).classList.add('invalid'); });
          msg($('saveMsg'), errorText(res), 'bad');
          return;
        }
        fill(res.config);
        var login = res.login;
        if (!login) { msg($('saveMsg'), t('COMMON.SAVED'), 'ok'); return; }
        if (login.ok) {
          $('tokenRow').classList.add('upng-hidden');
          $('token').value = '';
          var si = login.sysinfo || {}, c = login.controller || {};
          msg($('saveMsg'), t('SETTINGS.LOGIN_OK') + ' – ' + (c.type === 'unifios' ? 'UniFi OS' : 'Classic') +
            ', Port ' + c.port + ', Network ' + (si.version || '?'), 'ok');
          loadSites(true);
          setTimeout(refreshStatus, 2500);
        } else {
          if (login.code === 'TWO_FA_REQUIRED') {
            $('tokenRow').classList.remove('upng-hidden');
            $('token').focus();
          }
          msg($('saveMsg'), errorText(login), 'bad');
        }
      });
    });

    $('btnRestart').addEventListener('click', function () {
      var btn = this;
      busy(btn, true);
      msg($('stError'), t('STATUS.RESTARTED'));
      api('restart').then(function (res) {
        busy(btn, false);
        if (!res.ok) msg($('stError'), res.output || res.error, 'bad');
        setTimeout(refreshStatus, 3000);
      });
    });

    function refreshStatus() {
      api('status').then(function (res) {
        if (!res.ok) return;
        var s = res.status || {}, c = s.controller || {}, st = s.stats || {};
        var state = $('stState');
        state.className = 'upng-state ' + statusClass(s.status);
        state.querySelector('.txt').textContent = statusText(s.status);
        var err = s.running ? (s.status !== 'CONNECTED' ? s.error : '') : t('STATUS.NOT_RUNNING');
        $('stError').textContent = err || '';
        $('stError').className = 'upng-err';
        if (s.status === 'TWO_FA_REQUIRED') $('tokenRow').classList.remove('upng-hidden');
        $('stController').textContent = c.host ? ((c.type === 'unifios' ? 'UniFi OS' : 'Classic') + ' – ' + c.host + ':' + c.port) : '–';
        $('stVersion').textContent = c.version || '–';
        $('stDevice').textContent = [c.deviceType, c.name].filter(Boolean).join(' – ') || '–';
        $('stGateway').textContent = st.gateway || '–';
        $('stLoad').textContent = (st.cpu !== undefined && st.cpu !== null) ? (st.cpu + ' % / ' + st.mem + ' %') : '–';
        $('stIsp').textContent = st.isp || '–';
        $('stUptime').textContent = fmtUptime(st.uptime);
        $('stMqtt').textContent = s.running ? (s.mqtt ? t('COMMON.OPT_YES') : t('COMMON.OPT_NO')) : '–';
        $('stBroker').textContent = s.mqttBroker ? s.mqttBroker + (s.mqttSource === 'custom' ? ' (' + t('SETTINGS.MQTT_CUSTOM') + ')' : ' (LoxBerry)') : '–';
        $('stActive').textContent = (s.activeClients !== undefined && s.activeClients !== null) ? s.activeClients : '–';
      });
    }
    refreshStatus();
    setInterval(refreshStatus, 5000);
  }

  /* ------------------------------------------------------------ Geräte */
  function initClients() {
    var clients = [];
    var live = {};
    var sortKey = 'watched', sortDir = -1;
    var saveTimer = null;

    function watchedList() {
      return clients.filter(function (c) { return c.watched; }).map(function (c) {
        return { mac: c.mac, name: c.name, type: c.type, alias: c.alias || '', system: c.system || '', userId: c.userId || '' };
      });
    }
    function scheduleSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        api('setclients', { clients: watchedList() }).then(function (res) {
          msg($('clientsMsg'), res.ok ? t('CLIENTS.SAVED') : errorText(res), res.ok ? 'ok' : 'bad');
          setTimeout(function () { msg($('clientsMsg'), ''); }, 3000);
        });
      }, 400);
    }

    function signalBars(p) {
      if (!p) return '';
      var n = p > 75 ? 4 : p > 50 ? 3 : p > 25 ? 2 : 1;
      var html = '<span class="bars" title="' + p + ' %">';
      for (var i = 1; i <= 4; i++) html += '<i class="' + (i <= n ? 'on' : '') + '" style="height:' + (i * 3 + 2) + 'px"></i>';
      return html + '</span> ' + p + ' %';
    }

    function render() {
      var q = $('search').value.trim().toLowerCase();
      var fw = $('fWifi').checked, fl = $('fWired').checked, fo = $('fOffline').checked, fwa = $('fWatched').checked;
      var list = clients.filter(function (c) {
        if (c.type === 'WIRELESS' && !fw) return false;
        if (c.type === 'WIRED' && !fl) return false;
        if (!c.online && !fo && !c.watched) return false;
        if (fwa && !c.watched) return false;
        if (q) {
          var hay = [c.name, c.alias, c.mac, c.ip, c.ssid, c.ap, c.system].join(' ').toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      });
      list.sort(function (a, b) {
        var x = a[sortKey], y = b[sortKey];
        if (sortKey === 'watched') {
          if (!!x !== !!y) return (x ? -1 : 1);
          if (!!a.online !== !!b.online) return a.online ? -1 : 1;
          return String(a.name).localeCompare(String(b.name));
        }
        if (x === undefined || x === null) x = '';
        if (y === undefined || y === null) y = '';
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * sortDir;
        return String(x).localeCompare(String(y), undefined, { numeric: true }) * sortDir;
      });
      var tbody = $('clientsTable').querySelector('tbody');
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="9">' + esc(t('CLIENTS.EMPTY')) + '</td></tr>';
        return;
      }
      tbody.innerHTML = list.map(function (c) {
        var lv = live[c.mac];
        var state = '';
        if (c.watched) {
          if (lv) state = '<span class="pill ' + (lv.connected ? 'ok' : 'bad') + '">' + esc(lv.connected ? t('CLIENTS.ONLINE') : t('CLIENTS.OFFLINE')) + '</span>' +
            '<div class="sub">' + esc(lv.topic || '') + '</div>';
          else state = '<span class="pill">–</span>';
        }
        var wifi = c.type === 'WIRELESS' ? (c.online ? esc(c.ssid || '') + (c.ap ? '<div class="sub">' + esc(c.ap) + '</div>' : '') : '') : '';
        return '<tr class="' + (c.watched ? 'watched' : '') + (c.online ? '' : ' offline') + '">' +
          '<td class="c"><input type="checkbox" data-role="none" data-mac="' + esc(c.mac) + '" class="w"' + (c.watched ? ' checked' : '') + '></td>' +
          '<td>' + esc(c.name) + (c.system ? '<div class="sub">' + esc(c.system) + '</div>' : '') +
            (c.missing ? '<div class="sub warn">' + esc(t('CLIENTS.NOT_IN_LIST')) + '</div>' : '') + '</td>' +
          '<td>' + (c.watched ? '<input type="text" data-role="none" class="alias" data-mac="' + esc(c.mac) + '" value="' + esc(c.alias || '') + '" placeholder="' + esc(c.name) + '">' : '') + '</td>' +
          '<td class="mono">' + esc(c.mac) + '</td>' +
          '<td class="mono">' + esc(c.online ? (c.ip || '') : '') + '</td>' +
          '<td>' + wifi + '</td>' +
          '<td>' + (c.type === 'WIRELESS' && c.online ? signalBars(c.signalPercentage) : (c.type === 'WIRELESS' ? esc(t('CLIENTS.OFFLINE')) : '–')) + '</td>' +
          '<td>' + esc(c.type === 'WIRED' ? 'LAN' : 'WLAN') + '</td>' +
          '<td>' + state + '</td>' +
          '</tr>';
      }).join('');
    }

    function byMac(mac) {
      for (var i = 0; i < clients.length; i++) if (clients[i].mac === mac) return clients[i];
      return null;
    }

    $('clientsTable').addEventListener('change', function (ev) {
      var el = ev.target;
      if (el.classList.contains('w')) {
        var c = byMac(el.getAttribute('data-mac'));
        if (c) { c.watched = el.checked; scheduleSave(); render(); }
      } else if (el.classList.contains('alias')) {
        var c2 = byMac(el.getAttribute('data-mac'));
        if (c2) { c2.alias = el.value.trim(); scheduleSave(); }
      }
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
      return api('clients').then(function (res) {
        busy(btn, false);
        msg($('clientsMsg'), '');
        $('clientsError').textContent = res.ok ? '' : errorText(res);
        clients = res.clients || [];
        $('androidHint').classList.toggle('upng-hidden', !clients.some(function (c) { return /google|samsung|xiaomi|oneplus|huawei/i.test(c.system || ''); }));
        render();
      });
    }
    function loadLive() {
      api('status').then(function (res) {
        if (res.ok && res.status && res.status.clients) {
          live = res.status.clients;
          if (document.activeElement && document.activeElement.classList.contains('alias')) return;
          render();
        }
      });
    }

    $('btnReload').addEventListener('click', load);
    $('btnManual').addEventListener('click', function () {
      var hex = $('mMac').value.replace(/[^0-9a-f]/gi, '').toLowerCase();
      if (hex.length !== 12) { msg($('clientsMsg'), t('CLIENTS.INVALID_MAC'), 'bad'); return; }
      var mac = hex.match(/.{2}/g).join(':');
      var c = byMac(mac);
      if (!c) {
        c = { mac: mac, name: $('mName').value.trim() || mac, type: $('mType').value, online: false, missing: true };
        clients.push(c);
      }
      c.watched = true;
      $('mMac').value = ''; $('mName').value = '';
      scheduleSave();
      render();
    });

    load().then(loadLive);
    setInterval(loadLive, 5000);
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

  if (page === 'settings') initSettings();
  else if (page === 'clients') initClients();
  else initLog();
})();
