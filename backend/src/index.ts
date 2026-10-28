import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { initDb } from "./db/index.js";
import { api } from "./routes/api.js";
import { runIngestion, seedSamples } from "./services/ingest.js";

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: config.corsOrigin.split(",") }));
app.use(express.json({ limit: "100kb" }));
app.use("/api/v1", api);
app.use((_req, res) => res.status(404).json({ error: { code: "not_found", message: "No such route" } }));
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[http]", err);
  res.status(500).json({ error: { code: "internal", message: "Unexpected server error" } });
});

const kind = await initDb();
await seedSamples();
app.listen(config.port, () => {
  console.log(`[xscan] api on :${config.port} · db=${kind} · model=${config.meta.model} · llm=${config.meta.apiKey ? "configured" : "MISSING KEY"}`);
  if (process.env.INGEST_ON_BOOT !== "false") {
    void runIngestion().then((r) => console.log("[ingest]", JSON.stringify(r))).catch((e) => console.error("[ingest]", e));
  }
});
