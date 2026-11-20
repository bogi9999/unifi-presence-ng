<?php
/*
 * Unifi-PresenceNG – Weboberfläche (reines PHP + Vanilla JS, kein Express-Server)
 */
require_once "loxberry_web.php";

// Sprachdateien selbst laden (Englisch als Basis, LoxBerry-Sprache darüber)
function upng_language()
{
    $home = getenv('LBHOMEDIR') ?: (defined('LBHOMEDIR') ? LBHOMEDIR : dirname(__DIR__, 4));
    $dir = getenv('UPNG_TPLDIR') ?: "$home/templates/plugins/unifi_presenceng";
    $lang = 'de';
    if (class_exists('LBSystem') && method_exists('LBSystem', 'lblanguage')) {
        $lang = LBSystem::lblanguage() ?: 'de';
    }
    $L = [];
    foreach (array_unique(['en', $lang]) as $code) {
        $file = "$dir/lang/language_" . preg_replace('/[^a-z]/', '', $code) . ".ini";
        if (!is_readable($file)) continue;
        $ini = parse_ini_file($file, true, INI_SCANNER_RAW);
        if (!is_array($ini)) continue;
        foreach ($ini as $section => $values) {
            foreach ($values as $k => $v) $L["$section.$k"] = $v;
        }
    }
    return $L;
}
$L = upng_language();
function t($key)
{
    global $L;
    return isset($L[$key]) ? $L[$key] : $key;
}
function e($key)
{
    echo htmlspecialchars(t($key), ENT_QUOTES, 'UTF-8', false);
}

$pages = ['settings' => 1, 'clients' => 2, 'loxone' => 3, 'log' => 4];
$page = isset($_GET['page']) && isset($pages[$_GET['page']]) ? $_GET['page'] : 'settings';

$navbar[1]['Name'] = t('NAV.SETTINGS');
$navbar[1]['URL'] = 'index.php';
$navbar[2]['Name'] = t('NAV.CLIENTS');
$navbar[2]['URL'] = 'index.php?page=clients';
$navbar[3]['Name'] = t('NAV.LOXONE');
$navbar[3]['URL'] = 'index.php?page=loxone';
$navbar[4]['Name'] = t('NAV.LOG');
$navbar[4]['URL'] = 'index.php?page=log';
$navbar[$pages[$page]]['active'] = true;

LBWeb::lbheader("Unifi-PresenceNG", "", "help.html");
$v = '4.2.0';
?>
<link rel="stylesheet" href="style.css?v=<?= $v ?>">
<div id="upng" data-page="<?= $page ?>" data-version="<?= $v ?>">

  <header class="u-head">
    <span class="u-dot" id="hDot"></span>
    <div class="u-head-main">
      <div class="u-head-title" id="hState"><?php e('COMMON.LOADING'); ?></div>
      <div class="u-head-sub" id="hSub">&nbsp;</div>
    </div>
    <div class="u-head-side">
      <a class="u-badge u-badge-accent u-hidden" id="hUpdate" target="_blank" rel="noopener"></a>
      <span class="u-badge" id="hMqtt">MQTT</span>
      <button type="button" class="u-iconbtn" id="btnRestart" data-role="none" title="<?php e('STATUS.RESTART'); ?>" aria-label="<?php e('STATUS.RESTART'); ?>">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>
      </button>
    </div>
  </header>
  <div class="u-err" id="hError"></div>

<?php if ($page === 'settings'): ?>
  <section class="u-kpis">
    <div class="u-kpi"><small><?php e('STATUS.ACTIVE'); ?></small><b id="kActive">–</b><span id="kActiveSub">&nbsp;</span></div>
    <div class="u-kpi"><small><?php e('STATUS.PRESENT'); ?></small><b id="kPresent">–</b><span id="kPresentSub">&nbsp;</span></div>
    <div class="u-kpi"><small><?php e('STATUS.CPU'); ?></small><b id="kCpu">–</b><div class="u-meter"><i id="kCpuBar"></i></div></div>
    <div class="u-kpi"><small><?php e('STATUS.MEM'); ?></small><b id="kMem">–</b><div class="u-meter"><i id="kMemBar"></i></div></div>
  </section>

  <section class="u-block">
    <div class="u-block-head">
      <h3><?php e('STATUS.PRESENCE'); ?></h3>
      <a href="index.php?page=clients" class="u-link"><?php e('STATUS.MANAGE_DEVICES'); ?> →</a>
    </div>
    <div class="u-presence" id="presence"><div class="u-empty"><?php e('COMMON.LOADING'); ?></div></div>
  </section>

  <form id="settingsForm" autocomplete="off" onsubmit="return false;">
    <details class="u-sec" id="secController">
      <summary><span class="u-sec-title"><?php e('SETTINGS.CTRL_HEAD'); ?></span><span class="u-sec-sum" id="sumController"></span></summary>
      <div class="u-sec-body">
        <div class="u-grid2">
          <div class="u-field u-span2">
            <label for="ipaddress"><?php e('SETTINGS.ADDRESS'); ?></label>
            <input type="text" id="ipaddress" data-role="none" placeholder="192.168.1.1">
            <small><?php e('SETTINGS.ADDRESS_HINT'); ?></small>
          </div>
          <div class="u-field">
            <label><?php e('SETTINGS.TYPE'); ?></label>
            <div class="u-seg" data-target="controllerType">
              <button type="button" data-role="none" data-value="auto"><?php e('SETTINGS.TYPE_AUTO_SHORT'); ?></button>
              <button type="button" data-role="none" data-value="unifios">UniFi OS</button>
              <button type="button" data-role="none" data-value="classic"><?php e('SETTINGS.TYPE_CLASSIC_SHORT'); ?></button>
            </div>
            <input type="hidden" id="controllerType" value="auto">
          </div>
          <div class="u-field">
            <label for="port"><?php e('SETTINGS.PORT'); ?></label>
            <input type="number" id="port" min="1" max="65535" data-role="none" placeholder="<?php e('SETTINGS.PORT_AUTO'); ?>">
          </div>
          <div class="u-field u-span2 u-inline">
            <button type="button" class="u-btn" id="btnDetect" data-role="none"><?php e('SETTINGS.DETECT'); ?></button>
            <span class="u-msg" id="detectMsg"></span>
          </div>
          <div class="u-field">
            <label for="username"><?php e('SETTINGS.USERNAME'); ?></label>
            <input type="text" id="username" data-role="none" autocomplete="off">
            <small><?php e('SETTINGS.USERNAME_HINT'); ?></small>
          </div>
          <div class="u-field">
            <label for="password"><?php e('SETTINGS.PASSWORD'); ?></label>
            <input type="password" id="password" data-role="none" autocomplete="new-password">
          </div>
          <div class="u-field u-span2 u-hidden" id="tokenRow">
            <label for="token"><?php e('SETTINGS.TWO_FA'); ?></label>
            <input type="text" id="token" inputmode="numeric" maxlength="10" data-role="none">
            <small class="u-warn"><?php e('SETTINGS.TWO_FA_HINT'); ?></small>
          </div>
          <div class="u-field">
            <label for="site"><?php e('SETTINGS.SITE'); ?></label>
            <select id="site" data-role="none"><option value="default">default</option></select>
          </div>
          <div class="u-field u-bottom">
            <button type="button" class="u-btn" id="btnSites" data-role="none"><?php e('SETTINGS.SITE_RELOAD'); ?></button>
          </div>
        </div>
      </div>
    </details>

    <details class="u-sec" id="secMqtt">
      <summary><span class="u-sec-title">MQTT</span><span class="u-sec-sum" id="sumMqtt"></span></summary>
      <div class="u-sec-body">
        <div class="u-grid2">
          <div class="u-field u-span2">
            <label><?php e('SETTINGS.MQTT_BROKER'); ?></label>
            <div class="u-seg" data-target="mqttMode">
              <button type="button" data-role="none" data-value="loxberry">LoxBerry</button>
              <button type="button" data-role="none" data-value="custom"><?php e('SETTINGS.MQTT_CUSTOM'); ?></button>
            </div>
            <input type="hidden" id="mqttMode" value="loxberry">
            <small id="mqttLbInfo"></small>
          </div>
          <div class="u-field u-custom">
            <label for="mqttHost"><?php e('SETTINGS.MQTT_HOST'); ?></label>
            <input type="text" id="mqttHost" data-role="none" placeholder="192.168.1.20">
          </div>
          <div class="u-field u-custom">
            <label for="mqttPort"><?php e('SETTINGS.PORT'); ?></label>
            <input type="number" id="mqttPort" min="1" max="65535" data-role="none" placeholder="1883">
          </div>
          <div class="u-field u-custom">
            <label for="mqttUser"><?php e('SETTINGS.USERNAME'); ?></label>
            <input type="text" id="mqttUser" data-role="none" autocomplete="off">
          </div>
          <div class="u-field u-custom">
            <label for="mqttPassword"><?php e('SETTINGS.PASSWORD'); ?></label>
            <input type="password" id="mqttPassword" data-role="none" autocomplete="new-password">
            <label class="u-check u-hidden" id="mqttClearRow"><input type="checkbox" id="mqttClearPassword" data-role="none"> <?php e('SETTINGS.MQTT_CLEAR_PW'); ?></label>
          </div>
          <div class="u-field u-span2 u-custom">
            <label class="u-switch"><input type="checkbox" id="mqttTls" data-role="none"><span></span><?php e('SETTINGS.MQTT_TLS'); ?></label>
          </div>
          <div class="u-field">
            <label for="topic"><?php e('SETTINGS.TOPIC'); ?></label>
            <input type="text" id="topic" data-role="none">
            <small><?= t('SETTINGS.TOPIC_HINT') ?></small>
          </div>
          <div class="u-field">
            <label for="summaryTopic"><?php e('SETTINGS.SUMMARY_TOPIC'); ?></label>
            <input type="text" id="summaryTopic" data-role="none" placeholder="UniFi/presence">
            <small><?php e('SETTINGS.SUMMARY_TOPIC_HINT'); ?></small>
          </div>
          <div class="u-field u-span2">
            <label class="u-switch"><input type="checkbox" id="retain" data-role="none"><span></span><?php e('SETTINGS.RETAIN'); ?></label>
          </div>
          <div class="u-field u-span2 u-inline">
            <button type="button" class="u-btn" id="btnMqtt" data-role="none"><?php e('SETTINGS.MQTT_TEST'); ?></button>
            <span class="u-msg" id="mqttMsg"></span>
          </div>
        </div>
      </div>
    </details>

    <details class="u-sec" id="secDetect">
      <summary><span class="u-sec-title"><?php e('SETTINGS.DETECT_HEAD'); ?></span><span class="u-sec-sum" id="sumDetect"></span></summary>
      <div class="u-sec-body">
        <div class="u-grid2">
          <div class="u-field">
            <label for="wiredTimeout"><?php e('SETTINGS.WIRED_TIMEOUT'); ?></label>
            <select id="wiredTimeout" data-role="none"></select>
            <small><?php e('SETTINGS.WIRED_TIMEOUT_HINT'); ?></small>
          </div>
          <div class="u-field">
            <label for="pollInterval"><?php e('SETTINGS.POLL'); ?></label>
            <select id="pollInterval" data-role="none"></select>
            <small><?php e('SETTINGS.POLL_HINT'); ?></small>
          </div>
          <div class="u-field">
            <label><?php e('SETTINGS.LOGLEVEL'); ?></label>
            <div class="u-seg" data-target="loglevel">
              <button type="button" data-role="none" data-value="info">Info</button>
              <button type="button" data-role="none" data-value="debug">Debug</button>
            </div>
            <input type="hidden" id="loglevel" value="info">
          </div>
        </div>
      </div>
    </details>

    <details class="u-sec" id="secBackup">
      <summary><span class="u-sec-title"><?php e('BACKUP.HEAD'); ?></span><span class="u-sec-sum"><?php e('BACKUP.SUMMARY'); ?></span></summary>
      <div class="u-sec-body">
        <div class="u-grid2">
          <div class="u-field">
            <label><?php e('BACKUP.EXPORT'); ?></label>
            <small class="u-mb"><?php e('BACKUP.EXPORT_HINT'); ?></small>
            <input type="password" id="backupPassword" data-role="none" placeholder="<?php e('BACKUP.PASSWORD'); ?>" autocomplete="new-password">
            <div class="u-inline u-mt">
              <button type="button" class="u-btn" id="btnBackup" data-role="none"><?php e('BACKUP.DOWNLOAD'); ?></button>
              <span class="u-msg" id="backupMsg"></span>
            </div>
          </div>
          <div class="u-field">
            <label><?php e('BACKUP.IMPORT'); ?></label>
            <small class="u-mb"><?php e('BACKUP.IMPORT_HINT'); ?></small>
            <input type="file" id="backupFile" accept=".upng,.json" data-role="none">
            <input type="password" id="restorePassword" class="u-mt" data-role="none" placeholder="<?php e('BACKUP.PASSWORD'); ?>" autocomplete="off">
            <div class="u-inline u-mt">
              <button type="button" class="u-btn" id="btnRestoreCheck" data-role="none"><?php e('BACKUP.CHECK'); ?></button>
              <button type="button" class="u-btn u-btn-primary u-hidden" id="btnRestoreApply" data-role="none"><?php e('BACKUP.APPLY'); ?></button>
            </div>
            <div class="u-preview u-hidden" id="restorePreview"></div>
            <span class="u-msg" id="restoreMsg"></span>
          </div>
        </div>
      </div>
    </details>
  </form>

  <div class="u-savebar u-hidden" id="saveBar">
    <span id="saveMsg"><?php e('COMMON.UNSAVED'); ?></span>
    <button type="button" class="u-btn" id="btnDiscard" data-role="none"><?php e('COMMON.DISCARD'); ?></button>
    <button type="button" class="u-btn u-btn-primary" id="btnSave" data-role="none"><?php e('COMMON.SAVE'); ?></button>
  </div>

<?php elseif ($page === 'clients'): ?>
  <section class="u-block">
    <div class="u-block-head">
      <h3><?php e('CLIENTS.HEAD'); ?></h3>
      <span class="u-msg" id="clientsMsg"></span>
    </div>
    <p class="u-text"><?php e('CLIENTS.INFO'); ?></p>
    <div class="u-banner u-hidden" id="androidHint"><?php e('CLIENTS.ANDROID'); ?></div>
    <div class="u-err" id="clientsError"></div>
    <div class="u-toolbar">
      <input type="search" id="search" placeholder="<?php e('CLIENTS.SEARCH'); ?>" data-role="none">
      <div class="u-chips">
        <label class="u-chip"><input type="checkbox" id="fWatched" data-role="none"><span><?php e('CLIENTS.ONLY_WATCHED'); ?></span></label>
        <label class="u-chip"><input type="checkbox" id="fWifi" checked data-role="none"><span><?php e('CLIENTS.SHOW_WIFI'); ?></span></label>
        <label class="u-chip"><input type="checkbox" id="fWired" checked data-role="none"><span><?php e('CLIENTS.SHOW_WIRED'); ?></span></label>
        <label class="u-chip"><input type="checkbox" id="fOffline" checked data-role="none"><span><?php e('CLIENTS.SHOW_OFFLINE'); ?></span></label>
      </div>
      <button type="button" class="u-btn" id="btnReload" data-role="none"><?php e('COMMON.REFRESH'); ?></button>
    </div>
    <div class="u-tablewrap">
      <table class="u-table" id="clientsTable">
        <thead>
          <tr>
            <th data-sort="watched"><?php e('CLIENTS.WATCH'); ?></th>
            <th data-sort="name"><?php e('CLIENTS.NAME'); ?></th>
            <th><?php e('CLIENTS.ALIAS'); ?></th>
            <th title="<?php e('CLIENTS.PERSON_HINT'); ?>"><?php e('CLIENTS.PERSON'); ?></th>
            <th><?php e('CLIENTS.GROUP'); ?></th>
            <th data-sort="ssid"><?php e('CLIENTS.NETWORK'); ?></th>
            <th data-sort="mac"><?php e('CLIENTS.MAC'); ?> / <?php e('CLIENTS.IP'); ?></th>
            <th><?php e('CLIENTS.STATE'); ?></th>
          </tr>
        </thead>
        <tbody><tr><td colspan="8" class="u-empty"><?php e('COMMON.LOADING'); ?></td></tr></tbody>
      </table>
    </div>
    <datalist id="groupList"></datalist>
  </section>
  <section class="u-block">
    <h3><?php e('CLIENTS.MANUAL_HEAD'); ?></h3>
    <div class="u-toolbar">
      <input type="text" id="mMac" placeholder="aa:bb:cc:dd:ee:ff" data-role="none">
      <input type="text" id="mName" placeholder="<?php e('CLIENTS.NAME'); ?>" data-role="none">
      <div class="u-seg" data-target="mType">
        <button type="button" data-role="none" data-value="WIRELESS">WLAN</button>
        <button type="button" data-role="none" data-value="WIRED">LAN</button>
      </div>
      <input type="hidden" id="mType" value="WIRELESS">
      <button type="button" class="u-btn" id="btnManual" data-role="none"><?php e('CLIENTS.MANUAL_ADD'); ?></button>
    </div>
  </section>

<?php elseif ($page === 'loxone'): ?>
  <section class="u-block">
    <div class="u-block-head"><h3><?php e('LOXONE.SUMMARY_HEAD'); ?></h3><span class="u-mono u-muted" id="lxSummaryTopic"></span></div>
    <p class="u-text"><?php e('LOXONE.SUMMARY_INFO'); ?></p>
    <div class="u-kpis" id="lxSummary"></div>
    <div class="u-presence" id="lxGroups"></div>
  </section>
  <section class="u-block">
    <div class="u-block-head"><h3><?php e('LOXONE.INPUTS_HEAD'); ?></h3></div>
    <div class="u-grid2">
      <div class="u-field">
        <label><?php e('LOXONE.TRANSPORT'); ?></label>
        <div class="u-seg" data-target="lxTransport">
          <button type="button" data-role="none" data-value="http">HTTP</button>
          <button type="button" data-role="none" data-value="udp">UDP</button>
        </div>
        <input type="hidden" id="lxTransport" value="http">
        <small id="lxTransportHint"></small>
      </div>
      <div class="u-field" id="lxPortRow">
        <label for="lxPort"><?php e('LOXONE.UDP_PORT'); ?></label>
        <input type="number" id="lxPort" value="11883" min="1" max="65535" data-role="none">
        <small><?php e('LOXONE.UDP_PORT_HINT'); ?></small>
      </div>
      <div class="u-field u-span2">
        <label><?php e('LOXONE.VALUES'); ?></label>
        <div class="u-chips">
          <label class="u-chip"><input type="checkbox" class="lxv" value="connected" checked data-role="none"><span><?php e('LOXONE.V_CONNECTED'); ?></span></label>
          <label class="u-chip"><input type="checkbox" class="lxv" value="signalPercentage" data-role="none"><span><?php e('LOXONE.V_SIGNAL'); ?></span></label>
          <label class="u-chip"><input type="checkbox" class="lxv" value="summary" checked data-role="none"><span><?php e('LOXONE.V_SUMMARY'); ?></span></label>
          <label class="u-chip"><input type="checkbox" class="lxv" value="groups" checked data-role="none"><span><?php e('LOXONE.V_GROUPS'); ?></span></label>
        </div>
      </div>
    </div>
    <div class="u-toolbar">
      <button type="button" class="u-btn" id="btnCopyAll" data-role="none"><?php e('LOXONE.COPY_ALL'); ?></button>
      <button type="button" class="u-btn u-btn-primary" id="btnTemplate" data-role="none"><?php e('LOXONE.TEMPLATE'); ?></button>
      <span class="u-msg" id="lxMsg"></span>
    </div>
    <div class="u-tablewrap">
      <table class="u-table" id="lxTable">
        <thead><tr><th><?php e('LOXONE.COL_LABEL'); ?></th><th><?php e('LOXONE.COL_NAME'); ?></th><th><?php e('LOXONE.COL_TYPE'); ?></th><th><?php e('LOXONE.COL_VALUE'); ?></th></tr></thead>
        <tbody><tr><td colspan="4" class="u-empty"><?php e('COMMON.LOADING'); ?></td></tr></tbody>
      </table>
    </div>
    <small class="u-note"><?php e('LOXONE.NOTE'); ?></small>
  </section>

<?php else: ?>
  <section class="u-block">
    <div class="u-block-head">
      <h3><?php e('LOG.HEAD'); ?></h3>
      <span class="u-mono u-muted" id="logFile"></span>
      <button type="button" class="u-btn" id="btnLog" data-role="none"><?php e('COMMON.REFRESH'); ?></button>
    </div>
    <pre class="u-log" id="logView"></pre>
  </section>
<?php endif; ?>
</div>
<script>window.UPNG_L = <?= json_encode($L, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) ?>;</script>
<script src="app.js?v=<?= $v ?>"></script>
<?php
LBWeb::lbfooter();
