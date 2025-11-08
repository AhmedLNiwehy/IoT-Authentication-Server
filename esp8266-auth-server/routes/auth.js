/**
 * Authentication Routes
 * Handles device token requests
 */

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const deviceModel = require('../models/device');

/**
 * POST /auth/token
 * 
 * Request body:
 * {
 *   "deviceId": "5C:CF:7F:12:34:56",
 *   "secret": "a8f5d2c9...",
 *   "firmwareVersion": "1.2.3" (optional)
 * }
 * 
 * Response:
 * {
 *   "customToken": "eyJhbGciOiJSUzI1NiIs...",
 *   "expiresIn": 3600
 * }
 */
router.post('/token', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { deviceId, secret, firmwareVersion } = req.body;

    // Validate input
    if (!deviceId || !secret) {
      return res.status(400).json({ 
        error: 'Missing required fields: deviceId, secret' 
      });
    }

    // Normalize MAC address format
    const normalizedDeviceId = deviceId.toUpperCase().replace(/[:-]/g, ':');

    // Verify device credentials
    const device = deviceModel.verifyDevice(normalizedDeviceId, secret);
    
    if (!device) {
      return res.status(401).json({ 
        error: 'Invalid credentials' 
      });
    }

    // Create custom claims (embedded in token)
    const additionalClaims = {
      deviceType: 'esp8266',
      deviceId: normalizedDeviceId,
      permissions: ['switches:read', 'switches:write'],
      firmwareVersion: firmwareVersion || device.metadata.firmwareVersion,
      authTimestamp: Date.now()
    };

    // Create custom token using Firebase Admin SDK
    // This token is signed with the service account's private key
    const customToken = await admin.auth().createCustomToken(
      normalizedDeviceId,
      additionalClaims
    );

    // Update device last authentication time
    await deviceModel.updateLastAuth(normalizedDeviceId);

    // Log successful authentication
    const duration = Date.now() - startTime;
    console.log(`✓ Token issued for ${normalizedDeviceId} (${duration}ms)`);

    // Return token
    res.json({
      customToken,
      expiresIn: 3600, // Token valid for 1 hour
      message: 'Authentication successful'
    });

  } catch (error) {
    console.error('[AUTH ERROR]', error);
    res.status(500).json({ 
      error: 'Failed to create token',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /auth/verify
 * 
 * Verify an ID token (for testing/debugging)
 * 
 * Request body:
 * {
 *   "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6Ij..."
 * }
 */
router.post('/verify', async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: 'Missing idToken' });
    }

    // Verify the ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    res.json({
      valid: true,
      deviceId: decodedToken.uid,
      claims: decodedToken
    });

  } catch (error) {
    res.status(401).json({ 
      valid: false,
      error: error.message 
    });
  }
});

module.exports = router;
