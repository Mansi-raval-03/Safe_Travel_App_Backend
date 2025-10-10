const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const connectDB = require('./src/config/database');
const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/user');
const emergencyContactsRoutes = require('./src/routes/emergencyContacts');
const locationRoutes = require('./src/routes/location');
const locationSyncRoutes = require('./src/routes/locationSync');
const sosRoutes = require('./src/routes/sos');
const autoSOSRoutes = require('./src/routes/autoSOS');
const mapRoutes = require('./src/routes/map');
const notificationRoutes = require('./src/routes/notifications');
const otpRoutes = require('./src/routes/otp');
const errorHandler = require('./src/middleware/errorHandler');
const socketHandler = require('./src/services/socketHandler');
const sosMonitoringJob = require('./src/services/sosMonitoringJob');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const PORT = process.env.PORT || 3000;

// Connect to MongoDB
connectDB();

// Initialize Socket.IO handler
socketHandler(io);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 200, // limit each IP to 200 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/v1', limiter);

// Body parsing and compression
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(morgan('combined'));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// API routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/user', userRoutes);
app.use('/api/v1/emergency-contacts', emergencyContactsRoutes);
app.use('/api/v1/location', locationRoutes);
app.use('/api/v1/location', locationSyncRoutes);
app.use('/api/v1/sos', sosRoutes);
app.use('/api/v1/auto-sos', autoSOSRoutes);
app.use('/api/v1/map', mapRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/otp', otpRoutes);

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Start server 
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`API Base URL: http://localhost:${PORT}/api/v1`);
  console.log(`Socket.IO is ready for connections`);
  
  // Start SOS monitoring jobs
  try {
    sosMonitoringJob.startMonitoring();
    console.log('🚨 Auto SOS monitoring system started');
  } catch (error) {
    console.error('❌ Failed to start SOS monitoring:', error);
  }
});

module.exports = { app, server, io };
