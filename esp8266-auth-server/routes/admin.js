/**
 * Admin Routes
 * Device management endpoints (protected - add auth middleware in production)
 */

const express = require('express');
const router = express.Router();
const deviceModel = require('../models/device');

/**
 * POST /admin/register
 * 
 * Register a new device (manufacturing process)
 */
router.post('/register', async (req, res) => {
  try {
    const { deviceId, metadata } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'Missing deviceId' });
    }

    const device = await deviceModel.registerDevice(deviceId, metadata);

    res.json({
      message: 'Device registered successfully',
      device
    });

  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /admin/revoke
 * 
 * Revoke a device (emergency access removal)
 */
router.post('/revoke', async (req, res) => {
  try {
    const { deviceId, reason } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'Missing deviceId' });
    }

    await deviceModel.revokeDevice(deviceId, reason);

    res.json({
      message: 'Device revoked successfully',
      deviceId
    });

  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /admin/devices
 * 
 * List all devices
 */
router.get('/devices', (req, res) => {
  const devices = deviceModel.listDevices();
  res.json({
    count: devices.length,
    devices
  });
});

/**
 * GET /admin/devices/:deviceId
 * 
 * Get device info
 */
router.get('/devices/:deviceId', (req, res) => {
  const device = deviceModel.getDevice(req.params.deviceId);
  
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  res.json({ device });
});

module.exports = router;
