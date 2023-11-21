import { mysql_connection } from "./mysql";

const sysPrefsCache: { [key: string]: string } = {};

export async function getSysPrefsValue(key: string) {
    if (sysPrefsCache[key])
        return sysPrefsCache[key];
    const [rows, fields] = await mysql_connection.query("SELECT value FROM `systempreferences` WHERE `variable` = ?;", [key]);
    const value = ((rows as any).map((r: any) => r.value as string)[0] as string + "").trim();
    if (value)
        sysPrefsCache[key] = value;
    return value;
}

export const getNukatLibrarySymbol = () => getSysPrefsValue("Nukat_Library_Symbol");
export const getNukatLibrarySymbolLwr = async () => (await getSysPrefsValue("Nukat_Library_Symbol")).toLocaleLowerCase().replace(/_/g, "");

const config = {};

export type FTP_USER = "ftpbibuser" | "ftpbibnowe" | "ftpuser" | "ftpnowe" | "ftpanalit" | "khasla" | "bn" | "nukat";

export default config;
