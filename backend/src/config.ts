import "dotenv/config";

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v.trim();
}

export const config = {
  port: Number(env("PORT", "4000")),
  corsOrigin: env("CORS_ORIGIN", "http://localhost:3000"),
  databaseUrl: env("DATABASE_URL"),
  dataDir: env("PGLITE_DIR", "./.data/pglite"),
  meta: {
    apiKey: env("META_API_KEY"),
    baseUrl: env("META_BASE_URL", "https://api.meta.ai/v1"),
    model: env("MUSE_MODEL", "muse-spark-1.3"),
    judgeModel: env("MUSE_JUDGE_MODEL", "muse-spark-1.3"),
    timeoutMs: Number(env("MUSE_TIMEOUT_MS", "120000")),
  },
  samApiKey: env("SAM_API_KEY"),
};

export const PROMPT_VERSION = "tribunal-2026.10.1";
