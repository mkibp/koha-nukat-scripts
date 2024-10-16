import config, { FTP_USER, getSysPrefsValue } from "./config";

export async function kohaApiRequest(path: string, options: RequestInit = {}) {
    const user = await getSysPrefsValue("NukatSkrypty_API_User");
    const pass = await getSysPrefsValue("NukatSkrypty_API_Pass");

    const optionsFinal: RequestInit = Object.assign({}, options);

    const headers = new Headers(options.headers);
    if (!headers.has("Authorization"))
        headers.set("Authorization", `Basic ${btoa(user + ":" + pass)}`);
    optionsFinal.headers = headers;

    return await fetch("https://biblioteka.botany.pl/api/v1" + path, optionsFinal).then(r => r.text());
}

export interface KohaAPI_MARCinJSON {
    leader: string;
    fields: { [fieldId: string]: {
        ind1: string;
        ind2: string;
        subfields: any[];
    } }[];
};

export async function kohaApiGetBiblioJSON(biblioId: number): Promise<KohaAPI_MARCinJSON> {
    return JSON.parse(await kohaApiRequest("/biblios/" + biblioId, {
        headers: {
            Accept: "application/marc-in-json",
        }
    }));
}

export async function kohaApiPutBiblioJSON(biblioId: number, biblio: KohaAPI_MARCinJSON): Promise<any> {
    return JSON.parse(await kohaApiRequest("/biblios/" + biblioId, {
        headers: {
            "Content-Type": "application/marc-in-json",
            "x-framework-id": await getSysPrefsValue("NukatSkrypty_API_PutBibliosFramework"),
        },
        method: "PUT",
        body: JSON.stringify(biblio),
    }));
}

//console.log(await kohaApiGetBiblioJSON(1));
