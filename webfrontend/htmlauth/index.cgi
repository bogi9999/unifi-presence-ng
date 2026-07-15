#!/usr/bin/perl

use CGI;
use strict;
use warnings;

my $q = CGI->new;
my $index_file = $ENV{'SCRIPT_FILENAME'} || '';
$index_file =~ s/index\.cgi$/index.html/;

if ($index_file && -f $index_file) {
	if (open my $fh, '<', $index_file) {
		local $/;
		my $content = <$fh>;
		close $fh;
		print $q->header(-type => 'text/html', -charset => 'utf-8');
		print $content;
		exit 0;
	}
}

print $q->header(-status => 307, -location => '/admin/plugins/unifi_presence_ng/index.html');

