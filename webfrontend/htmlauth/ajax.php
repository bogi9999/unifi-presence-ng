<?php
/*
 * Unifi-PresenceNG – JSON-Schnittstelle der Weboberfläche (ersetzt den Express-Server)
 */
require_once "loxberry_system.php";

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const UPNG_PLUGIN = 'unifi_presenceng';
const UPNG_VERSION = '4.3.1';
const UPNG_RELEASE_CFG = 'https://raw.githubusercontent.com/bogi9999/unifi-presence-ng/main/release.cfg';
const UPNG_PRERELEASE_CFG = 'https://raw.githubusercontent.com/bogi9999/unifi-presence-ng/main/prerelease.cfg';
const UPNG_BACKUP_FORMAT = 'unifi-presenceng-backup';
const UPNG_BACKUP_ITER = 200000;

$lbhome = getenv('UPNG_DEVDIR') ?: (getenv('LBHOMEDIR') ?: (defined('LBHOMEDIR') ? LBHOMEDIR : dirname(__DIR__, 4)));
$devmode = (bool) getenv('UPNG_DEVDIR');
$dirs = [
    'config' => $devmode ? "$lbhome/config" : "$lbhome/config/plugins/" . UPNG_PLUGIN,
    'data'   => $devmode ? "$lbhome/data"   : "$lbhome/data/plugins/" . UPNG_PLUGIN,
    'log'    => $devmode ? "$lbhome/log"    : "$lbhome/log/plugins/" . UPNG_PLUGIN,
    'bin'    => getenv('UPNG_BINDIR') ?: "$lbhome/bin/plugins/" . UPNG_PLUGIN,
];
$configFile = $dirs['config'] . '/unifi.json';
$statusFile = $dirs['data'] . '/status.json';
$subscriptionFile = $dirs['config'] . '/mqtt_subscriptions.cfg';
$logFile = $dirs['log'] . '/unifi_presenceng.log';

$defaults = [
    'ipaddress' => '', 'port' => null, 'controllerType' => 'auto', 'username' => '', 'password' => '',
    'site' => 'default', 'twoFaEnabled' => false, 'topic' => 'UniFi/clients', 'summaryTopic' => 'UniFi/presence',
    'retain' => false,
    'wiredTimeout' => 60, 'pollInterval' => 30, 'loglevel' => 'info', 'clients' => [],
    'mqtt' => ['mode' => 'loxberry', 'host' => '', 'port' => 1883, 'user' => '', 'password' => '', 'tls' => false],
];

function respond($data, $code = 200)
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail($message, $code = 400, $extra = [])
{
    respond(array_merge(['ok' => false, 'error' => $message], $extra), $code);
}

function load_config()
{
    global $configFile, $defaults;
    $cfg = [];
    if (is_readable($configFile)) {
        $cfg = json_decode(file_get_contents($configFile), true);
        if (!is_array($cfg)) $cfg = [];
    }
    $cfg = array_merge($defaults, $cfg);
    unset($cfg['native']);
    if (!is_array($cfg['clients'])) $cfg['clients'] = [];
    $cfg['mqtt'] = array_merge($defaults['mqtt'], is_array($cfg['mqtt']) ? $cfg['mqtt'] : []);
    return $cfg;
}

function save_config($cfg)
{
    global $configFile;
    $json = json_encode($cfg, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $tmp = $configFile . '.tmp.' . getmypid();
    if (file_put_contents($tmp, $json) === false) fail('Konfiguration kann nicht geschrieben werden', 500);
    @chmod($tmp, 0600);
    if (!rename($tmp, $configFile)) fail('Konfiguration kann nicht gespeichert werden', 500);
}

function public_config($cfg)
{
    $cfg['hasPassword'] = $cfg['password'] !== '';
    unset($cfg['password']);
    $cfg['mqtt']['hasPassword'] = $cfg['mqtt']['password'] !== '';
    unset($cfg['mqtt']['password']);
    $cfg['loxberryMqtt'] = loxberry_mqtt();
    return $cfg;
}

function loxberry_mqtt()
{
    global $lbhome, $devmode;
    $file = $devmode ? "$lbhome/general.json" : "$lbhome/config/system/general.json";
    $g = is_readable($file) ? json_decode(file_get_contents($file), true) : null;
    $m = is_array($g) ? ($g['Mqtt'] ?? ($g['MQTT'] ?? null)) : null;
    if (!is_array($m)) return null;
    return ['host' => $m['Brokerhost'] ?? 'localhost', 'port' => $m['Brokerport'] ?? 1883, 'user' => $m['Brokeruser'] ?? ''];
}

function mqtt_from_input($input, $current, &$errors)
{
    $m = $current;
    $m['mode'] = (($input['mqttMode'] ?? $m['mode']) === 'custom') ? 'custom' : 'loxberry';
    $m['host'] = trim((string) ($input['mqttHost'] ?? $m['host']));
    $m['tls'] = filter_var($input['mqttTls'] ?? $m['tls'], FILTER_VALIDATE_BOOLEAN);
    $port = $input['mqttPort'] ?? $m['port'];
    if ($port === '' || $port === null) {
        $m['port'] = $m['tls'] ? 8883 : 1883;
    } elseif (ctype_digit((string) $port) && intval($port) > 0 && intval($port) < 65536) {
        $m['port'] = intval($port);
    } else {
        $errors['mqttPort'] = 'Ungültiger Port';
    }
    $m['user'] = trim((string) ($input['mqttUser'] ?? $m['user']));
    if (isset($input['mqttPassword']) && $input['mqttPassword'] !== '') $m['password'] = (string) $input['mqttPassword'];
    if (!empty($input['mqttClearPassword'])) $m['password'] = '';
    if ($m['mode'] === 'custom' && ($m['host'] === '' || !preg_match('/^[A-Za-z0-9.\-:\[\]]+$/', $m['host']))) {
        $errors['mqttHost'] = 'Ungültige Adresse';
    }
    return $m;
}

function run_cli($args, $timeout = 60)
{
    global $lbhome, $dirs, $devmode;
    $env = $devmode ? 'UPNG_DEVDIR=' . escapeshellarg($lbhome) : 'LBHOMEDIR=' . escapeshellarg($lbhome);
    $cmd = $env . ' timeout ' . intval($timeout) . ' python3 ' . escapeshellarg($dirs['bin'] . '/unifi_presenceng.py') . ' cli';
    foreach ($args as $a) $cmd .= ' ' . escapeshellarg((string) $a);
    $out = [];
    exec($cmd . ' 2>&1', $out, $rc);
    $text = implode("\n", $out);
    $res = json_decode(trim(end($out) ?: ''), true);
    if (!is_array($res)) {
        if ($rc == 124) return ['ok' => false, 'code' => 'UNREACHABLE', 'error' => 'Zeitüberschreitung'];
        return ['ok' => false, 'code' => 'ERROR', 'error' => 'Interner Fehler (rc=' . $rc . '): ' . substr($text, 0, 400)];
    }
    return $res;
}

function service($cmd)
{
    global $lbhome, $dirs;
    $script = $dirs['bin'] . '/service.sh';
    exec('LBHOMEDIR=' . escapeshellarg($lbhome) . ' /bin/bash ' . escapeshellarg($script) . ' ' . escapeshellarg($cmd) . ' 2>&1', $out, $rc);
    return ['rc' => $rc, 'output' => implode("\n", $out)];
}

function valid_topic($topic)
{
    return (bool) preg_match('#^[A-Za-z0-9_\-]+(/[A-Za-z0-9_\-]+)*$#', $topic);
}

function write_subscriptions($cfg)
{
    global $subscriptionFile;
    $lines = [$cfg['topic'] . '/#'];
    if ($cfg['summaryTopic'] !== '' && $cfg['summaryTopic'] !== $cfg['topic']) $lines[] = $cfg['summaryTopic'] . '/#';
    @file_put_contents($subscriptionFile, implode("\n", $lines) . "\n");
}

function read_json_file($file)
{
    if (!is_readable($file)) return null;
    $d = json_decode(file_get_contents($file), true);
    return is_array($d) ? $d : null;
}

function fetch_release_cfg($url)
{
    $ctx = stream_context_create(['http' => ['timeout' => 6, 'user_agent' => 'Unifi-PresenceNG/' . UPNG_VERSION],
                                  'https' => ['timeout' => 6]]);
    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) return null;
    $ini = @parse_ini_string($raw, true, INI_SCANNER_RAW);
    $a = is_array($ini) ? ($ini['AUTOUPDATE'] ?? null) : null;
    if (!is_array($a) || empty($a['VERSION'])) return null;
    return ['version' => trim($a['VERSION']), 'archive' => $a['ARCHIVEURL'] ?? '', 'info' => $a['INFOURL'] ?? ''];
}

function backup_key($password, $salt, $iter)
{
    return hash_pbkdf2('sha256', $password, $salt, $iter, 32, true);
}

function valid_mac($mac)
{
    return (bool) preg_match('/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/', $mac);
}

function normalize_mac($mac)
{
    $hex = strtolower(preg_replace('/[^0-9a-fA-F]/', '', (string) $mac));
    if (strlen($hex) != 12) return '';
    return implode(':', str_split($hex, 2));
}

$input = [];
$raw = file_get_contents('php://input');
if ($raw) {
    $input = json_decode($raw, true);
    if (!is_array($input)) $input = [];
}
$input = array_merge($_GET, $_POST, $input);
$action = isset($input['action']) ? $input['action'] : '';

switch ($action) {

    case 'getconfig':
        respond(['ok' => true, 'config' => public_config(load_config())]);

    case 'status':
        $status = is_readable($statusFile) ? json_decode(file_get_contents($statusFile), true) : null;
        if (!is_array($status)) $status = ['status' => 'STOPPED', 'clients' => new stdClass()];
        $pid = isset($status['pid']) ? intval($status['pid']) : 0;
        $alive = $pid > 0 && file_exists("/proc/$pid");
        $status['running'] = $alive && isset($status['updated']) && (time() - $status['updated']) < 60;
        if (!$status['running']) $status['status'] = 'STOPPED';
        respond(['ok' => true, 'status' => $status]);

    case 'saveconfig':
        $cfg = load_config();
        $old = $cfg;
        $errors = [];

        $topic = trim((string) ($input['topic'] ?? $cfg['topic']), " /");
        if (!preg_match('#^[A-Za-z0-9_\-]+(/[A-Za-z0-9_\-]+)*$#', $topic)) $errors['topic'] = 'Ungültiges Topic';
        $cfg['topic'] = $topic;

        $stopic = trim((string) ($input['summaryTopic'] ?? $cfg['summaryTopic']), " /");
        if ($stopic !== '' && !valid_topic($stopic)) $errors['summaryTopic'] = 'Ungültiges Topic';
        $cfg['summaryTopic'] = $stopic;

        $host = trim((string) ($input['ipaddress'] ?? $cfg['ipaddress']));
        $host = preg_replace('#^[a-z]+://#i', '', $host);
        $host = explode('/', $host)[0];
        if ($host === '' || !preg_match('/^[A-Za-z0-9.\-:\[\]]+$/', $host)) $errors['ipaddress'] = 'Ungültige Adresse';
        $cfg['ipaddress'] = $host;

        $port = $input['port'] ?? $cfg['port'];
        if ($port === '' || $port === null) {
            $cfg['port'] = null;
        } elseif (ctype_digit((string) $port) && intval($port) > 0 && intval($port) < 65536) {
            $cfg['port'] = intval($port);
        } else {
            $errors['port'] = 'Ungültiger Port';
        }

        $type = $input['controllerType'] ?? $cfg['controllerType'];
        $cfg['controllerType'] = in_array($type, ['auto', 'unifios', 'classic']) ? $type : 'auto';

        $cfg['username'] = trim((string) ($input['username'] ?? $cfg['username']));
        if ($cfg['username'] === '') $errors['username'] = 'Pflichtfeld';
        if (isset($input['password']) && $input['password'] !== '') $cfg['password'] = (string) $input['password'];
        if ($cfg['password'] === '') $errors['password'] = 'Pflichtfeld';

        $site = trim((string) ($input['site'] ?? $cfg['site']));
        $cfg['site'] = preg_match('/^[A-Za-z0-9_\-]+$/', $site) ? $site : 'default';
        $cfg['retain'] = filter_var($input['retain'] ?? $cfg['retain'], FILTER_VALIDATE_BOOLEAN);
        $cfg['wiredTimeout'] = max(5, min(3600, intval($input['wiredTimeout'] ?? $cfg['wiredTimeout'])));
        $cfg['pollInterval'] = max(10, min(600, intval($input['pollInterval'] ?? $cfg['pollInterval'])));
        $cfg['loglevel'] = (($input['loglevel'] ?? $cfg['loglevel']) === 'debug') ? 'debug' : 'info';
        $cfg['mqtt'] = mqtt_from_input($input, $cfg['mqtt'], $errors);

        if ($errors) fail('Bitte Eingaben prüfen', 400, ['fields' => $errors]);

        save_config($cfg);
        if ($old['topic'] !== $cfg['topic'] || $old['summaryTopic'] !== $cfg['summaryTopic'] || !file_exists($subscriptionFile)) {
            write_subscriptions($cfg);
        }

        $token = trim((string) ($input['token'] ?? ''));
        $connChanged = false;
        foreach (['ipaddress', 'port', 'controllerType', 'username', 'password', 'site'] as $f) {
            if ($old[$f] !== $cfg[$f]) $connChanged = true;
        }
        $login = null;
        if ($connChanged || $token !== '' || !empty($input['forceLogin'])) {
            $args = ['login'];
            if ($token !== '') { $args[] = '--token'; $args[] = $token; }
            $login = run_cli($args, 90);
        }
        respond(['ok' => true, 'config' => public_config(load_config()), 'login' => $login]);

    case 'detect':
        $args = ['detect'];
        if (!empty($input['ipaddress'])) { $args[] = '--host'; $args[] = $input['ipaddress']; }
        if (!empty($input['port'])) { $args[] = '--port'; $args[] = $input['port']; }
        respond(run_cli($args, 60));

    case 'sites':
        respond(run_cli(['sites'], 45));

    case 'mqtttest':
        $errors = [];
        $m = mqtt_from_input($input, load_config()['mqtt'], $errors);
        if ($errors) fail('Bitte Eingaben prüfen', 400, ['fields' => $errors]);
        putenv('UPNG_MQTT_TEST=' . json_encode($m));
        respond(run_cli(['mqtttest'], 20));

    case 'clients':
        $res = run_cli(['clients'], 90);
        $cfg = load_config();
        $watched = [];
        foreach ($cfg['clients'] as $c) $watched[strtolower($c['mac'])] = $c;
        if (!empty($res['ok'])) {
            $seen = [];
            foreach ($res['clients'] as &$c) {
                $mac = strtolower($c['mac']);
                $seen[$mac] = true;
                $c['watched'] = isset($watched[$mac]);
                $c['alias'] = isset($watched[$mac]['alias']) ? $watched[$mac]['alias'] : '';
            }
            unset($c);
        } else {
            $res['clients'] = [];
            $seen = [];
        }
        // überwachte Geräte, die der Controller (derzeit) nicht liefert
        foreach ($watched as $mac => $w) {
            if (isset($seen[$mac])) continue;
            $res['clients'][] = [
                'name' => $w['name'] ?? $mac, 'mac' => $mac, 'type' => $w['type'] ?? 'WIRELESS',
                'system' => $w['system'] ?? null, 'online' => false, 'watched' => true,
                'alias' => $w['alias'] ?? '', 'missing' => true,
            ];
        }
        respond($res);

    case 'setclients':
        $list = $input['clients'] ?? null;
        if (!is_array($list)) fail('Ungültige Geräteliste');
        $clean = [];
        foreach ($list as $c) {
            if (!is_array($c)) continue;
            $mac = normalize_mac($c['mac'] ?? '');
            if (!valid_mac($mac) || isset($clean[$mac])) continue;
            $entry = [
                'name' => mb_substr(trim((string) ($c['name'] ?? $mac)), 0, 80) ?: $mac,
                'mac' => $mac,
                'type' => (($c['type'] ?? '') === 'WIRED') ? 'WIRED' : 'WIRELESS',
            ];
            $alias = mb_substr(trim((string) ($c['alias'] ?? '')), 0, 80);
            if ($alias !== '') $entry['alias'] = $alias;
            if (!empty($c['system'])) $entry['system'] = mb_substr((string) $c['system'], 0, 80);
            if (!empty($c['userId'])) $entry['userId'] = mb_substr((string) $c['userId'], 0, 64);
            if (array_key_exists('person', $c) && $c['person'] !== null && $c['person'] !== '') {
                $entry['person'] = filter_var($c['person'], FILTER_VALIDATE_BOOLEAN);
            }
            $group = trim(preg_replace('/[^\p{L}\p{N} _,\-]/u', '', (string) ($c['group'] ?? '')));
            if ($group !== '') $entry['group'] = mb_substr($group, 0, 60);
            $clean[$mac] = $entry;
        }
        $cfg = load_config();
        $cfg['clients'] = array_values($clean);
        save_config($cfg);
        respond(['ok' => true, 'clients' => $cfg['clients']]);

    case 'restart':
        $res = service('restart');
        respond(['ok' => $res['rc'] == 0, 'output' => $res['output']]);

    case 'update':
        $cacheFile = $dirs['data'] . '/update.json';
        $cache = read_json_file($cacheFile);
        if (!$cache || empty($cache['checked']) || time() - $cache['checked'] > 6 * 3600 || !empty($input['force'])) {
            $cache = ['checked' => time(), 'release' => fetch_release_cfg(UPNG_RELEASE_CFG),
                      'prerelease' => fetch_release_cfg(UPNG_PRERELEASE_CFG)];
            @file_put_contents($cacheFile, json_encode($cache));
        }
        $rel = $cache['release'];
        $pre = $cache['prerelease'];
        respond([
            'ok' => true, 'current' => UPNG_VERSION, 'checked' => $cache['checked'],
            'release' => $rel, 'prerelease' => $pre,
            'newRelease' => $rel && version_compare($rel['version'], UPNG_VERSION, '>'),
            'newPrerelease' => $pre && version_compare($pre['version'], UPNG_VERSION, '>')
                && (!$rel || version_compare($pre['version'], $rel['version'], '>')),
        ]);

    case 'backup':
        $pw = (string) ($input['password'] ?? '');
        if (mb_strlen($pw) < 8) fail('Das Passwort muss mindestens 8 Zeichen haben', 400, ['fields' => ['backupPassword' => 1]]);
        if (!function_exists('openssl_encrypt')) fail('PHP-OpenSSL ist nicht verfügbar', 500);
        $plain = json_encode(load_config(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $salt = random_bytes(16);
        $iv = random_bytes(12);
        $tag = '';
        $enc = openssl_encrypt($plain, 'aes-256-gcm', backup_key($pw, $salt, UPNG_BACKUP_ITER), OPENSSL_RAW_DATA,
                               $iv, $tag, UPNG_BACKUP_FORMAT);
        if ($enc === false) fail('Verschlüsselung fehlgeschlagen', 500);
        respond(['ok' => true, 'filename' => 'unifi-presenceng-' . date('Y-m-d') . '.upng', 'backup' => [
            'format' => UPNG_BACKUP_FORMAT, 'version' => 1, 'plugin' => UPNG_VERSION, 'created' => date('c'),
            'cipher' => 'aes-256-gcm', 'kdf' => 'pbkdf2-sha256', 'iterations' => UPNG_BACKUP_ITER,
            'salt' => base64_encode($salt), 'iv' => base64_encode($iv), 'tag' => base64_encode($tag),
            'data' => base64_encode($enc),
        ]]);

    case 'restore':
        $b = json_decode((string) ($input['file'] ?? ''), true);
        if (!is_array($b) || ($b['format'] ?? '') !== UPNG_BACKUP_FORMAT || ($b['cipher'] ?? '') !== 'aes-256-gcm') {
            fail('Das ist keine Sicherung von Unifi-PresenceNG', 400, ['fields' => ['backupFile' => 1]]);
        }
        $iter = max(10000, min(2000000, intval($b['iterations'] ?? UPNG_BACKUP_ITER)));
        $plain = openssl_decrypt(base64_decode($b['data'] ?? ''), 'aes-256-gcm',
                                 backup_key((string) ($input['password'] ?? ''), base64_decode($b['salt'] ?? ''), $iter),
                                 OPENSSL_RAW_DATA, base64_decode($b['iv'] ?? ''), base64_decode($b['tag'] ?? ''),
                                 UPNG_BACKUP_FORMAT);
        $restored = $plain === false ? null : json_decode($plain, true);
        if (!is_array($restored)) fail('Falsches Passwort oder beschädigte Datei', 400, ['fields' => ['backupPassword' => 1]]);
        $preview = [
            'created' => $b['created'] ?? null, 'plugin' => $b['plugin'] ?? null,
            'ipaddress' => $restored['ipaddress'] ?? '', 'username' => $restored['username'] ?? '',
            'clients' => is_array($restored['clients'] ?? null) ? count($restored['clients']) : 0,
            'mqtt' => ($restored['mqtt']['mode'] ?? 'loxberry') === 'custom' ? ($restored['mqtt']['host'] ?? '') : 'LoxBerry',
            'topic' => $restored['topic'] ?? '',
        ];
        if (empty($input['apply'])) respond(['ok' => true, 'preview' => $preview]);
        unset($restored['native']);
        $cfg = array_merge($defaults, array_intersect_key($restored, $defaults));
        $cfg['mqtt'] = array_merge($defaults['mqtt'], is_array($restored['mqtt'] ?? null) ? $restored['mqtt'] : []);
        save_config($cfg);
        write_subscriptions($cfg);
        @unlink($dirs['data'] . '/session.json');
        $res = service('restart');
        respond(['ok' => true, 'preview' => $preview, 'restarted' => $res['rc'] == 0]);

    case 'log':
        $lines = [];
        if (is_readable($logFile)) {
            $all = file($logFile, FILE_IGNORE_NEW_LINES);
            $lines = array_slice($all, -400);
        }
        respond(['ok' => true, 'file' => $logFile, 'lines' => $lines]);

    default:
        fail('Unbekannte Aktion');
}
