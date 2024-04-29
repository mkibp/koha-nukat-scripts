import fs from "fs";
import assert from "assert";
import xmlConvert from "xml-js";
import mysql from "mysql2/promise";

const kohaconf = xmlConvert.xml2js(fs.readFileSync("/etc/koha/sites/biblioteka/koha-conf.xml", "utf-8"), { compact: true, trim: true });
const koha_config = (kohaconf as any).yazgfs.config;

assert(koha_config.db_scheme._text === "mysql");

const config_db = {
    hostname: koha_config.hostname._text,
    port: +koha_config.port._text,
    database: koha_config.database._text,
    user: koha_config.user._text,
    pass: koha_config.pass._text,
};

//console.log(config_db);

export const mysql_connection = await mysql.createConnection({
    //host: config_db.hostname === "localhost" ? "127.0.0.1" : config_db.hostname,
    //host: config_db.hostname === "localhost" ? "/var/run/mysqld/mysqld.sock" : config_db.hostname,
    host: config_db.hostname,
    socketPath: "/var/run/mysqld/mysqld.sock",
    port: config_db.port,
    database: config_db.database,
    user: config_db.user,
    password: config_db.pass,
});

export function mysqlEnd() {
    return mysql_connection.end();
}
