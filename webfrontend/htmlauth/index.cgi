#!/usr/bin/perl

use CGI;
use strict;
use warnings;

use LoxBerry::System;
use LoxBerry::Web;
use LoxBerry::Log;

my $version = LoxBerry::System::pluginversion();
my $plugin = $ENV{'LBPPLUGINDIR'} || 'unifi_presence_ng';
my $log = LoxBerry::Log->new(
		name => 'index',
		package => $lbpplugindir,
		addtime => 1,
);

$log->LOGSTART("index.cgi called");

LoxBerry::Web::lbheader("UniFi Presence NG V$version", "https://github.com/bogi9999/unifi-presence-ng", "");
print LoxBerry::Log::get_notifications_html($lbpplugindir);
print qq{
<div style="height: calc(100vh - 190px); min-height: 620px;">
	<iframe
		title="UniFi Presence NG"
		src="/admin/plugins/$plugin/index.html"
		style="width: 100%; height: 100%; border: 0; background: transparent;"
		loading="eager"
	></iframe>
</div>
};
LoxBerry::Web::lbfooter();

