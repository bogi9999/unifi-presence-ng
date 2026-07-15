#!/usr/bin/perl

use CGI;

my $q = CGI->new;
my $plugin = $ENV{'LBPPLUGINDIR'} || 'unifi_presence_ng';

print $q->header(-status => 307, -location => "/admin/plugins/$plugin/index.html");

