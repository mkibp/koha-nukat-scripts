import nodemailer from "nodemailer";
import { mysqlEnd, mysql_connection } from "./mysql";
import config, { getSysPrefsValue } from "./config";

interface KohaSMTPSettings {
    host: string;
    port: string;
    ssl_mode: string;
    user_name: string;
    password: string;
}

async function getKohaSMTPSettings(): Promise<KohaSMTPSettings> {
    const [rows, fields] = await mysql_connection.query("SELECT host, port, ssl_mode, user_name, password FROM smtp_servers WHERE is_default = 1 LIMIT 1");
    return (rows as any)[0] as KohaSMTPSettings;
}

export const kohaSmtpSettings = await getKohaSMTPSettings();

//export function getEmailFrom() { return `${config.email.senderName} <${kohaSmtpSettings.user_name}>`; }
//export function getEmailTo() { return config.email.receiver; }
export async function getEmailFrom() { return `${await getSysPrefsValue("NukatSkrypty_Email_SenderName")} <${kohaSmtpSettings.user_name}>`; }
export async function getEmailTo() { return (await getSysPrefsValue("NukatSkrypty_Email_Receiver")).split(";"); }

const etherealEmailTestSettings = {
    host: "smtp.ethereal.email",
    port: 587,
    auth: {
        user: "...@ethereal.email",
        pass: "..."
    },
};

//export const emailTransporter = nodemailer.createTransport(etherealEmailTestSettings);
export const emailTransporter = nodemailer.createTransport({
    host: kohaSmtpSettings.host,
    port: +kohaSmtpSettings.port,
    secure: kohaSmtpSettings.ssl_mode === "ssl",
    auth: {
        user: kohaSmtpSettings.user_name,
        pass: kohaSmtpSettings.password,
    },
});

export async function emailVerify() {
    console.log("emailVerify...");
    await emailTransporter.verify();
}

async function sendTestMailAndExit() {
    await emailVerify();
    console.log("Sending test mail...");
    await emailTransporter.sendMail({
        //from: `Koha-Scripts <test@test.com>`,
        //to: `Koha-Scripts <test@test.com>`,
        from: await getEmailFrom(),
        to: await getEmailTo(),
        subject: "Test subject",
        text: "Text contents",
    });
    console.log("Sent test email");
    mysqlEnd();
}
//await sendTestMailAndExit();
