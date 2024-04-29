#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <unistd.h>
#include <cstring>

// g++ import_helper.c -o import_helper -std=c++20
// chown root import_helper
// chmod u+x,g+x,u+s import_helper

char logpath[256];
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

	if (argc >= 4) {
		const char* import_type = argv[1];
		const char* file_type = argv[2];
		const char* path = argv[3];

		if (hasIllegalChars(path) || hasIllegalChars(file_type) || hasIllegalChars(import_type)) {
			fprintf(stderr, "Cannot run when args contain illegal chars\n");
			return 2;
		}

		printf("import_helper START | import_type: %s, file_type: %s, path: %s\n", import_type, file_type, path);

		snprintf(logpath, sizeof(logpath), "/var/tmp/bulkmarcimport_%s", file_type);

		{
			char fulllogpath[256];
			snprintf(fulllogpath, sizeof(fulllogpath), "%s.log", logpath);
			unlink(fulllogpath);
			snprintf(fulllogpath, sizeof(fulllogpath), "%s_raw.log", logpath);
			unlink(fulllogpath);
			snprintf(fulllogpath, sizeof(fulllogpath), "%s.yaml", logpath);
			unlink(fulllogpath);
		}

		if (strcmp(import_type, "test") == 0) {
			printf("It works!\n");
			system("whoami");
		} else if (strcmp(import_type, "bib") == 0) {

			snprintf(cmd, sizeof(cmd), "/usr/sbin/koha-shell biblioteka -c \""
				"/usr/share/koha/bin/migration_tools/bulkmarcimport2.pl"
				" -file \\\"%s\\\""
				" -framework OPRA"
				" -biblios"
				" -l %s.log"
				" -yaml %s.yaml"
				" -update"
				" -match Other-control-number,035a"
				" -filter 999"
				" -filter 952"
				" -v 2"
				"\" | tee %s_raw.log", path, logpath, logpath, logpath);
			printf("[import_helper] Executing: %s\n", cmd);
			system(cmd);

		} else if (strcmp(import_type, "auth_all") == 0) {

			// NOTE: this requires Elasticsearch to work properly. Otherwise LC-card-number index searching doesn't work with Zebra,
			// so you'd have to use Any instead, but that comes with its own set of issues (which caused record duplication))
			snprintf(cmd, sizeof(cmd), "/usr/sbin/koha-shell biblioteka -c \""
				"/usr/share/koha/bin/migration_tools/bulkmarcimport2.pl"
				" -file \\\"%s\\\""
				" -authorities"
				" -l %s.log"
				" -yaml %s.yaml"
				" -all"
				" -match LC-card-number,010a"
				" -v 2"
				"\" | tee %s_raw.log", path, logpath, logpath, logpath);
			printf("[import_helper] Executing: %s\n", cmd);
			system(cmd);

		} else if (strcmp(import_type, "auth_update") == 0) {

			// NOTE: this requires Elasticsearch to work properly. Otherwise LC-card-number index searching doesn't work with Zebra,
			// so you'd have to use Any instead, but that comes with its own set of issues (which caused record duplication))
			snprintf(cmd, sizeof(cmd), "/usr/sbin/koha-shell biblioteka -c \""
				"/usr/share/koha/bin/migration_tools/bulkmarcimport2.pl"
				" -file \\\"%s\\\""
				" -authorities"
				" -l %s.log"
				" -yaml %s.yaml"
				" -update"
				" -match LC-card-number,010a"
				" -v 2"
				"\" | tee %s_raw.log", path, logpath, logpath, logpath);
			printf("[import_helper] Executing: %s\n", cmd);
			system(cmd);

		} else {
			fprintf(stderr, "Invalid import_type: %s\n", import_type);
		}

		printf("import_helper END | import_type: %s, path: %s\n", import_type, path);
	} else {
		fprintf(stderr, "Invalid num of arguments\n");
		return 1;
	}

	return 0;
}
