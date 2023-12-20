#!/home/koha/.bun/bin/bun
import assert from "assert";
import { Transform } from "stream";
import * as util from "util";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import localizedFormat from "dayjs/plugin/localizedFormat";
import relativeTime from "dayjs/plugin/relativeTime";
//import duration from "dayjs/plugin/duration";
import "dayjs/locale/pl";
dayjs.extend(utc);
dayjs.extend(localizedFormat);
dayjs.extend(relativeTime);
//dayjs.extend(duration);
dayjs.locale("pl");
import config, { getNukatLibrarySymbolLwr } from "./config";
import { mysqlEnd, mysql_connection } from "./mysql";
import { ftpClient, ftpConnect, ftpDisconnect } from "./ftp";
import { emailTransporter, getEmailFrom, getEmailTo } from "./email";


interface SobotaComparisonResults {
    missingInOurs: string[];
    outdatedOurs: string[];
    missingInTheirs: string[];
}

interface AuthComparisonResults {
    extraInOurs: string[];
    missingInOurs: string[];
}

interface MarcComparisonOutdatedResult {
    controlid: string;
    moddate: string;
    ourdate: string;
}

function onlyUnique(value: any, index: number, array: any[]) {
    return array.indexOf(value) === index;
}

function compareBibFiles(theirs: string[], ours: string[]): SobotaComparisonResults {
    console.log("Porównywanie plików sobota...");
    const remapToArr = (file: string[]): [string, string][] => file.map(l => {
        const r = /^(.*) ([0-9]{6})$/.exec(l);
        assert(r && r[1] && r[2], `Failed regex for line: "${l}"`);
        return [r[1], r[2]];
    });
    
    const theirs_arr = remapToArr(theirs);
    const ours_arr = remapToArr(ours);

    const ret: SobotaComparisonResults = {
        missingInOurs: [],
        outdatedOurs: [],
        missingInTheirs: [],
    }

    for (const [theirs_control, theirs_date] of theirs_arr) {
        const ours_record = ours_arr.find(r => r[0] === theirs_control);
        if (!ours_record) {
            ret.missingInOurs.push(theirs_control);
            continue;
        }
        const ours_date = ours_record[1];
        if (+ours_date < +theirs_date) {
            ret.outdatedOurs.push(theirs_control);
        }
    }

    for (const [ours_control, ours_date] of ours_arr) {
        const theirs_record = theirs_arr.find(r => r[0] === ours_control);
        if (!theirs_record) {
            ret.missingInTheirs.push(ours_control);
            continue;
        }
    }

    return ret;
}

function compareAuthIds(theirAuthControlIds: string[], ourAuthControlIds: string[]): AuthComparisonResults {
    console.log("Porównywanie haseł wzorcowych...");
    const ret: AuthComparisonResults = {
        extraInOurs: [],
        missingInOurs: [],
    };

    for (const theirAuthControlId of theirAuthControlIds) {
        if (!ourAuthControlIds.includes(theirAuthControlId) /*&& !ret.missingInOurs.includes(theirAuthControlId)*/)
            ret.missingInOurs.push(theirAuthControlId);
    }

    for (const ourAuthControlId of ourAuthControlIds) {
        if (!theirAuthControlIds.includes(ourAuthControlId) /*&& !ret.extraInOurs.includes(ourAuthControlId)*/)
            ret.extraInOurs.push(ourAuthControlId);
    }

    ret.extraInOurs = ret.extraInOurs.filter(onlyUnique);
    ret.missingInOurs = ret.missingInOurs.filter(onlyUnique);

    return ret;
}

async function getOurSobota(): Promise<string[]> {
    //const [rows, fields] = await mysql_connection.query("SELECT CONCAT(biblioitems.lccn, ' ', DATE_FORMAT(GREATEST(biblio.timestamp, biblioitems.timestamp), '%y%m%d')) AS a FROM `biblio` LEFT JOIN `biblioitems` on `biblioitems`.`biblionumber` = `biblio`.`biblionumber` WHERE biblioitems.lccn IS NOT NULL AND biblioitems.lccn NOT LIKE '% | %' ORDER BY lccn ASC;");
    const [rows, fields] = await mysql_connection.query("SELECT CONCAT(ExtractValue(`biblio_metadata`.`metadata`, '//datafield[@tag=035]/subfield[@code=\"a\"]'), ' ', DATE_FORMAT(GREATEST(biblio.timestamp, biblioitems.timestamp, biblio_metadata.timestamp), '%y%m%d')) AS a FROM `biblio` LEFT JOIN `biblioitems` on `biblioitems`.`biblionumber` = `biblio`.`biblionumber` LEFT JOIN `biblio_metadata` on `biblio_metadata`.`biblionumber` = `biblio`.`biblionumber` WHERE ExtractValue(`biblio_metadata`.`metadata`, '//controlfield[@tag=003]') = 'NUKAT' ORDER BY lccn ASC;");
    return (rows as any[]).map((r: any) => r.a as string);
}

async function getOurBibControlIds(): Promise<string[]> {
    //const [rows, fields] = await mysql_connection.query("SELECT biblioitems.lccn AS a FROM `biblio` LEFT JOIN `biblioitems` on `biblioitems`.`biblionumber` = `biblio`.`biblionumber` WHERE biblioitems.lccn IS NOT NULL AND biblioitems.lccn NOT LIKE '% | %' ORDER BY lccn ASC;");
    const [rows, fields] = await mysql_connection.query("SELECT ExtractValue(`biblio_metadata`.`metadata`, '//datafield[@tag=035]/subfield[@code=\"a\"]') AS a FROM `biblio` LEFT JOIN `biblioitems` on `biblioitems`.`biblionumber` = `biblio`.`biblionumber` LEFT JOIN `biblio_metadata` on `biblio_metadata`.`biblionumber` = `biblio`.`biblionumber` WHERE ExtractValue(`biblio_metadata`.`metadata`, '//controlfield[@tag=003]') = 'NUKAT' ORDER BY lccn ASC;");
    return (rows as any[]).map((r: any) => r.a as string);
}

async function getBibsWith009(): Promise<string[]> {
    const [rows, fields] = await mysql_connection.query("SELECT ExtractValue(`biblio_metadata`.`metadata`, '//datafield[@tag=035]/subfield[@code=\"a\"]') AS a FROM `biblio` LEFT JOIN `biblioitems` on `biblioitems`.`biblionumber` = `biblio`.`biblionumber` LEFT JOIN `biblio_metadata` on `biblio_metadata`.`biblionumber` = `biblio`.`biblionumber`"
        + " WHERE ExtractValue(`biblio_metadata`.`metadata`, '//controlfield[@tag=003]') = 'NUKAT'"
        + " AND `biblio_metadata`.`metadata` LIKE '%tag=\"009\"%'"
        + " AND ExtractValue(`biblio_metadata`.`metadata`, '//controlfield[@tag=009]') LIKE '%uzbazy%'"
        + " ORDER BY lccn ASC;");
    return (rows as any[]).map((r: any) => r.a as string);
}

async function getDuplicatedBibs(): Promise<{ controlid: string; count: string; }[]> {
    const [rows, fields] = await mysql_connection.query("SELECT ExtractValue(`biblio_metadata`.`metadata`, '//datafield[@tag=035]/subfield[@code=\"a\"]') AS controlid, count(*) as count FROM `biblio` LEFT JOIN `biblioitems` on `biblioitems`.`biblionumber` = `biblio`.`biblionumber` LEFT JOIN `biblio_metadata` on `biblio_metadata`.`biblionumber` = `biblio`.`biblionumber` WHERE ExtractValue(`biblio_metadata`.`metadata`, '//controlfield[@tag=003]') = 'NUKAT' GROUP BY controlid HAVING count(*) > 1 ORDER BY lccn ASC;");
    return rows as { controlid: string; count: string; }[];
}

async function getDuplicatedAuths(): Promise<{ controlid: string; count: string; }[]> {
    const [rows, fields] = await mysql_connection.query("SELECT ExtractValue(marcxml, '//datafield[@tag=010]/subfield[@code=\"a\"]') AS controlid, count(*) as count FROM `auth_header` GROUP BY controlid HAVING count(*) > 1 ORDER BY count DESC");
    return rows as { controlid: string; count: string; }[];
}

async function getBibsWithMultipleTypes(): Promise<string[]> {
    const [rows, fields] = await mysql_connection.query("SELECT ExtractValue(`biblio_metadata`.`metadata`, '//datafield[@tag=035]/subfield[@code=\"a\"]') AS controlid FROM `biblio` LEFT JOIN `biblioitems` on `biblioitems`.`biblionumber` = `biblio`.`biblionumber` LEFT JOIN `biblio_metadata` on `biblio_metadata`.`biblionumber` = `biblio`.`biblionumber` WHERE `biblioitems`.`itemtype` LIKE '%|%' ORDER BY lccn ASC;");
    return (rows as any[]).map((r: any) => r.controlid as string);
}

async function getBibsWithNoType(): Promise<string[]> {
    const [rows, fields] = await mysql_connection.query("SELECT ExtractValue(`biblio_metadata`.`metadata`, '//datafield[@tag=035]/subfield[@code=\"a\"]') AS controlid FROM `biblio` LEFT JOIN `biblioitems` on `biblioitems`.`biblionumber` = `biblio`.`biblionumber` LEFT JOIN `biblio_metadata` on `biblio_metadata`.`biblionumber` = `biblio`.`biblionumber` WHERE `biblioitems`.`itemtype` IS NULL OR `biblioitems`.`itemtype` = '' ORDER BY lccn ASC;");
    return (rows as any[]).map((r: any) => r.controlid as string);
}

async function getOurAuthControlIds(): Promise<string[]> {
    console.log("Pobieranie naszych haseł wzorcowych...");
    //const [rows, fields] = await mysql_connection.query(`SELECT authid, REGEXP_REPLACE(REGEXP_SUBSTR(marcxml, '<datafield tag="010" ind1=" " ind2=" ">[ \\n]*<subfield code="a">([^<]+)<\\/subfield>[ \\n]*<\\/datafield>'), '<datafield tag="010" ind1=" " ind2=" ">[ \\n]*<subfield code="a">([^<]+)<\\/subfield>[ \\n]*<\\/datafield>', '\\\\1') AS controlid FROM auth_header;`);
    const [rows, fields] = await mysql_connection.query(`SELECT authid, ExtractValue(marcxml, '//datafield[@tag=010]/subfield[@code="a"]') AS controlid FROM auth_header;`);
    // WHERE ExtractValue(marcxml, '//controlfield[@tag=003]') = 'NUKAT' -- brak pola 003 NUKAT w rekordach...
    const ret = (rows as any[]).map((r: any) => r.controlid as string).filter(onlyUnique).filter((c: string) => c);
    console.log(`Pobrano ${ret.length} haseł wzorcowych z naszej bazy danych`);
    return ret;
}

async function getOurAuthControlIdsToModificationDate(): Promise<{ [controlid: string]: string }> {
    console.log("Pobieranie naszych haseł wzorcowych (z ostatnią datą modyfikacji)...");
    const [rows, fields] = await mysql_connection.query(`SELECT authid, ExtractValue(marcxml, '//datafield[@tag=010]/subfield[@code="a"]') AS controlid, DATE_FORMAT(modification_time, '%y%m%d') AS date FROM auth_header GROUP BY controlid;`);
    // WHERE ExtractValue(marcxml, '//controlfield[@tag=003]') = 'NUKAT' -- brak pola 003 NUKAT w rekordach...
    const ret = (rows as any[]).reduce((accum: any, row: { authid: string; controlid: string; date: string; }) => {
        accum[row.controlid] = row.date;
        return accum;
    }, {})
    console.log(`Pobrano ${Object.keys(ret).length} haseł wzorcowych z naszej bazy danych`);
    return ret;
}

async function getOurBibControlIdsToModificationDate(): Promise<{ [controlid: string]: string }> {
    console.log("Pobieranie naszych rekordów bibliograficznych (z ostatnią datą modyfikacji)...");
    const [rows, fields] = await mysql_connection.query("SELECT ExtractValue(`biblio_metadata`.`metadata`, '//datafield[@tag=035]/subfield[@code=\"a\"]') AS controlid, DATE_FORMAT(GREATEST(biblio.timestamp, biblioitems.timestamp, biblio_metadata.timestamp), '%y%m%d') AS date FROM `biblio` LEFT JOIN `biblioitems` on `biblioitems`.`biblionumber` = `biblio`.`biblionumber` LEFT JOIN `biblio_metadata` on `biblio_metadata`.`biblionumber` = `biblio`.`biblionumber` WHERE ExtractValue(`biblio_metadata`.`metadata`, '//controlfield[@tag=003]') = 'NUKAT'");
    const ret = (rows as any[]).reduce((accum: any, row: { controlid: string; date: string; }) => {
        accum[row.controlid] = row.date;
        return accum;
    }, {})
    console.log(`Pobrano ${Object.keys(ret).length} haseł wzorcowych z naszej bazy danych`);
    return ret;
}

function ftpParseRawDate(raw: string): dayjs.Dayjs { // -.-
    // [ "Feb 02 2016", "Mar 18 2015" ]
    // [ "Oct 21 09:52", "Oct 21 09:52", "Oct 21 09:53", "Oct 21 09:53", "Oct 21 09:53", "Oct 21 09:53", "Oct 21 07:54" ]
    if (Number.isNaN(parseInt(raw)))
        raw = dayjs().year() + " " + raw;
    return dayjs(raw).utc(true).local(); // is it in UTC though?
}

async function getTheirNewSobotas(): Promise<{ [filename: string]: { text: string; date: dayjs.Dayjs; } }> {
    await ftpConnect("nukat");
    const ftp = ftpClient["nukat"];
    const files = await ftp.list("sobota/");

    const nukatLibSymb = await getNukatLibrarySymbolLwr();
    const regex = new RegExp('^' + nukatLibSymb + '[0-9]{6}$');

    const bibFiles = files.filter(f => f.name.match(regex) && f.isFile && f.size).map(f => f.name);
    //console.log({ bibFiles });
    
    const [rows] = await mysql_connection.query("SELECT filename FROM _sobota WHERE filename IN (?)", [bibFiles]);
    const bibFilesAlreadyInDB = (rows as any).map((r: any) => (r as any).filename as string);
    const bibFilesNotInDB = bibFiles.filter(f => !bibFilesAlreadyInDB.includes(f));
    //console.log({ bibFilesNotInDB });
    
    const newSobotas: { [filename: string]: { text: string; date: dayjs.Dayjs; } } = {};
    for (const bibFilename of bibFilesNotInDB) {
        newSobotas[bibFilename] = {
            text: "",
            date: ftpParseRawDate(files.find(f => f.name === bibFilename)?.rawModifiedAt!),
        };
        const transform = new Transform({
            transform(chunk, encoding, callback) {
                newSobotas[bibFilename].text += chunk.toString();
                callback();
            }
        });
        await ftp.downloadTo(transform, "sobota/" + bibFilename);
    }
    
    await ftpDisconnect("nukat");

    return newSobotas;
}

async function getTheirAuthControlIds(bibControlIds: string[]): Promise<string[]> {
    await ftpConnect("nukat");
    const ftp = ftpClient["nukat"];
    const files = await ftp.list("sobota/");
    const authFiles = files.filter(f => f.name.match(/^[0-9]{8}\.bib_(?:.+)$/) && f.isFile && f.size).map(f => f.name);
    
    let expectedAuthIds: string[] = [];
    const bibControlIdsSet: Set<string> = new Set(bibControlIds);

    for (const authFilename of authFiles) {
        console.log(`Analizowanie pliku ${authFilename}...`);
        let text = "";
        let lines = 0;
        let matching = 0;
        const transform = new Transform({
            transform(chunk, encoding, callback) {
                text += chunk.toString();

                const split = text.split("\n");
                text = split.pop() + "";
                if (split.length) {
                    for (const line of split) {
                        lines++;
                        const linesplit = line.trim().split("#");
                        const bibId = linesplit[0];
                        const authId = linesplit[1];
                        if (bibControlIdsSet.has(bibId) /*&& !expectedAuthIds.includes(authId)*/) {
                            //console.log({ bibId, authId });
                            matching++;
                            expectedAuthIds.push(authId);
                        }
                        if ((lines % 500000) == 0)
                            console.log(`[${authFilename}] Progress = lines:${lines} matching:${matching}`);
                    }
                }

                callback();
            }
        });
        await ftp.downloadTo(transform, "sobota/" + authFilename);
        console.log(`Przeanalizowano plik ${authFilename}... (haseł wzorcowych: ${lines}, dopasowanych: ${matching})`);
    }
    
    await ftpDisconnect("nukat");

    return [...new Set(expectedAuthIds)];
}

async function getOutdatedAuthControlIds(ourControlIdsToModDate: { [controlid: string]: string }): Promise<MarcComparisonOutdatedResult[]> {
    const row_regex = / ([0-9]+)    ([A-Za-z0-9 ]+)    ([0-9]{6})    ([0-9]{6})/;

    await ftpConnect("ftpuser");
    const ftp = ftpClient["ftpuser"];
    const files = await ftp.list();
    const controlFileName = files.filter(f => f.name.match(/^kontrolny[0-9]{6}$/) && f.isFile && f.size).map(f => f.name).sort().pop()!;

    const outdated: MarcComparisonOutdatedResult[] = [];

    console.log(`Analizowanie pliku ${controlFileName}...`);
    let text = "";
    let lines = 0;
    let matching = 0;
    const transform = new Transform({
        transform(chunk, encoding, callback) {
            text += chunk.toString();

            const split = text.split("\n");
            text = split.pop() + "";
            if (split.length) {
                for (const line of split) {
                    lines++;
                    const m = row_regex.exec(line);
                    if (!m)
                        continue;
                    const controlid = m[2];
                    const moddate = m[4];
                    let ourdate: string | undefined = undefined;
                    if (ourdate = ourControlIdsToModDate[controlid]) {
                        const info = { controlid, moddate, ourdate };
                        //console.log(info);
                        matching++;
                        if (ourdate < moddate)
                            outdated.push(info);
                    }
                    if ((lines % 500000) == 0)
                        console.log(`[${controlFileName}] Progress = lines:${lines} matching:${matching}`);
                }
            }

            callback();
        }
    });
    await ftp.downloadTo(transform, controlFileName);
    console.log(`Przeanalizowano plik ${controlFileName}... (haseł wzorcowych: ${lines}, dopasowanych: ${matching}, nieaktualnych: ${outdated.length})`);

    await ftpDisconnect("ftpuser");
    return outdated;
}

async function getOutdatedBibControlIds(ourControlIdsToModDate: { [controlid: string]: string }): Promise<MarcComparisonOutdatedResult[]> {
    const row_regex = / ([0-9]+)    ([A-Za-z0-9 ]+)    ([0-9]{6})    ([0-9]{6}) */;

    await ftpConnect("ftpbibuser");
    const ftp = ftpClient["ftpbibuser"];
    const files = await ftp.list();
    const controlFileName = files.filter(f => f.name.match(/^kontrolnyb[0-9]{6}$/) && f.isFile && f.size).map(f => f.name).sort().pop()!;

    const outdated: MarcComparisonOutdatedResult[] = [];

    console.log(`Analizowanie pliku ${controlFileName}...`);
    let text = "";
    let lines = 0;
    let matching = 0;
    const transform = new Transform({
        transform(chunk, encoding, callback) {
            text += chunk.toString();

            const split = text.split("\n");
            text = split.pop() + "";
            if (split.length) {
                for (const line of split) {
                    lines++;
                    const m = row_regex.exec(line);
                    if (!m)
                        continue;
                    const controlid = m[2];
                    const moddate = m[4];
                    let ourdate: string | undefined = undefined;
                    if (ourdate = ourControlIdsToModDate[controlid]) {
                        const info = { controlid, moddate, ourdate };
                        //console.log(info);
                        matching++;
                        if (ourdate < moddate)
                            outdated.push(info);
                    }
                    if ((lines % 500000) == 0)
                        console.log(`[${controlFileName}] Progress = lines:${lines} matching:${matching}`);
                }
            }

            callback();
        }
    });
    await ftp.downloadTo(transform, controlFileName);
    console.log(`Przeanalizowano plik ${controlFileName}... (rekordów bibliograficznych: ${lines}, dopasowanych: ${matching}, nieaktualnych: ${outdated.length})`);

    await ftpDisconnect("ftpbibuser");
    return outdated;
}

async function insertFilenamesIntoSobotasDB(filenames: string[]) {
    await mysql_connection.query("INSERT INTO _sobota (filename) VALUES (?)", [filenames]);
}

const dateToText = (date: dayjs.Dayjs) => date.locale("pl").format("LLLL");

async function genRaportSobota(): Promise<[string, string[], number]> {
    console.log("Porównywanie naszych rekordów z plikiem sobota...");
    const ourSobotaPromise = getOurSobota();
    const theirNewSobotasPromise = getTheirNewSobotas();
    const ourSobota = await ourSobotaPromise;
    const theirNewSobotas = await theirNewSobotasPromise;

    let raport = "";
    let sumProblems = 0;

    if (Object.keys(theirNewSobotas).length === 0) {
        raport += "UWAGA!!! Brak nowego pliku sobota!";
    }

    /*raport += "====== LEGENDA ======\n";
    raport += "- missingInOurs\t=\tRekordy podpięte w Nukacie, a brakujące w Koha";
    raport += "- outdatedOurs\t=\tRekordy w Koha, które są nieaktualne (data modyfikacji starsza niż w Nukacie)";
    raport += "- missingInTheirs\t=\tRekordy które są w Koha, a nie są podpięte w Nukacie";
    raport += "\n=====================\n";*/

    for (const [filename, theirNewSobotaData] of Object.entries(theirNewSobotas)) {
        const theirNewSobota = theirNewSobotaData.text.split("\n").map(l => l.trim()).filter(l => l);
        raport += `#################################\n`;
        raport += `## Raport z pliku: ${filename}\n`;
        raport += `## stworzonego: ${dateToText(theirNewSobotaData.date)}\n`;
        raport += `#################################\n`;

        raport += `\nLiczba rekordów bibliograficznych w Koha: ${ourSobota.length}\n`;
        raport += `Liczba rekordów bibliograficznych podpiętych w Nukat: ${theirNewSobota.length}\n`;

        const result = compareBibFiles(theirNewSobota, ourSobota);

        raport += `\n== Rekordy podpięte w Nukacie, a brakujące w Koha (${result.missingInOurs.length}) ==\n`;
        if (result.missingInOurs.length) {
            raport += util.inspect(result.missingInOurs, { maxArrayLength: Infinity, sorted: true }) + "\n";
        } else {
            raport += "brak! :)\n";
        }

        raport += `\n== Rekordy w Koha, które są nieaktualne (data modyfikacji starsza niż w Nukacie) (${result.outdatedOurs.length}) ==\n`;
        if (result.outdatedOurs.length) {
            raport += util.inspect(result.outdatedOurs, { maxArrayLength: Infinity, sorted: true }) + "\n";
        } else {
            raport += "brak! :)\n";
        }

        raport += `\n== Rekordy które są w Koha, a nie są podpięte w Nukacie (${result.missingInTheirs.length}) ==\n`;
        if (result.missingInTheirs.length) {
            raport += util.inspect(result.missingInTheirs, { maxArrayLength: Infinity, sorted: true }) + "\n";
        } else {
            raport += "brak! :)\n";
        }

        raport += "\n\n";
        sumProblems += result.missingInOurs.length + result.outdatedOurs.length + result.missingInTheirs.length;
    }

    return [raport, Object.keys(theirNewSobotas), sumProblems];
}

async function genRaportExtraProblems(): Promise<[string, number]> {
    const bibsWith009 = await getBibsWith009();
    const bibsDupl = await getDuplicatedBibs();
    const bibsMultiTypes = await getBibsWithMultipleTypes();
    const bibsNoType = await getBibsWithNoType();
    const authsDupl = await getDuplicatedAuths();

    let raport = "";
    let sumProblems = 0;

    if ([bibsWith009, bibsDupl, bibsMultiTypes, bibsNoType, authsDupl].some(a => a.length)) {
        raport += `#################################\n`;
        raport += `## Dodatkowe problemy w bazie Koha\n`;
        raport += `#################################\n`;
    }

    if (bibsWith009.length) {
        raport += `\n== Rekordy z występującym polem 009, na które prawdopodobnie trzeba zwrócić uwagę (${bibsWith009.length}) ==\n`;
        raport += util.inspect(bibsWith009, { maxArrayLength: Infinity, sorted: true }) + "\n";
        sumProblems += bibsWith009.length;
    }

    if (bibsDupl.length) {
        raport += `\n== Rekordy zduplikowane (${bibsDupl.length}) ==\n`;
        raport += util.inspect(bibsDupl, { maxArrayLength: Infinity, sorted: true }) + "\n";
        sumProblems += bibsDupl.length;
    }

    if (bibsMultiTypes.length) {
        raport += `\n== Rekordy z więcej niż jednym typem [pole 942] (${bibsMultiTypes.length}) ==\n`;
        raport += util.inspect(bibsMultiTypes, { maxArrayLength: Infinity, sorted: true }) + "\n";
        sumProblems += bibsMultiTypes.length;
    }

    if (bibsNoType.length) {
        raport += `\n== Rekordy bez żadnego typu [pole 942] (${bibsNoType.length}) ==\n`;
        raport += util.inspect(bibsNoType, { maxArrayLength: Infinity, sorted: true }) + "\n";
        sumProblems += bibsNoType.length;
    }

    if (authsDupl.length) {
        raport += `\n== Hasła wzorcowe zduplikowane (${authsDupl.length}) ==\n`;
        raport += util.inspect(authsDupl, { maxArrayLength: Infinity, sorted: true }) + "\n";
        sumProblems += authsDupl.length;
    }

    return [raport, sumProblems];
}

async function genRaportAuth(): Promise<[string, number]> {
    console.log("Porównywanie obecności haseł wzorcowych...");
    const ourAuthControlIdsPromise = getOurAuthControlIds();
    const theirAuthControlIdsPromise = getTheirAuthControlIds(await getOurBibControlIds());
    const ourAuthControlIds = await ourAuthControlIdsPromise;
    const theirAuthControlIds = await theirAuthControlIdsPromise;

    let raport = "";
    let sumProblems = 0;

    raport += `\n########################################\n`;
    raport += `## Raport zgodności haseł wzorcowych\n`;
    raport += `########################################\n`;
    raport += `Uwaga, nieprawidłowości bibliograficzne z raportu powyżej (jeśli jakieś są) mogą wpłynąć na poprawność raportu haseł wzorcowych.\n`;

    raport += `\nLiczba haseł wzorcowych w Koha: ${ourAuthControlIds.length}\n`;
    raport += `Liczba haseł wzorcowych wg. Nukata: ${theirAuthControlIds.length}\n`;

    const authComparison = compareAuthIds(theirAuthControlIds, ourAuthControlIds);

    raport += `\n== Hasła wzorcowe, które są w Koha, a nie pasują do żadnych rekordów z Nukata (${authComparison.extraInOurs.length}) ==\n`;
    if (authComparison.extraInOurs.length) {
        raport += util.inspect(authComparison.extraInOurs, { maxArrayLength: Infinity, sorted: true }) + "\n";
    } else {
        raport += "brak! :)\n";
    }

    raport += `\n== Brakujące hasła wzorcowe w Koha (${authComparison.missingInOurs.length}) ==\n`;
    if (authComparison.missingInOurs.length) {
        raport += util.inspect(authComparison.missingInOurs, { maxArrayLength: Infinity, sorted: true }) + "\n";
    } else {
        raport += "brak! :)\n";
    }

    sumProblems += authComparison.extraInOurs.length + authComparison.missingInOurs.length;

    return [raport, sumProblems];
}

async function genRaportAuthDates(): Promise<[string, number]> {
    console.log("Porównywanie dat modyfikacji haseł wzorcowych...");
    const controlIdToDate = await getOurAuthControlIdsToModificationDate();
    const outdated = await getOutdatedAuthControlIds(controlIdToDate);

    let raport = "";
    let sumProblems = 0;

    raport += `\n########################################\n`;
    raport += `## Raport aktualności haseł wzorcowych\n`;
    raport += `########################################\n`;

    raport += `\n== Hasła wzorcowe, które są nieaktualne (${outdated.length}) ==\n`;
    if (outdated.length) {
        raport += util.inspect(outdated, { maxArrayLength: Infinity, sorted: true }) + "\n";
    } else {
        raport += "brak! :)\n";
    }

    return [raport, sumProblems];
}

async function genRaportBibDates(): Promise<[string, number]> {
    console.log("Porównywanie dat modyfikacji rekordów bibliograficznych...");
    const controlIdToDate = await getOurBibControlIdsToModificationDate();
    const outdated = await getOutdatedBibControlIds(controlIdToDate);

    let raport = "";
    let sumProblems = 0;

    raport += `\n########################################\n`;
    raport += `## Raport aktualności rekordów bibliograficznych\n`;
    raport += `########################################\n`;

    raport += `\n== Rekordy bibliograficzne, które są nieaktualne (${outdated.length}) ==\n`;
    if (outdated.length) {
        raport += util.inspect(outdated, { maxArrayLength: Infinity, sorted: true }) + "\n";
    } else {
        raport += "brak! :)\n";
    }

    return [raport, sumProblems];
}

async function performSobotasCheck() {
    let raport = "";
    let sumProblems = 0;

    const startDate = dayjs();
    raport += "Data wygenerowania raportu: " + dateToText(startDate) + "\n\n";

    const [raportBib, filesBib, sumProblemsBib] = await genRaportSobota();
    console.log(raportBib);
    raport += raportBib;
    sumProblems += sumProblemsBib;

    const [raportExtra, sumProblemsExtra] = await genRaportExtraProblems();
    console.log(raportExtra);
    raport += raportExtra;
    sumProblems += sumProblemsExtra;
    
    const [raportAuth, sumProblemsAuth] = await genRaportAuth();
    console.log(raportAuth);
    raport += raportAuth;
    sumProblems += sumProblemsAuth;
    
    const [raportAuthDates, sumProblemsAuthDates] = await genRaportAuthDates();
    console.log(raportAuthDates);
    raport += raportAuthDates;
    sumProblems += sumProblemsAuthDates;

    const [raportBibDates, sumProblemsBibDates] = await genRaportBibDates();
    console.log(raportBibDates);
    raport += raportBibDates;
    sumProblems += sumProblemsBibDates;

    const endDate = dayjs();
    raport += "\nData zakończenia generowania raportu: " + dateToText(endDate) + "\n";
    raport += "Czas generowania raportu: " + dayjs().from(startDate, true) + "\n";

    console.log("Sending e-mail...");
    await emailTransporter.sendMail({
        from: await getEmailFrom(),
        to: await getEmailTo(),
        subject: sumProblems > 0
            ? `[koha-skrypty] Raport z sobotniej kontroli (${sumProblems} problem(y/ów))`
            : `[koha-skrypty] Raport z sobotniej kontroli (brak pliku!!!)`,
        text: raport,
    });
    
    if (filesBib.length) {
        console.log("Inserting new files into database...");
        await insertFilenamesIntoSobotasDB(filesBib);
    }
    console.log("All done!");
}

//const ourSobotaPromise = getOurSobota();
//const ourSobota = await ourSobotaPromise;
//console.log(await getTheirNewSobotas());
await performSobotasCheck();
await mysqlEnd();
