import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRazorpayRouter } from './server/razorpayService.ts';

// Configure environment
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// CORS middleware for local development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// JSON body parser
app.use(express.json());

// Mount Razorpay API routes at /api
app.use('/api', createRazorpayRouter());

// Serve static frontend assets if built
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, 'dist');

app.use(express.static(distPath));

// Fallback to index.html for client-side routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  const indexPath = path.resolve(distPath, 'index.html');
  res.sendFile(indexPath, err => {
    if (err) {
      res.status(404).send('Dentiflow Backend Running. Build frontend (npm run build) to serve UI here.');
    }
  });
});

export { app };

// If executed directly via tsx / node, start listening
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`  🦷 Dentiflow Razorpay Server running on http://localhost:${PORT}`);
    console.log(`======================================================`);
    console.log(`  POST /api/create-order   -> Create Razorpay order`);
    console.log(`  POST /api/verify-payment -> Verify Razorpay HMAC signature`);
    console.log(`  GET  /api/health         -> Razorpay health check`);
    console.log(`======================================================\n`);
  });
}
