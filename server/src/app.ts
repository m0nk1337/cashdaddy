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

  app.use('/api/offerwalls', express.json({ limit: '8mb' }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    if (req.path === '/' || req.path === '/health') return next();
    const start = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });

  app.get('/', (req: Request, res: Response) => {
    const accept = String(req.headers.accept || '');
    const wantsJson = /application\/json/i.test(accept) && !/text\/html/i.test(accept);
    if (wantsJson) {
      return res.json({ status: 'ok', service: 'gpt-site-api' });
    }
    res.type('html').send(
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<meta name="offerwall-verification" content="6ad6675f1c3d1991930c1da6">' +
        '<title>CashDaddy API</title></head>' +
        '<body><h1>CashDaddy API</h1>' +
        '<p>Server-to-server endpoint for <a href="https://cashdaddy.me">cashdaddy.me</a>.</p>' +
        '</body></html>'
    );
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
