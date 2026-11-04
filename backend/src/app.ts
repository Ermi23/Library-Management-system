import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env, isProd } from './config/env.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { acquisitionsRouter } from './modules/acquisitions/acquisitions.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { branchesRouter } from './modules/branches/branches.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { circulationRouter } from './modules/circulation/circulation.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { finesRouter } from './modules/fines/fines.routes.js';
import { holdsRouter } from './modules/holds/holds.routes.js';
import { inventoryRouter } from './modules/inventory/inventory.routes.js';
import { lookupsRouter } from './modules/lookups/lookups.routes.js';
import { noticesRouter } from './modules/notices/notices.routes.js';
import { opacRouter } from './modules/opac/opac.routes.js';
import { patronsRouter } from './modules/patrons/patrons.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { serialsRouter } from './modules/serials/serials.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { transfersRouter } from './modules/transfers/transfers.routes.js';
import { usersRouter } from './modules/users/users.routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // behind nginx in Docker; needed for correct client IPs in rate limiting
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()), credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(morgan(isProd ? 'combined' : 'dev'));
  app.use(authenticate);

  const api = express.Router();
  api.get('/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });
  api.use('/auth', authRouter);
  api.use('/opac', opacRouter);
  api.use('/settings', settingsRouter);
  api.use('/branches', branchesRouter);
  api.use('/users', usersRouter);
  api.use('/patrons', patronsRouter);
  api.use('/lookups', lookupsRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/catalog', catalogRouter);
  api.use('/circulation', circulationRouter);
  api.use('/holds', holdsRouter);
  api.use('/fines', finesRouter);
  api.use('/transfers', transfersRouter);
  api.use('/inventory', inventoryRouter);
  api.use('/acquisitions', acquisitionsRouter);
  api.use('/serials', serialsRouter);
  api.use('/reports', reportsRouter);
  api.use('/notices', noticesRouter);
  api.use('/audit', auditRouter);

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
