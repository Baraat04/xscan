import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { initDb } from "./db/index.js";
import { api } from "./routes/api.js";
import { attachUser } from "./services/auth.js";
import { purgeSamples, runIngestion } from "./services/ingest.js";

const app = express();
app.disable("x-powered-by");
app.use(helmet());
const origins = config.corsOrigin.split(",");
app.use(cors({ origin: origins, credentials: true }));
// Session cookies are SameSite=Lax; on top of that, writes must come from the app's own origin as JSON.
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const origin = req.headers.origin;
  if ((origin && !origins.includes(origin)) || !String(req.headers["content-type"] ?? "").includes("application/json")) {
    return res.status(403).json({ error: { code: "forbidden", message: "Requests must come from the xscan app." } });
  }
  next();
});
app.use(express.json({ limit: "400kb" }));
app.use(attachUser);
app.use("/api/v1", api);
app.use((_req, res) => res.status(404).json({ error: { code: "not_found", message: "No such route" } }));
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[http]", err);
  res.status(500).json({ error: { code: "internal", message: "Unexpected server error" } });
});

const kind = await initDb();
const purged = await purgeSamples();
if (purged) console.log(`[db] removed ${purged} synthetic sample notices`);
app.listen(config.port, () => {
  console.log(`[xscan] api on :${config.port} · db=${kind} · model=${config.meta.model} · llm=${config.meta.apiKey ? "configured" : "MISSING KEY"}`);
  if (process.env.INGEST_ON_BOOT !== "false") {
    void runIngestion({ target: 60 }).then((r) => console.log("[ingest]", JSON.stringify(r))).catch((e) => console.error("[ingest]", e));
  }
});
