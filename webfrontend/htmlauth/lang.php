<?php
/*
 * Unifi-Presence NG – language files for the web interface and ajax.php
 * English is the base, the LoxBerry language is loaded on top of it.
 */

function upng_lang_code()
{
    static $code = null;
    if ($code !== null) return $code;
    $code = getenv('UPNG_LANG') ?: '';
    if ($code === '' && class_exists('LBSystem') && method_exists('LBSystem', 'lblanguage')) {
        $code = (string) LBSystem::lblanguage();
    }
    $code = preg_replace('/[^a-z]/', '', strtolower(substr($code ?: 'en', 0, 2))) ?: 'en';
    return $code;
}

function upng_template_dir()
{
    $home = getenv('LBHOMEDIR') ?: (defined('LBHOMEDIR') ? LBHOMEDIR : dirname(__DIR__, 4));
    return getenv('UPNG_TPLDIR') ?: "$home/templates/plugins/unifi_presenceng";
}

function upng_language()
{
    $L = [];
    foreach (array_unique(['en', upng_lang_code()]) as $code) {
        $file = upng_template_dir() . "/lang/language_$code.ini";
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
