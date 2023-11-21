#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <unistd.h>
#include <cstring>

// g++ import_helper.c -o import_helper -std=c++20
// chown root import_helper
// chmod u+x,g+x,u+s import_helper

char cmd[2048];

bool hasAnyOfTheseChars(const char* s, const char* chars)
{
	const char* cp = chars;
	while (char c = *cp++)
	{
		for (const char* i = s; *i; i++)
		{
			if (*i == c)
				return true;
		}
	}
	return false;
}

bool hasIllegalChars(const char* s)
{
	return hasAnyOfTheseChars(s, "\"\\'(>|<)");
}

int main(int argc, char **argv)
{
	setuid(0);

	if (argc >= 3) {
		const char* type = argv[1];
		const char* path = argv[2];

		if (hasIllegalChars(path) || hasIllegalChars(type)) {
			fprintf(stderr, "Cannot run when args contain illegal chars\n");
			return 2;
		}

		printf("import_helper START | type: %s, path: %s\n", type, path);

		if (strcmp(type, "test") == 0) {
			printf("It works!\n");
			system("whoami");
		} else if (strcmp(type, "bib") == 0) {

			unlink("/var/tmp/bulkmarcimport.log");
			unlink("/var/tmp/bulkmarcimport_raw.log");

			snprintf(cmd, sizeof(cmd), "/usr/sbin/koha-shell biblioteka -c \"/usr/share/koha/bin/migration_tools/bulkmarcimport2.pl -file \\\"%s\\\" -framework OPRA -biblios -l /var/tmp/bulkmarcimport.log -update -match Other-control-number,035a -filter 999 -filter 952 -v 2\" | tee /var/tmp/bulkmarcimport_raw.log", path);
			system(cmd);

		} else if (strcmp(type, "auth_all") == 0) {

			unlink("/var/tmp/bulkmarcimport_auth.log");
			unlink("/var/tmp/bulkmarcimport_auth_raw.log");

			// LC-card-number should work but it doesn't, so we use Any
			snprintf(cmd, sizeof(cmd), "/usr/sbin/koha-shell biblioteka -c \"/usr/share/koha/bin/migration_tools/bulkmarcimport2.pl -file \\\"%s\\\" -authorities -l /var/tmp/bulkmarcimport_auth.log -all -match Any,010a -v 2\" | tee /var/tmp/bulkmarcimport_auth_raw.log", path);
			system(cmd);

		} else if (strcmp(type, "auth_update") == 0) {

			unlink("/var/tmp/bulkmarcimport_auth_update.log");
			unlink("/var/tmp/bulkmarcimport_auth_update_raw.log");

			// LC-card-number should work but it doesn't, so we use Any
			snprintf(cmd, sizeof(cmd), "/usr/sbin/koha-shell biblioteka -c \"/usr/share/koha/bin/migration_tools/bulkmarcimport2.pl -file \\\"%s\\\" -authorities -l /var/tmp/bulkmarcimport_auth_update.log -update -match Any,010a -v 2\" | tee /var/tmp/bulkmarcimport_auth_update_raw.log", path);
			system(cmd);

		} else {
			fprintf(stderr, "Invalid type: %s\n", type);
		}

		printf("import_helper END | type: %s, path: %s\n", type, path);
	} else {
		fprintf(stderr, "Invalid num of arguments\n");
		return 1;
	}

	return 0;
}