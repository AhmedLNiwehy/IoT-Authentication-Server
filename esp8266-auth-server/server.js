/**
 * ESP8266 Authentication Server
 * 
 * ARCHITECTURE:
 * ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
 * │   ESP8266    │─────>│  This Server │─────>│   Firebase   │
 * │  (Device)    │      │   (Node.js)  │      │  (Database)  │
 * └──────────────┘      └──────────────┘      └──────────────┘
 * 
 * FLOW:
 * 1. ESP8266 sends MAC + secret to this server
 * 2. Server verifies credentials in device database
 * 3. Server creates Firebase custom token (using private key)
 * 4. ESP8266 exchanges custom token for ID token (with Google)
 * 5. ESP8266 uses ID token to access Firebase database
 */

// ============================================
// SECTION 1: IMPORT DEPENDENCIES
// ============================================

const express = require('express');
// ↑ Web framework for creating REST APIs
// Alternatives: Koa, Fastify, Hapi
// Why Express? Most popular, lots of middleware, easy to learn

const admin = require('firebase-admin');
// ↑ Firebase Admin SDK
// Purpose: Server-side Firebase operations
// Functions we use: createCustomToken(), verifyIdToken()

const helmet = require('helmet');
// ↑ Security middleware
// Sets HTTP headers like:
// - X-Frame-Options: DENY (prevent clickjacking)
// - X-Content-Type-Options: nosniff (prevent MIME type sniffing)
// - Strict-Transport-Security (force HTTPS)

const rateLimit = require('express-rate-limit');
// ↑ Rate limiting middleware
// Prevents: DDoS attacks, brute force attacks
// How it works: Tracks requests per IP, blocks if over limit

const cors = require('cors');
// ↑ Cross-Origin Resource Sharing
// Allows: Web frontends to call your API
// Example: If you build a web dashboard at https://yourdomain.com,
//          it needs CORS to call your API at https://api.yourdomain.com

require('dotenv').config();
// ↑ Load .env file
// After this line, you can access: process.env.PORT, process.env.SERVER_SECRET, etc.
// MUST be called before accessing any environment variables

// ============================================
// SECTION 2: INITIALIZE EXPRESS
// ============================================

const app = express();
// ↑ Create Express application instance
// 'app' is now your web server object

// ============================================
// SECTION 3: SECURITY MIDDLEWARE
// ============================================

app.use(helmet());
// ↑ Apply security headers to ALL routes
// Example headers set:
// X-DNS-Prefetch-Control: off
// X-Frame-Options: SAMEORIGIN
// Strict-Transport-Security: max-age=15552000; includeSubDomains

app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.ALLOWED_ORIGINS.split(',')  // Production: Use whitelist from .env
    : '*'  // Development: Allow all origins
}));
// ↑ Configure CORS
// Production example:
//   ALLOWED_ORIGINS=https://yourdomain.com,https://admin.yourdomain.com
//   → Only these domains can call your API
// Development:
//   '*' → Any domain can call (useful for testing)

app.use(express.json({ limit: '10kb' }));
// ↑ Parse incoming JSON bodies
// limit: '10kb' → Reject requests with body > 10KB
// Why limit? Prevent large payload attacks (DoS)
// Example request body it parses:
//   { "deviceId": "5C:CF:7F:12:34:56", "secret": "abc123" }

// ============================================
// SECTION 4: RATE LIMITING
// ============================================

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  // ↑ Time window: 15 minutes (in milliseconds)
  
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  // ↑ Max requests per IP per window: 100
  
  message: { error: 'Too many requests, please try again later' },
  // ↑ Response sent when limit exceeded
  
  standardHeaders: true,
  // ↑ Return rate limit info in `RateLimit-*` headers
  // Example response headers:
  //   RateLimit-Limit: 100
  //   RateLimit-Remaining: 95
  //   RateLimit-Reset: 1640000000
  
  legacyHeaders: false
  // ↑ Disable deprecated `X-RateLimit-*` headers
});

app.use('/auth/', limiter);
// ↑ Apply rate limiting ONLY to /auth/* endpoints
// Why? Authentication endpoints are most vulnerable to brute force
// Other endpoints (/health, /admin) not rate limited (you can add if needed)

// ============================================
// SECTION 5: INITIALIZE FIREBASE
// ============================================

const serviceAccount = require(process.env.SERVICE_ACCOUNT_PATH);
// ↑ Load Firebase service account private key
// This file contains:
// - project_id: Your Firebase project ID
// - private_key: RSA private key (2048-bit)
// - client_email: Service account email

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // ↑ Authenticate with Firebase using service account
  
  databaseURL: process.env.DATABASE_URL
  // ↑ Your Firebase Realtime Database URL
  // Example: https://esp-project-5bde3-default-rtdb.firebaseio.com
});

console.log('✓ Firebase Admin SDK initialized');
console.log(`✓ Project: ${serviceAccount.project_id}`);
console.log(`✓ Service Account: ${serviceAccount.client_email}`);
// ↑ Confirmation logs
// If you see these, Firebase is ready

// ============================================
// SECTION 6: IMPORT ROUTES
// ============================================

const authRoutes = require('./routes/auth');
// ↑ Authentication endpoints (token creation)
// Defines: POST /auth/token, POST /auth/verify

const adminRoutes = require('./routes/admin');
// ↑ Device management endpoints
// Defines: POST /admin/register, POST /admin/revoke, GET /admin/devices

// ============================================
// SECTION 7: REGISTER ROUTES
// ============================================

app.use('/auth', authRoutes);
// ↑ Mount auth routes at /auth prefix
// Example: POST /auth/token → handled by authRoutes

app.use('/admin', adminRoutes);
// ↑ Mount admin routes at /admin prefix
// Example: POST /admin/register → handled by adminRoutes

// ============================================
// SECTION 8: UTILITY ENDPOINTS
// ============================================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    // ↑ Server is running
    
    timestamp: new Date().toISOString(),
    // ↑ Current time (ISO 8601 format)
    // Example: 2024-01-15T14:30:00.000Z
    
    uptime: process.uptime(),
    // ↑ How long server has been running (seconds)
    // Example: 3600 (1 hour)
    
    environment: process.env.NODE_ENV
    // ↑ Current environment (development or production)
  });
});
// ↑ Health check endpoint
// Purpose: Monitor server status
// Usage: Uptime monitoring services (Pingdom, UptimeRobot) can ping this
// Test: curl http://localhost:3000/health

// ============================================
// SECTION 9: ERROR HANDLERS
// ============================================

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});
// ↑ 404 handler (route not found)
// Catches all requests that don't match any route
// Example: GET /nonexistent → 404

app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  // ↑ Log error to console (in production, send to logging service)
  
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
    // ↑ In development: Show error details
    //   In production: Hide details (security)
  });
});
// ↑ Global error handler
// Catches any unhandled errors in routes
// Example: Database connection error, Firebase API error

// ============================================
// SECTION 10: START SERVER
// ============================================

const PORT = process.env.PORT || 3000;
// ↑ Get port from environment (Heroku sets this)
// Fallback to 3000 if not set

app.listen(PORT, () => {
  console.log(`\n🚀 ESP8266 Auth Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV}`);
  console.log(`🔒 Rate limit: ${process.env.RATE_LIMIT_MAX_REQUESTS} requests per ${process.env.RATE_LIMIT_WINDOW_MS / 60000} minutes\n`);
});
// ↑ Start listening for HTTP requests
// Server is now accessible at: http://localhost:3000

// ============================================
// SECTION 11: GRACEFUL SHUTDOWN
// ============================================

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  // ↑ SIGTERM = Termination signal (from Heroku, Docker, etc.)
  
  // Close server, finish pending requests, then exit
  process.exit(0);
});
// ↑ Graceful shutdown handler
// When server is stopped, cleanup properly:
// - Close database connections
// - Finish pending requests
// - Log shutdown event


// ### Request Flow Example

// User makes request: POST /auth/token

// ↓ 1. Request enters Express
// ↓ 2. helmet() → Adds security headers
// ↓ 3. cors() → Checks origin, adds CORS headers
// ↓ 4. express.json() → Parses JSON body
// ↓ 5. limiter → Checks rate limit (allow or block)
// ↓ 6. Routes to /auth prefix
// ↓ 7. authRoutes handles /token endpoint
// ↓ 8. Response sent back to user

