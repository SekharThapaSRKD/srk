import express from 'express';
import cors from 'cors';
import { createExpressEndpoints } from '@ts-rest/express';
import * as swaggerUi from 'swagger-ui-express';
import cookieParser from 'cookie-parser';
import swaggerApiDocs from './config/swagger';
// import cronJobInit from './utils/cronjob';
import { router } from './modules';
import ssoRouter from './modules/sso/router';
import { apiContract } from '@srk/shared/contracts';
import { JwtAuthMiddleware } from './utils/middleware';
import { env } from './config/env';
import { slowRequestLogger } from './utils/perfMonitor';

export const app = express();

app.set('trust proxy', 1);

app.use(slowRequestLogger);

// Increase body size limits to allow base64 image uploads from the frontend
app.use(express.json({ limit: '150mb' }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true, limit: '150mb', parameterLimit: 100000 }));

const WHITE_LISTED_ORIGINS = env.WHITE_LISTED_ORIGINS
  ? env.WHITE_LISTED_ORIGINS.split(',')
  : [];

// CORS

console.log('[APP] Whitelisted origins:', WHITE_LISTED_ORIGINS);
console.log('[APP] R2 prefix folder:', env.R2_PREFIX_FOLDER);

// Root endpoint
app.get('/', (req, res) => {
  console.log('[ROOT] Root path requested');
  res.status(200).send('OK');
});

// Health check endpoint - MUST be before CORS for immediate response
app.get('/health', (req, res) => {
  console.log('[HEALTH] Health check requested');
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || WHITE_LISTED_ORIGINS.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true, // Allow cookies to be sent
    // Let browsers cache preflight results for an hour instead of sending an
    // OPTIONS request before nearly every POST (~11k/day on the task app).
    maxAge: 3600,
  })
);

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerApiDocs));

app.use(ssoRouter);

// Apply JWT middleware to protected tour endpoints
app.use('/tour/targets', JwtAuthMiddleware);
// app.use('/tour/active-achievements', JwtAuthMiddleware);

createExpressEndpoints(apiContract, router, app);
// cronJobInit();

export default app;
