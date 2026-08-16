import path from "node:path";
import { startProdServer } from "vinext/server/prod-server";

const port = Number(process.argv[2] || process.env.PORT || 3000);
const host = process.argv[3] || process.env.HOSTNAME || "0.0.0.0";

await startProdServer({
  port,
  host,
  outDir: path.join(process.cwd(), "dist"),
});
