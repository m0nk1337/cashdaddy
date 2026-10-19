import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import authRoutes from './routes/auth';
import offerwallRoutes from './routes/offerwalls';
import walletRoutes from './routes/wallet';
import adminRoutes from './routes/admin';
import postbackRoutes from './routes/postbacks';
import gamificationRoutes from './routes/gamification';

export function createApp(): express.Express {
  const app = express();

  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.use(helmet());

  const allowedOrigins = new Set<string>([config.clientUrl]);
  if (config.nodeEnv !== 'production') {
    allowedOrigins.add('http://localhost:3000');
    allowedOrigins.add('http://localhost:3001');
  }
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) callback(null, true);
        else callback(null, false);
      },
    })
  );

  app.use(express.json());

  app.use((req, res, next) => {
    if (req.path === '/' || req.path === '/health') return next();
    const start = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });

  app.get('/', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'gpt-site-api' });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/offerwalls', offerwallRoutes);
  app.use('/api/wallet', walletRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/postback', postbackRoutes);
  app.use('/api/gamification', gamificationRoutes);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
