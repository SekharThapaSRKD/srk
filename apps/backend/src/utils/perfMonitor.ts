import { monitorEventLoopDelay } from 'perf_hooks';
import { Request, Response, NextFunction } from 'express';

const SLOW_REQUEST_MS = 1000;
const LOOP_REPORT_INTERVAL_MS = 30_000;

// Logs any request that takes >= 1s. Registered before body parsing so the
// time includes parsing large base64 bodies, and shows up in `pm2 logs` as
// "[SLOW]" so peak-hour problems can be attributed to specific routes.
export const slowRequestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (ms >= SLOW_REQUEST_MS) {
      console.warn(
        `[SLOW] ${req.method} ${req.path} -> ${res.statusCode} in ${Math.round(ms)}ms`
      );
    }
  });
  next();
};

// Reports how long the event loop was blocked and memory use every 30s.
// High lag => Node itself is CPU-bound; low lag with slow requests => the
// database (or another downstream call) is the bottleneck.
export const startEventLoopMonitor = () => {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();

  setInterval(() => {
    const toMs = (ns: number) => Math.round(ns / 1e6);
    const { rss, heapUsed } = process.memoryUsage();
    console.log(
      `[PERF] event-loop lag ms mean=${toMs(histogram.mean)} p99=${toMs(
        histogram.percentile(99)
      )} max=${toMs(histogram.max)} | rss=${Math.round(
        rss / 1048576
      )}MB heapUsed=${Math.round(heapUsed / 1048576)}MB`
    );
    histogram.reset();
  }, LOOP_REPORT_INTERVAL_MS).unref();
};
