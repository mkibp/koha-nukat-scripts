// Uzupełnianie numerów OCLC
// z plików z mapowaniem [nr kontrolny nukata] -> (OCoLC)[numer oclc]
// 035a -> 993a

import { Transform } from "stream";
import assert from "assert";
import mysql from "mysql2/promise";
import { mysqlEnd, mysql_connection } from "./mysql";
import { ftpClient, ftpConnect, ftpDisconnect } from "./ftp";
import { getNukatLibrarySymbolLwr } from "./config";
import { kohaApiGetBiblioJSON, kohaApiPutBiblioJSON } from "./koha-api";

/**
 * Return biblio id as NUMBER if it's due for oclc filling in 993a field.
 * Return true if it's already properly set.
 * Return [biblio id number, current OCLC] as ARRAY if the value is WRONG (not matching oclc input param).
 * Return null if such nukat control number was not found.
 * @param nukatControlNr np. aa2002014631
 * @param oclc np. (OCoLC)68735446
 */
async function getBiblioIdForNukatControlIfItDoesntHaveOCLCNumberSet(nukatControlNr: string, oclc: string): Promise<number | true | [number, string] | null> {
    interface Result extends mysql.RowDataPacket {
        biblionumber: string;
        f993a: string;
    };
    //const [rows, fields] = await mysql_connection.query<Result[]>("SELECT biblionumber FROM `biblio_metadata` WHERE ExtractValue(`biblio_metadata`.`metadata`, '//datafield[@tag=035]/subfield[@code=\"a\"]') = ? AND ExtractValue(`biblio_metadata`.`metadata`, '//datafield[@tag=993]/subfield[@code=\"a\"]') != ?;",
    //    [nukatControlNr, oclc]);
    const [rows, fields] = await mysql_connection.query<Result[]>("SELECT biblionumber, ExtractValue(`biblio_metadata`.`metadata`, '//datafield[@tag=993]/subfield[@code=\"a\"]') AS f993a FROM `biblio_metadata` WHERE ExtractValue(`biblio_metadata`.`metadata`, '//datafield[@tag=035]/subfield[@code=\"a\"]') = ?;",
        [nukatControlNr]);

    if (rows.length <= 0)
        return null;
    const biblionumber = +rows[0].biblionumber;
    const f993a = rows[0].f993a;
    if (!f993a)
        return biblionumber;
    if (f993a === oclc)
        return true;
    return [biblionumber, f993a];
}

async function getTheirSobotaOCLCs(): Promise<[string, string][]> {
    await ftpConnect("nukat");
    const ftp = ftpClient["nukat"];
    const files = await ftp.list("sobota/oclc/");

    const nukatLibSymb = await getNukatLibrarySymbolLwr();
    const regex = new RegExp('^' + nukatLibSymb + '[0-9]{6}$');

    const oclcFiles = files.filter(f => f.name.match(regex) && f.isFile && f.size).map(f => f.name);
    
    const oclcSets: [string, string][] = [];

    for (const oclcFilename of oclcFiles) {
        console.log(`Analizowanie pliku ${oclcFilename}...`);
        let text = "";
        let lines = 0;
        const transform = new Transform({
            transform(chunk, encoding, callback) {
                text += chunk.toString();

                const split = text.split("\n");
                text = split.pop() + "";
                if (split.length) {
                    for (const line of split) {
                        lines++;
                        const linesplit = line.trim().split(" ");
                        const nukatControlNr = linesplit[0];
                        const oclc = linesplit[1];
                        oclcSets.push([ nukatControlNr, oclc ]);
                        if ((lines % 500000) == 0)
                            console.log(`[${oclcFilename}] Progress = lines:${lines}`);
                    }
                }

                callback();
            }
        });
        await ftp.downloadTo(transform, "sobota/oclc/" + oclcFilename);
        console.log(`Przeanalizowano plik ${oclcFilename}... (pozycji: ${lines})`);
    }
    
    await ftpDisconnect("nukat");

    return oclcSets;
}

interface OCLCComparisonAndProcessingResults {
    alreadyOkCount: number;
    failedUpdateCount: number;
    addedNew: [string, string][]; // control, oclc
    fixedWrong: [string, string, string][];  // control, oldWrongOclc, newCorrectOCLC
    missingBiblio: string[];
}

async function compareAndProcessOCLCs(oclcSets: [string, string][]): Promise<OCLCComparisonAndProcessingResults> {
    const results: OCLCComparisonAndProcessingResults = {
        alreadyOkCount: 0,
        failedUpdateCount: 0,
        addedNew: [],
        fixedWrong: [],
        missingBiblio: [],
    };

    for (const [nukatControlNr, oclc] of oclcSets) {
        const result = await getBiblioIdForNukatControlIfItDoesntHaveOCLCNumberSet(nukatControlNr, oclc);

        if (result === true) {
            // already ok
            results.alreadyOkCount++;
            continue;
        } else if (result === null) {
            results.missingBiblio.push(nukatControlNr);
            continue;
        }

        let biblionumber = 0;
        let oldWrongOclc = "";
        //[biblionumber, f993a]
        if (Array.isArray(result)) {
            biblionumber = result[0];
            oldWrongOclc = result[1];
        } else if (typeof result === "number")
            biblionumber = result;


        // update the OCLC
        try {
            console.log(`[OCLC] Updating [${biblionumber}] ${nukatControlNr} => ${oclc}`);
            const record = await kohaApiGetBiblioJSON(biblionumber);
            const recordNukatControlNr = record.fields?.find(f => "035" in f)?.["035"].subfields?.find(s => "a" in s && !(s.a+"").includes("("))?.a;
            assert(recordNukatControlNr === nukatControlNr);
            
            //record.fields = record.fields.filter(f => !("993" in f));
            const has_993 = record.fields?.some(f => "993" in f);

            if (!has_993) {
                record.fields.push({
                    "993": {
                        ind1: " ",
                        ind2: " ",
                        subfields: [
                            {
                                "a": oclc,
                            },
                        ],
                    },
                });
            } else {
                const f993 = record.fields.find(f => "993" in f)?.["993"];
                assert(f993 !== undefined);
                f993.subfields = f993.subfields.filter(s => !("a" in s) || !s.a.startsWith("(OCoLC)"));
                f993.subfields.push({
                    "a": oclc,
                });
            }
            //console.log(record);

            //console.log("***");
            const editResponse = await kohaApiPutBiblioJSON(biblionumber, record);
            //console.log(editResponse);
            assert(!("error" in editResponse), `Error in editReponse: ${JSON.stringify(editResponse)}`);
            assert(editResponse?.id === biblionumber, `There is no updated biblio ID in the response or its value is different: ${JSON.stringify(editResponse)}`);

            const recordUpdated = await kohaApiGetBiblioJSON(biblionumber);
            const updated_r993a = recordUpdated?.fields?.find(f => "993" in f)?.["993"].subfields?.find(s => "a" in s)?.a;
            const updated_nukatControlNr = record.fields?.find(f => "035" in f)?.["035"].subfields?.find(s => "a" in s && !(s.a+"").includes("("))?.a;
            assert(updated_r993a === oclc, `Updated field not found in response, ${JSON.stringify({ updated_r993a, oclc })}`);
            assert(updated_nukatControlNr === nukatControlNr, `Updated field not found in response, ${JSON.stringify({ updated_nukatControlNr, nukatControlNr })}`);
        } catch (e) {
            console.error(`Failed updating OCLC for ${nukatControlNr}: ${e}`);
            results.failedUpdateCount++;
            continue;
        }

        if (Array.isArray(result)) {
            results.fixedWrong.push([nukatControlNr, oldWrongOclc, oclc]);
        } else if (typeof result === "number") {
            results.addedNew.push([nukatControlNr, oclc]);
        }
    }

    return results;
}

export async function genRaportOCLC(): Promise<[string, number]> {
    console.log("Porównywanie zgodności OCLC i uzupełnianie brakujących...");
    const oclcSets = await getTheirSobotaOCLCs();
    //const oclcSets: [string, string][] = [["aa2002014631", "(OCoLC)749134669"]];

    let raport = "";
    let sumProblems = 0;

    raport += `\n########################################\n`;
    raport += `## Raport zgodności OCLC\n`;
    raport += `########################################\n`;

    raport += `\nLiczba rekordów z OCLC wg. Nukata (z symbolem biblioteki): ${oclcSets.length}\n`;

    const results = await compareAndProcessOCLCs(oclcSets);

    raport += `Liczba rekordów w Koha z już ustawionym poprawnym numerem OCLC: ${results.alreadyOkCount}\n`;
    raport += `\nLiczba niepowodzeń aktualizacji: ${results.failedUpdateCount} (powinna wynosić 0, jeśli nie, to należy zajrzeć do szczegółowych logów!)\n`;
    raport += `Liczba brakujących rekordów bibliograficznych: ${results.missingBiblio.length} (jeśli więcej niż 0, najpewniej istnieją rekordy z symbolem w Nukacie, a brakujące w Koha)\n`;

    raport += `\n== Naprawione niepoprawne numery OCLC (${results.fixedWrong.length}) ==\n`;
    if (results.fixedWrong.length) {
        raport += results.fixedWrong.map(([control, old_oclc, new_oclc]) => `${control} - ${old_oclc} => ${new_oclc}`).join("\n") + "\n";
    } else {
        raport += "brak! :)\n";
    }

    raport += `\n== Ustawione nowe numery OCLC (${results.addedNew.length}) ==\n`;
    if (results.addedNew.length) {
        raport += results.addedNew.map(([control, oclc]) => `${control} => ${oclc}`).join("\n") + "\n";
    } else {
        raport += "brak! :)\n";
    }

    sumProblems += results.failedUpdateCount + results.missingBiblio.length + results.fixedWrong.length;

    return [raport, sumProblems];
}

//const [raport, sumProblems] = await genRaportOCLC();
//console.log(raport);
