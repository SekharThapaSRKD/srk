import dotenv from "dotenv";
dotenv.config();
import { app } from "./app";
import connectDB from "./config/database";
import { env, validateEnv } from "./config/env";
import { startEventLoopMonitor } from "./utils/perfMonitor";


async function startServer() {
  console.log("[STARTUP] Starting SRK Backend Server...");

  try {
    validateEnv();
  } catch (error) {
    console.error("[STARTUP] ✗ Startup validation failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }

  console.log("[STARTUP] Environment:", env.NODE_ENV || "development");
  console.log("[STARTUP] Port:", Number(env.PORT || 8080));
  console.log("[STARTUP] Database name:", env.DATABASE_NAME || '(default)');
  console.log("[STARTUP] R2 prefix folder:", env.R2_PREFIX_FOLDER);

  try {
    console.log("[DATABASE] Attempting to connect to MongoDB...");
    await connectDB();
    console.log("[DATABASE] ✓ Connected to MongoDB successfully");
  } catch (error) {
    console.error("[DATABASE] ✗ Failed to connect to MongoDB:", error instanceof Error ? error.message : error);
    console.error("[DATABASE] Continuing server startup - will retry connection on demand");
  }

  const PORT = Number(env.PORT || 4000);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SERVER] ✓ Server running on http://0.0.0.0:${PORT}`);
    console.log(`[SERVER] ✓ Health check available at http://0.0.0.0:${PORT}/health`);
    startEventLoopMonitor();
  });

  // Handle unhandled rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[ERROR] Unhandled Rejection at:', promise, 'reason:', reason);
  });

  process.on('uncaughtException', (error) => {
    console.error('[ERROR] Uncaught Exception:', error);
  });
}

console.log("[STARTUP] Process ID:", process.pid);
console.log("[STARTUP] Node version:", process.version);
startServer();
