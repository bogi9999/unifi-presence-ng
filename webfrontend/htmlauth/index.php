<?php
/*
 * Unifi-PresenceNG – Weboberfläche (reines PHP, kein Express-Server)
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

$page = isset($_GET['page']) ? $_GET['page'] : 'settings';
if (!in_array($page, ['settings', 'clients', 'log'])) $page = 'settings';

$navbar[1]['Name'] = t('NAV.SETTINGS');
$navbar[1]['URL'] = 'index.php';
$navbar[2]['Name'] = t('NAV.CLIENTS');
$navbar[2]['URL'] = 'index.php?page=clients';
$navbar[3]['Name'] = t('NAV.LOG');
$navbar[3]['URL'] = 'index.php?page=log';
$navbar[['settings' => 1, 'clients' => 2, 'log' => 3][$page]]['active'] = true;

$template_title = "Unifi-PresenceNG";
LBWeb::lbheader($template_title, "", "help.html");
$v = '4.1.0';
?>
<link rel="stylesheet" href="style.css?v=<?= $v ?>">
<div id="upng" data-page="<?= $page ?>">

<?php if ($page === 'settings'): ?>
  <div class="upng-grid">
    <div class="upng-card upng-status" id="statusCard">
      <h3><?php e('STATUS.TITLE'); ?></h3>
      <div class="upng-state" id="stState"><span class="dot"></span><span class="txt"><?php e('COMMON.LOADING'); ?></span></div>
      <div class="upng-err" id="stError"></div>
      <table class="upng-kv">
        <tr><th><?php e('STATUS.CONTROLLER'); ?></th><td id="stController">–</td></tr>
        <tr><th><?php e('STATUS.VERSION'); ?></th><td id="stVersion">–</td></tr>
        <tr><th><?php e('STATUS.DEVICE'); ?></th><td id="stDevice">–</td></tr>
        <tr><th><?php e('STATUS.GATEWAY'); ?></th><td id="stGateway">–</td></tr>
        <tr><th><?php e('STATUS.CPU'); ?> / <?php e('STATUS.MEM'); ?></th><td id="stLoad">–</td></tr>
        <tr><th><?php e('STATUS.ISP'); ?></th><td id="stIsp">–</td></tr>
        <tr><th><?php e('STATUS.UPTIME'); ?></th><td id="stUptime">–</td></tr>
        <tr><th><?php e('STATUS.MQTT'); ?></th><td id="stMqtt">–</td></tr>
        <tr><th><?php e('STATUS.BROKER'); ?></th><td id="stBroker">–</td></tr>
        <tr><th><?php e('STATUS.ACTIVE'); ?></th><td id="stActive">–</td></tr>
        <tr><th><?php e('STATUS.PLUGIN'); ?></th><td><?= $v ?></td></tr>
      </table>
      <button type="button" class="upng-btn" id="btnRestart" data-role="none"><?php e('STATUS.RESTART'); ?></button>
    </div>

    <form class="upng-card" id="settingsForm" autocomplete="off" onsubmit="return false;">
      <h3><?php e('SETTINGS.CTRL_HEAD'); ?></h3>
      <div class="upng-row">
        <label for="ipaddress"><?php e('SETTINGS.ADDRESS'); ?></label>
        <input type="text" id="ipaddress" name="ipaddress" data-role="none" placeholder="192.168.1.1">
        <small><?php e('SETTINGS.ADDRESS_HINT'); ?></small>
      </div>
      <div class="upng-row upng-inline">
        <div>
          <label for="port"><?php e('SETTINGS.PORT'); ?></label>
          <input type="number" id="port" name="port" min="1" max="65535" data-role="none" placeholder="auto">
          <small><?php e('SETTINGS.PORT_HINT'); ?></small>
        </div>
        <div>
          <label for="controllerType"><?php e('SETTINGS.TYPE'); ?></label>
          <select id="controllerType" name="controllerType" data-role="none">
            <option value="auto"><?php e('SETTINGS.TYPE_AUTO'); ?></option>
            <option value="unifios"><?php e('SETTINGS.TYPE_UNIFIOS'); ?></option>
            <option value="classic"><?php e('SETTINGS.TYPE_CLASSIC'); ?></option>
          </select>
        </div>
      </div>
      <div class="upng-row">
        <button type="button" class="upng-btn upng-btn-light" id="btnDetect" data-role="none"><?php e('SETTINGS.DETECT'); ?></button>
        <span class="upng-msg" id="detectMsg"></span>
      </div>
      <div class="upng-row upng-inline">
        <div>
          <label for="username"><?php e('SETTINGS.USERNAME'); ?></label>
          <input type="text" id="username" name="username" data-role="none" autocomplete="off">
          <small><?php e('SETTINGS.USERNAME_HINT'); ?></small>
        </div>
        <div>
          <label for="password"><?php e('SETTINGS.PASSWORD'); ?></label>
          <input type="password" id="password" name="password" data-role="none" autocomplete="new-password">
        </div>
      </div>
      <div class="upng-row upng-hidden" id="tokenRow">
        <label for="token"><?php e('SETTINGS.TWO_FA'); ?></label>
        <input type="text" id="token" name="token" inputmode="numeric" maxlength="10" data-role="none">
        <small class="warn"><?php e('SETTINGS.TWO_FA_HINT'); ?></small>
      </div>
      <div class="upng-row upng-inline">
        <div>
          <label for="site"><?php e('SETTINGS.SITE'); ?></label>
          <select id="site" name="site" data-role="none"><option value="default">default</option></select>
        </div>
        <div class="upng-bottom">
          <button type="button" class="upng-btn upng-btn-light" id="btnSites" data-role="none"><?php e('SETTINGS.SITE_RELOAD'); ?></button>
        </div>
      </div>

      <h3><?php e('SETTINGS.MQTT_HEAD'); ?></h3>
      <div class="upng-row">
        <label for="mqttMode"><?php e('SETTINGS.MQTT_BROKER'); ?></label>
        <select id="mqttMode" name="mqttMode" data-role="none">
          <option value="loxberry"><?php e('SETTINGS.MQTT_LOXBERRY'); ?></option>
          <option value="custom"><?php e('SETTINGS.MQTT_CUSTOM'); ?></option>
        </select>
        <small id="mqttLbInfo"></small>
      </div>
      <div id="mqttCustom" class="upng-hidden">
        <div class="upng-row upng-inline">
          <div>
            <label for="mqttHost"><?php e('SETTINGS.MQTT_HOST'); ?></label>
            <input type="text" id="mqttHost" name="mqttHost" data-role="none" placeholder="192.168.1.20">
          </div>
          <div>
            <label for="mqttPort"><?php e('SETTINGS.PORT'); ?></label>
            <input type="number" id="mqttPort" name="mqttPort" min="1" max="65535" data-role="none" placeholder="1883">
          </div>
        </div>
        <div class="upng-row upng-inline">
          <div>
            <label for="mqttUser"><?php e('SETTINGS.USERNAME'); ?></label>
            <input type="text" id="mqttUser" name="mqttUser" data-role="none" autocomplete="off">
          </div>
          <div>
            <label for="mqttPassword"><?php e('SETTINGS.PASSWORD'); ?></label>
            <input type="password" id="mqttPassword" name="mqttPassword" data-role="none" autocomplete="new-password">
            <label class="upng-check upng-hidden" id="mqttClearRow"><input type="checkbox" id="mqttClearPassword" data-role="none"> <?php e('SETTINGS.MQTT_CLEAR_PW'); ?></label>
          </div>
        </div>
        <div class="upng-row">
          <label class="upng-check"><input type="checkbox" id="mqttTls" name="mqttTls" data-role="none"> <?php e('SETTINGS.MQTT_TLS'); ?></label>
        </div>
      </div>
      <div class="upng-row">
        <label for="topic"><?php e('SETTINGS.TOPIC'); ?></label>
        <input type="text" id="topic" name="topic" data-role="none">
        <small><?= t('SETTINGS.TOPIC_HINT') ?></small>
      </div>
      <div class="upng-row">
        <label class="upng-check"><input type="checkbox" id="retain" name="retain" data-role="none"> <?php e('SETTINGS.RETAIN'); ?></label>
      </div>
      <div class="upng-row upng-inline">
        <div>
          <label for="wiredTimeout"><?php e('SETTINGS.WIRED_TIMEOUT'); ?></label>
          <select id="wiredTimeout" name="wiredTimeout" data-role="none"></select>
          <small><?php e('SETTINGS.WIRED_TIMEOUT_HINT'); ?></small>
        </div>
        <div>
          <label for="pollInterval"><?php e('SETTINGS.POLL'); ?></label>
          <select id="pollInterval" name="pollInterval" data-role="none"></select>
          <small><?php e('SETTINGS.POLL_HINT'); ?></small>
        </div>
      </div>
      <div class="upng-row upng-inline">
        <div>
          <label for="loglevel"><?php e('SETTINGS.LOGLEVEL'); ?></label>
          <select id="loglevel" name="loglevel" data-role="none">
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>
        </div>
        <div class="upng-bottom">
          <button type="button" class="upng-btn upng-btn-light" id="btnMqtt" data-role="none"><?php e('SETTINGS.MQTT_TEST'); ?></button>
          <span class="upng-msg" id="mqttMsg"></span>
        </div>
      </div>

      <div class="upng-row upng-actions">
        <button type="button" class="upng-btn" id="btnSave" data-role="none"><?php e('COMMON.SAVE'); ?></button>
        <span class="upng-msg" id="saveMsg"></span>
      </div>
    </form>
  </div>

<?php elseif ($page === 'clients'): ?>
  <div class="upng-card">
    <h3><?php e('CLIENTS.HEAD'); ?></h3>
    <p><?php e('CLIENTS.INFO'); ?></p>
    <div class="upng-banner upng-hidden" id="androidHint"><?php e('CLIENTS.ANDROID'); ?></div>
    <div class="upng-err" id="clientsError"></div>
    <div class="upng-toolbar">
      <input type="search" id="search" placeholder="<?php e('CLIENTS.SEARCH'); ?>" data-role="none">
      <label class="upng-check"><input type="checkbox" id="fWifi" checked data-role="none"> <?php e('CLIENTS.SHOW_WIFI'); ?></label>
      <label class="upng-check"><input type="checkbox" id="fWired" checked data-role="none"> <?php e('CLIENTS.SHOW_WIRED'); ?></label>
      <label class="upng-check"><input type="checkbox" id="fOffline" checked data-role="none"> <?php e('CLIENTS.SHOW_OFFLINE'); ?></label>
      <label class="upng-check"><input type="checkbox" id="fWatched" data-role="none"> <?php e('CLIENTS.ONLY_WATCHED'); ?></label>
      <button type="button" class="upng-btn upng-btn-light" id="btnReload" data-role="none"><?php e('COMMON.REFRESH'); ?></button>
      <span class="upng-msg" id="clientsMsg"></span>
    </div>
    <div class="upng-tablewrap">
      <table class="upng-table" id="clientsTable">
        <thead>
          <tr>
            <th data-sort="watched"><?php e('CLIENTS.WATCH'); ?></th>
            <th data-sort="name"><?php e('CLIENTS.NAME'); ?></th>
            <th><?php e('CLIENTS.ALIAS'); ?></th>
            <th data-sort="mac"><?php e('CLIENTS.MAC'); ?></th>
            <th data-sort="ip"><?php e('CLIENTS.IP'); ?></th>
            <th data-sort="ssid"><?php e('CLIENTS.SSID'); ?></th>
            <th data-sort="signalPercentage"><?php e('CLIENTS.SIGNAL'); ?></th>
            <th data-sort="type"><?php e('CLIENTS.TYPE'); ?></th>
            <th><?php e('CLIENTS.STATE'); ?></th>
          </tr>
        </thead>
        <tbody><tr><td colspan="9"><?php e('COMMON.LOADING'); ?></td></tr></tbody>
      </table>
    </div>
    <h3><?php e('CLIENTS.MANUAL_HEAD'); ?></h3>
    <div class="upng-toolbar">
      <input type="text" id="mMac" placeholder="aa:bb:cc:dd:ee:ff" data-role="none">
      <input type="text" id="mName" placeholder="<?php e('CLIENTS.NAME'); ?>" data-role="none">
      <select id="mType" data-role="none"><option value="WIRELESS">WIRELESS</option><option value="WIRED">WIRED</option></select>
      <button type="button" class="upng-btn upng-btn-light" id="btnManual" data-role="none"><?php e('CLIENTS.MANUAL_ADD'); ?></button>
    </div>
  </div>

<?php else: ?>
  <div class="upng-card">
    <h3><?php e('LOG.HEAD'); ?></h3>
    <div class="upng-toolbar">
      <button type="button" class="upng-btn upng-btn-light" id="btnLog" data-role="none"><?php e('COMMON.REFRESH'); ?></button>
      <span class="upng-msg" id="logFile"></span>
    </div>
    <pre class="upng-log" id="logView"></pre>
  </div>
<?php endif; ?>
</div>
<script>window.UPNG_L = <?= json_encode($L, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) ?>;</script>
<script src="app.js?v=<?= $v ?>"></script>
<?php
LBWeb::lbfooter();
