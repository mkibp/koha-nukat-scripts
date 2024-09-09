import * as fs from "fs/promises";
import { Readable } from "stream";
import config, { getNukatLibrarySymbol, getNukatLibrarySymbolLwr } from "./config";
import { mysqlEnd, mysql_connection } from "./mysql";
import { ftpClient, ftpConnect, ftpDisconnect } from "./ftp";
import { emailTransporter, getEmailFrom, getEmailTo } from "./email";

async function getOurBiblios(): Promise<string[]> {
    const [rows, fields] = await mysql_connection.query("SELECT CONCAT(ExtractValue(`biblio_metadata`.`metadata`, '//datafield[@tag=035]/subfield[@code=\"a\"]'), '#', DATE_FORMAT(GREATEST(biblio.timestamp, biblioitems.timestamp, biblio_metadata.timestamp), '%y%m%d')) AS a FROM `biblio` LEFT JOIN `biblioitems` on `biblioitems`.`biblionumber` = `biblio`.`biblionumber` LEFT JOIN `biblio_metadata` on `biblio_metadata`.`biblionumber` = `biblio`.`biblionumber` WHERE ExtractValue(`biblio_metadata`.`metadata`, '//controlfield[@tag=003]') = 'NUKAT' GROUP BY ExtractValue(`biblio_metadata`.`metadata`, '//datafield[@tag=035]/subfield[@code=\"a\"]') ORDER BY lccn ASC;");
    return (rows as any).map((r: any) => r.a as string);
}

async function getOurAuths(): Promise<string[]> {
    const [rows, fields] = await mysql_connection.query(`SELECT CONCAT(ExtractValue(marcxml, '//datafield[@tag=010]/subfield[@code="a"]'), '#', DATE_FORMAT(modification_time, '%y%m%d')) AS a FROM auth_header GROUP BY ExtractValue(marcxml, '//datafield[@tag=010]/subfield[@code="a"]')`);
    // WHERE ExtractValue(marcxml, '//controlfield[@tag=003]') = 'NUKAT' -- brak pola 003 NUKAT w rekordach...
    return (rows as any).map((r: any) => r.a as string);
}

function writeFileTo(path: string, contents: string) {
    const file = Bun.file(path);
    const writer = file.writer();
    writer.write(contents);
    return writer.end();
}

async function performKontrola() {
    const ourBibData = (await getOurBiblios()).join("\n");
    const ourAuthsData = (await getOurAuths()).join("\n");

    if (!await fs.exists("/var/tmp/kontrola"))
        await fs.mkdir("/var/tmp/kontrola");

    const filenameBib = await getNukatLibrarySymbol();
    const filenameAuths = (await getNukatLibrarySymbol()) + "_KHW";

    await writeFileTo("/var/tmp/kontrola/" + filenameBib, ourBibData);
    await writeFileTo("/var/tmp/kontrola/" + filenameAuths, ourAuthsData);

    await ftpConnect("nukat");
    const ftp = ftpClient["nukat"];

    await ftp.uploadFrom(Readable.from(ourBibData), "/symbole/" + filenameBib);
    await ftp.uploadFrom(Readable.from(ourAuthsData), "/symbole/" + filenameAuths);

    await ftpDisconnect("nukat");
}

await performKontrola();
await mysqlEnd();
process.exit();
