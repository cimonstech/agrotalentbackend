import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Validate Supabase configuration (but don't create clients yet - they'll be created lazily)
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase configuration. Please set SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

if (!supabaseServiceKey) {
  console.warn('⚠️  SUPABASE_SERVICE_ROLE_KEY not set. Admin operations may not work.');
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Import routes
import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import documentsRoutes from './routes/documents.js';
import jobsRoutes from './routes/jobs.js';
import applicationsRoutes from './routes/applications.js';
import matchesRoutes from './routes/matches.js';
import notificationsRoutes from './routes/notifications.js';
import messagesRoutes from './routes/messages.js';
import trainingRoutes from './routes/training.js';
import dataCollectionRoutes from './routes/data-collection.js';
import statsRoutes from './routes/stats.js';
import adminRoutes from './routes/admin.js';
import contactRoutes from './routes/contact.js';
import placementsRoutes from './routes/placements.js';

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/applications', applicationsRoutes);
app.use('/api/matches', matchesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/training', trainingRoutes);
app.use('/api/data-collection', dataCollectionRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/placements', placementsRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
});

export default app;
