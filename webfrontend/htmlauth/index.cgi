#!/usr/bin/perl

use CGI;

my $q = CGI->new;
my $host = $ENV{'HTTP_HOST'} || 'localhost';
$host =~ s/:.*$//;
my $scheme = $ENV{'REQUEST_SCHEME'} || 'http';
my $port = $ENV{'UNIFI_PRESENCE_NG_PORT'} || '3201';

print $q->header(-status => 307, -location => "$scheme://$host:$port/");

