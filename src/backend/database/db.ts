import Database, { type Database as DatabaseType } from "better-sqlite3";

export const db: DatabaseType = new Database("./database.db");

db.pragma("foreign_keys = ON");
