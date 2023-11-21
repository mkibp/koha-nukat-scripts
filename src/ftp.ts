import * as ftp from "basic-ftp";
import { Transform } from "stream";
import config, { FTP_USER, getSysPrefsValue } from "./config";

export const ftpClient: { [forUser: string]: ftp.Client } = {};

const ftpConnected: { [forUser: string]: boolean } = {};

export async function ftpConnect(user: FTP_USER) {
    if (ftpConnected[user] === true)
        return;
    if (!ftpClient[user])
        ftpClient[user] = new ftp.Client();
    await ftpClient[user].access({
        //host: config.ftp.host,
        host: await getSysPrefsValue("Nukat_FTP_Host"),
        user,
        //password: config.ftp.passwords[user],
        password: await getSysPrefsValue("Nukat_FTP_User_" + user),
        secure: false,
    });
    ftpConnected[user] = true;
}

export async function ftpDisconnect(user: FTP_USER) {
    if (!ftpClient[user])
        return;
    ftpClient[user].close();
    delete ftpClient[user];
    ftpConnected[user] = false;
}

export async function ftpDisconnectAll() {
    for (const user of Object.keys(ftpClient)) {
        ftpDisconnect(user as FTP_USER);
    }
}

export async function ftpDownloadToPath(ftp: ftp.Client, pathTo: string, pathDst: string) {
    const file = Bun.file(pathTo);
    const writer = file.writer();
    const transform = new Transform({
        transform(chunk, encoding, callback) {
            writer.write(chunk);
            callback();
        }
    });
    await ftp.downloadTo(transform, pathDst);
    await writer.end();
}
