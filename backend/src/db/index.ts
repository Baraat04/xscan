import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { config } from "../config.js";
import { SCHEMA_SQL } from "./schema.js";

type Row = Record<string, any>;
interface Driver {
  kind: "postgres" | "pglite";
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
}

let driver: Driver | null = null;

async function connectPostgres(url: string): Promise<Driver> {
  const pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 3000 });
  await pool.query("select 1");
  return {
    kind: "postgres",
    query: (sql, params) => pool.query(sql, params as any[]) as any,
    exec: async (sql) => void (await pool.query(sql)),
  };
}

async function connectPglite(dir: string): Promise<Driver> {
  const { PGlite } = await import("@electric-sql/pglite");
  mkdirSync(dir, { recursive: true });
  const db = await PGlite.create(dir);
  return {
    kind: "pglite",
    query: (sql, params) => db.query(sql, params as any[]) as any,
    exec: async (sql) => void (await db.exec(sql)),
  };
}

export async function initDb(): Promise<Driver["kind"]> {
  if (config.databaseUrl) {
    try {
      driver = await connectPostgres(config.databaseUrl);
    } catch (err) {
      console.warn(`[db] Postgres unreachable (${(err as Error).message}); falling back to embedded PGlite`);
    }
  }
  if (!driver) driver = await connectPglite(config.dataDir);
  await driver.exec(SCHEMA_SQL);
  return driver.kind;
}

function d(): Driver {
  if (!driver) throw new Error("Database not initialised");
  return driver;
}

export const db = {
  get kind() {
    return d().kind;
  },
  query: <T extends Row = Row>(sql: string, params?: unknown[]) => d().query<T>(sql, params),
  async one<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T | null> {
    const { rows } = await d().query<T>(sql, params);
    return rows[0] ?? null;
  },
};

export const uuid = () => randomUUID();

export async function audit(action: string, entity: string, entityId: string | null, detail?: unknown) {
  await db.query(
    "INSERT INTO audit_events (id, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5)",
    [uuid(), action, entity, entityId, detail ? JSON.stringify(detail) : null],
  );
}
