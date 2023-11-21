import * as fs from "fs/promises";
import config, { FTP_USER, getNukatLibrarySymbol } from "./config";
import { mysqlEnd, mysql_connection } from "./mysql";
import { ftpClient, ftpConnect, ftpDisconnect, ftpDownloadToPath } from "./ftp";
import { emailTransporter, getEmailFrom, getEmailTo } from "./email";

// bib = ftpbibuser
// khw_mod = khasla rekordyn ("Khw dla modyfikowanych")
// khw_kop = khasla rekordy ("Khw dla kopiowanych")

type MARC_FILE_TYPE = "bib" | "khw_mod" | "khw_kop";
const MARC_FILE_TYPE_ARR = ["bib", "khw_mod", "khw_kop"];

interface MarcUpdateFile {
    name: string;
    type: MARC_FILE_TYPE;
}

function getPathForMarcUpdateFile(fileinfo: MarcUpdateFile) {
    return `/var/tmp/${fileinfo.type}/${fileinfo.name}`;
}

async function createSubdirs() {
    for (const type of MARC_FILE_TYPE_ARR) {
        const f = `/var/tmp/${type}`;
        if (!await fs.exists(f))
            await fs.mkdir(f);
    }
}

async function getNewMarcUpdates(type: MARC_FILE_TYPE): Promise<MarcUpdateFile[]> {
    console.log(`Getting marc updates for type "${type}"...`);

    const ftpUserForType = {
        bib: "ftpbibuser",
        khw_mod: "khasla",
        khw_kop: "khasla",
    }[type] as FTP_USER;
    await ftpConnect(ftpUserForType);
    const ftp = ftpClient[ftpUserForType];

    let dir: string | undefined = undefined;
    const nukatLibSymb = await getNukatLibrarySymbol();
    if (type === "khw_mod") dir = `rekordyn/${nukatLibSymb}/`;
    if (type === "khw_kop") dir = `rekordy/${nukatLibSymb}/`;
    //if (type.startsWith("khw_")) dir += "ARCHIWUM/10/"; // temp

    const files = await ftp.list(dir);
    const bibFiles = files.filter(f => {
        if (!f.isFile || !f.size)
            return false;
        let day = parseInt(f.name);
        if (type === "bib") {
            const r = /^ubf([0-9]{6})$/.exec(f.name);
            if (r && r[1])
                day = +r[1];
            else
                return false;
        }
        if (day === 0)
            return false;
        return day >= 230000;
    }).map(f => f.name).sort();
    //console.log({ bibFiles });
    
    let bibFilesNotInDB: string[] = [];
    if (bibFiles.length) {
        const query = mysql_connection.format("SELECT filename FROM _marcupdates WHERE filename IN (?)", [bibFiles.map(f => type + "|" + f)]);
        console.log("Executing query: " + query);
        const [rows] = await mysql_connection.query(query);
        const bibFilesAlreadyInDB = (rows as any).map((r: any) => (r as any).filename as string).filter((r: string) => r.startsWith(type + "|")).map((r: string) => r.split("|").pop());
        bibFilesNotInDB = bibFiles.filter(f => !bibFilesAlreadyInDB.includes(f));
        //console.log({ bibFilesNotInDB });
    } else {
        console.log(`No files for type "${type}" after applying filters (${files.length} items in dir before filtering, including folders)`)
        bibFilesNotInDB = bibFiles;
    }

    const updatefiles: MarcUpdateFile[] = bibFilesNotInDB.map(f => {
        return {
            name: f,
            type,
        };
    });
    
    for (const updatefile of updatefiles) {
        const dst = getPathForMarcUpdateFile(updatefile);
        const src = (dir||"") + updatefile.name;
        console.log(`Downloading file "${src}" => "${dst}"`);
        await ftpDownloadToPath(ftp, dst, src);
    }
    
    await ftpDisconnect(ftpUserForType);

    console.log(`Got ${updatefiles.length} new files for type "${type}"`);

    return updatefiles;
}

async function insertFilenamesIntoMarcUpdatesDB(filenames: string[]) {
    await mysql_connection.query("INSERT INTO _marcupdates (filename) VALUES (?)", [filenames]);
}

async function cleanupFilenames(files: MarcUpdateFile[]) {
    for (const file of files) {
        const filepath = getPathForMarcUpdateFile(file);
        if (await fs.exists(filepath)) {
            console.log(`Deleting "${filepath}"`);
            await fs.unlink(filepath);
        } else {
            console.log(`Does not exist: "${filepath}"`);
        }
    }
}

async function importMarcUpdatesToKoha(updates: MarcUpdateFile[]) {
    let raport = "";
    raport += `Zostanie zaimportowanych następująca liczba plików: ${updates.length}\n\n`;
    raport += `Nazwy plików: ${updates.map(u => u.name).join(", ")}\n`;
    raport += `\n#################################################################################\n\n`;
    for (const update of updates) {
        let r = "";
        r += `###################################################\n`;
        r += `## Import pliku: ${update.name} (typ: ${update.type})\n`;
        r += `###################################################\n`;

        //let script = update.type === "bib" ? "import_biblio.sh" : "import_auth.sh";
        //script = import.meta.dir + "/../" + script;
        const helper_cmd = import.meta.dir + "/../import_helper";
        const dateBefore = +new Date();
        const cmdParams = [helper_cmd, update.type === "bib" ? "bib" : "auth", getPathForMarcUpdateFile(update)];
        console.log(`Executing: ${cmdParams.join(" ")}\n`);
        const proc = Bun.spawn(cmdParams);
        const text = await new Response(proc.stdout).text();
        const text_err = await new Response(proc.stderr).text();
        //r += text;
        await proc.exited;
        
        const file = Bun.file(update.type === "bib" ? "/var/tmp/bulkmarcimport.log" : "/var/tmp/bulkmarcimport_auth.log");
        let logtext = await file.text();
        logtext = logtext.split("\n").filter(l => !l.trim().endsWith(";insert;warning : biblio not in database and option -insert not enabled, skipping...")).join("\n");
        if (file.lastModified >= dateBefore) {
            r += logtext + "\n";
            if (!logtext.includes(getPathForMarcUpdateFile(update))) {
                r += "\nSurowy output skryptu:\n" + text + "\n\n";
            }
        } else {
            r += "Brak logu po imporcie??!\n";
        }

        if (text_err)
            r += "\n### stderr:\n" + text_err + "\n###\n";
        
        raport += r;
        console.log(r);
        console.log(text);
        if (text_err && !logtext.includes(getPathForMarcUpdateFile(update))) {
            r += "\n!! Assuming error and not inserting to database!\n";
        } else {
            await insertFilenamesIntoMarcUpdatesDB([update.type + "|" + update.name]);
        }
    }

    if (updates.length > 0) {
        try {
            const file = Bun.file("/var/tmp/raport_dzienny_import.txt");
            const writer = file.writer();
            writer.write(raport);
            await writer.end();
        } catch (e) {}
        console.log("Sending e-mail...");
        await emailTransporter.sendMail({
            from: await getEmailFrom(),
            to: await getEmailTo(),
            subject: `[koha-skrypty] Raport z dziennego importu (${updates.length} plik(i/ów))`,
            text: raport,
        });
    }
}

async function processMarcUpdates() {
    await createSubdirs();

    console.log("Sprawdzanie plików bib...");
    const updatesBibPromise = getNewMarcUpdates("bib");
    const updatesBib = await updatesBibPromise;

    console.log("Sprawdzanie plików khw_mod (khw dla modyfikowanych)...");
    const updatesKhwModPromise = getNewMarcUpdates("khw_mod");
    //await updatesKhwModPromise; // must wait before reusing ftp client above
    const updatesKhwMod = await updatesKhwModPromise;

    console.log("Sprawdzanie plików khw_kop (khw dla kopiowanych)...");
    const updatesKhwKopPromise = getNewMarcUpdates("khw_kop");
    const updatesKhwKop = await updatesKhwKopPromise;

    //console.log({ updatesBib, updatesKhwMod, updatesKhwKop });
    const updatesCombined = [...updatesBib, ...updatesKhwMod, ...updatesKhwKop].sort((a, b) => {
        const date_a = parseInt(/^.*?([0-9]{6,8})$/g.exec(a.name)?.[1] || /^([0-9]{6,8}).*?$/g.exec(a.name)?.[1] || "0");
        const date_b = parseInt(/^.*?([0-9]{6,8})$/g.exec(b.name)?.[1] || /^([0-9]{6,8}).*?$/g.exec(b.name)?.[1] || "0");
        //console.log({ aname: a.name, bname: b.name, date_a, date_b });
        const comp = date_a - date_b;
        if (comp !== 0)
            return comp;
        const order = ["khw_kop", "khw_mod", "bib"];
        const orderSort = order.indexOf(a.type) - order.indexOf(b.type);
        if (orderSort !== 0)
            return orderSort;
        return a.name.localeCompare(b.name);
    });
    console.log("Pliki do wgrania do Koha:");
    console.log(updatesCombined);

    await importMarcUpdatesToKoha(updatesCombined);

    await cleanupFilenames(updatesBib);
    await cleanupFilenames(updatesKhwMod);
    await cleanupFilenames(updatesKhwKop);

    await mysqlEnd();
}

await processMarcUpdates();
