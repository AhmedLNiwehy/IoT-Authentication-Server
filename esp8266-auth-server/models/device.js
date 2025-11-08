/**
 * Device Model
 * 
 * RESPONSIBILITIES:
 * 1. Store device credentials (deviceId + secret)
 * 2. Verify device authentication attempts
 * 3. Track device status (active, revoked, suspended)
 * 4. Log authentication history
 * 
 * SECURITY:
 * - Uses constant-time comparison (prevents timing attacks)
 * - Secrets are hashed before comparison
 * - Never logs or returns secrets in API responses
 * 
 * STORAGE:
 * - Development: JSON file (simple, no setup)
 * - Production: Should use PostgreSQL, MongoDB, or Firebase
 */

// ============================================
// IMPORTS
// ============================================

const crypto = require('crypto');
// ↑ Node.js built-in cryptography library
// Used for:
// - Generating random secrets
// - HMAC (Hash-based Message Authentication Code)
// - Constant-time comparison (security)

const fs = require('fs').promises;
// ↑ File system module (promise-based)
// Used for: Reading/writing devices.json
// .promises = Use async/await instead of callbacks

const path = require('path');
// ↑ Path manipulation utilities
// Used for: Building file paths (cross-platform)

// ============================================
// CONSTANTS
// ============================================

const DB_PATH = path.join(__dirname, '../database/devices.json');
// ↑ Path to device database file
// __dirname = Directory of current file (models/)
// '../database/devices.json' = Go up one level, then to database/
// 
// Result: /path/to/project/database/devices.json
// 
// Why use path.join()?
// - Works on Windows (\ paths) and Linux/Mac (/ paths)
// - Handles edge cases (double slashes, etc.)

const SERVER_SECRET = process.env.SERVER_SECRET;
// ↑ Secret key for HMAC operations
// Used to hash secrets before comparison
// 
// Why HMAC instead of direct comparison?
// - Adds extra security layer
// - Prevents rainbow table attacks
// - Even if database leaks, secrets are protected

// ============================================
// DEVICE MODEL CLASS
// ============================================

class DeviceModel {
  // ============================================
  // CONSTRUCTOR
  // ============================================
  
  constructor() {
    this.devices = {};
    // ↑ In-memory storage
    // Structure: { "deviceId": { ...deviceData } }
    // Example:
    // {
    //   "5C:CF:7F:12:34:56": {
    //     deviceId: "5C:CF:7F:12:34:56",
    //     secret: "a8f5d2c9...",
    //     status: "active",
    //     ...
    //   }
    // }
    
    this.loadDevices();
    // ↑ Load existing devices from file on startup
  }

  // ============================================
  // PERSISTENCE METHODS
  // ============================================
  
  /**
   * Load devices from JSON file
   * Called automatically in constructor
   * 
   * Flow:
   * 1. Try to read devices.json
   * 2. If exists: Parse JSON and load into memory
   * 3. If not exists: Create empty database
   * 4. If error: Log and continue with empty database
   */
  async loadDevices() {
    try {
      const data = await fs.readFile(DB_PATH, 'utf8');
      // ↑ Read file as UTF-8 string
      // Async operation - doesn't block server startup
      
      this.devices = JSON.parse(data);
      // ↑ Parse JSON string into JavaScript object
      // If malformed JSON: Throws error (caught by catch block)
      
      console.log(`✓ Loaded ${Object.keys(this.devices).length} devices from database`);
      // ↑ Log success
      // Object.keys(this.devices).length = Count of devices
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        // ↑ ENOENT = Error NO ENTry (file doesn't exist)
        console.log('⚠ No device database found, creating new one');
        this.devices = {};
        await this.saveDevices();
        // ↑ Create empty database file
      } else {
        // ↑ Other errors (permission denied, disk full, etc.)
        console.error('Error loading devices:', error);
        // Continue with empty database rather than crashing
      }
    }
  }

  /**
   * Save devices to JSON file
   * Called after any database modification
   * 
   * Why save immediately?
   * - Prevents data loss if server crashes
   * - Simple persistence without database setup
   * 
   * Performance note:
   * - File I/O is slow
   * - For production with many devices, use real database
   */
  async saveDevices() {
    try {
      const dir = path.dirname(DB_PATH);
      // ↑ Get directory path: /path/to/project/database
      
      await fs.mkdir(dir, { recursive: true });
      // ↑ Create directory if it doesn't exist
      // recursive: true = Create parent directories too
      // Example: Creates both 'database' and 'database/subdir' if needed
      
      await fs.writeFile(
        DB_PATH, 
        JSON.stringify(this.devices, null, 2)
        // ↑ Convert JavaScript object to JSON string
        // null = No replacer function
        // 2 = Indent with 2 spaces (pretty-print)
      );
      
    } catch (error) {
      console.error('Error saving devices:', error);
      // ↑ Log but don't crash
      // In-memory data still available
      // Will retry on next save
    }
  }

  // ============================================
  // DEVICE REGISTRATION
  // ============================================
  
  /**
   * Register a new device
   * 
   * WHEN TO CALL:
   * - During manufacturing process
   * - When provisioning a new ESP8266
   * - From admin API endpoint
   * 
   * FLOW:
   * 1. Check if device already exists
   * 2. Generate cryptographically secure random secret
   * 3. Store device with metadata
   * 4. Save to disk
   * 5. Return credentials (ONLY TIME secret is returned!)
   * 
   * @param {string} deviceId - Unique device identifier (MAC address)
   * @param {object} metadata - Additional device information
   * @returns {Promise<object>} Device credentials
   * @throws {Error} If device already registered
   */
  async registerDevice(deviceId, metadata = {}) {
    // ============================================
    // VALIDATION
    // ============================================
    
    if (this.devices[deviceId]) {
      throw new Error('Device already registered');
      // ↑ Prevent duplicate registrations
      // Each device should be registered only once
    }

    // ============================================
    // GENERATE SECRET
    // ============================================
    
    const secret = crypto.randomBytes(32).toString('hex');
    // ↑ Generate 256-bit random secret
    // 
    // Breaking it down:
    // crypto.randomBytes(32) 
    //   ↑ Generate 32 random bytes (256 bits)
    //   Uses cryptographically secure random number generator (CSPRNG)
    //   NOT Math.random() - that's predictable!
    // 
    // .toString('hex')
    //   ↑ Convert bytes to hexadecimal string
    //   32 bytes = 64 hex characters
    //   Example: "a8f5d2c9e4b7a1f3c6d9e2b5a8f1c4d7e0b3a6f9c2d5e8b1a4f7c0d3e6b9a2f5"
    // 
    // Why 256 bits?
    // - Industry standard for symmetric keys
    // - Brute force: 2^256 attempts = impossible
    // - AES-256 equivalent security

    // ============================================
    // CREATE DEVICE RECORD
    // ============================================
    
    const device = {
      deviceId,
      // ↑ Unique identifier (MAC address)
      // Example: "5C:CF:7F:12:34:56"
      
      secret,
      // ↑ Random secret (generated above)
      // ⚠️ NEVER log this or include in API responses!
      
      status: 'active',
      // ↑ Device status
      // Possible values:
      // - 'active': Device can authenticate
      // - 'revoked': Device banned (security incident)
      // - 'suspended': Temporarily disabled (payment issue, etc.)
      
      registeredAt: new Date().toISOString(),
      // ↑ Registration timestamp
      // ISO 8601 format: "2024-01-15T10:30:00.000Z"
      // Why ISO? Standard, sortable, timezone-aware
      
      lastAuthAt: null,
      // ↑ Last successful authentication
      // Initially null (never authenticated)
      // Updated by updateLastAuth()
      
      authCount: 0,
      // ↑ Total authentication attempts
      // Useful for:
      // - Usage analytics
      // - Detecting anomalies (too many auths = hack attempt?)
      // - Billing (per-auth pricing)
      
      metadata: {
        firmwareVersion: metadata.firmwareVersion || 'unknown',
        // ↑ ESP8266 firmware version
        // Example: "1.0.0", "2.1.3-beta"
        // Useful for: Security updates, compatibility checks
        
        hardwareVersion: metadata.hardwareVersion || 'unknown',
        // ↑ Hardware revision
        // Example: "ESP-12E", "ESP-12F", "NodeMCU v3"
        // Useful for: Troubleshooting, feature compatibility
        
        ...metadata
        // ↑ Spread operator - include any additional metadata
        // Example: location, customer_id, serial_number, etc.
      }
    };

    // ============================================
    // SAVE TO DATABASE
    // ============================================
    
    this.devices[deviceId] = device;
    // ↑ Add to in-memory database
    
    await this.saveDevices();
    // ↑ Persist to disk
    
    console.log(`✓ Device registered: ${deviceId}`);

    // ============================================
    // RETURN CREDENTIALS
    // ============================================
    
    return {
      deviceId,
      secret
      // ↑ ⚠️ SECURITY WARNING!
      // This is the ONLY time the secret is returned
      // Must be flashed to ESP8266 immediately
      // If lost, device must be re-registered (new secret)
    };
  }

  // ============================================
  // AUTHENTICATION VERIFICATION
  // ============================================
  
  /**
   * Verify device credentials
   * 
   * SECURITY:
   * - Uses constant-time comparison (prevents timing attacks)
   * - Uses HMAC to hash secrets before comparison
   * - Never logs the actual secret
   * 
   * TIMING ATTACK EXPLANATION:
   * 
   * Vulnerable code:
   *   if (providedSecret === device.secret) { ... }
   * 
   * Why vulnerable?
   * - String comparison stops at first mismatch
   * - "a..." vs "b..." = Fast (1 comparison)
   * - "aaa..." vs "aab..." = Slow (3 comparisons)
   * - Attacker measures response time
   * - Attacker guesses secret character by character
   * 
   * Secure code (constant-time):
   *   crypto.timingSafeEqual(hash1, hash2)
   * 
   * Why secure?
   * - Always compares ALL bytes
   * - Same time regardless of match/mismatch
   * - Attacker can't measure progress
   * 
   * @param {string} deviceId - Device identifier
   * @param {string} providedSecret - Secret from ESP8266
   * @returns {object|null} Device if valid, null if invalid
   */
  verifyDevice(deviceId, providedSecret) {
    // ============================================
    // STEP 1: LOOKUP DEVICE
    // ============================================
    
    const device = this.devices[deviceId];
    
    if (!device) {
      console.log(`❌ Auth failed: Unknown device ${deviceId}`);
      // ↑ Device not in database
      // Possible reasons:
      // - Never registered
      // - Typo in deviceId
      // - Wrong database environment
      return null;
    }

    // ============================================
    // STEP 2: CHECK STATUS
    // ============================================
    
    if (device.status !== 'active') {
      console.log(`❌ Auth failed: Device ${deviceId} status is ${device.status}`);
      // ↑ Device exists but not allowed to authenticate
      // Possible statuses:
      // - 'revoked': Security breach, stolen device
      // - 'suspended': Payment issue, temporary ban
      return null;
    }

    // ============================================
    // STEP 3: VERIFY SECRET (CONSTANT-TIME)
    // ============================================
    
    // Hash the provided secret
    const hash1 = crypto
      .createHmac('sha256', SERVER_SECRET)
      // ↑ Create HMAC with SHA-256 algorithm
      // HMAC = Hash-based Message Authentication Code
      // SERVER_SECRET = Key from .env (adds extra security layer)
      
      .update(providedSecret)
      // ↑ Input the secret to hash
      
      .digest();
      // ↑ Generate the hash (returns Buffer)
    
    // Hash the stored secret
    const hash2 = crypto
      .createHmac('sha256', SERVER_SECRET)
      .update(device.secret)
      .digest();

    // Compare hashes (constant-time)
    if (!crypto.timingSafeEqual(hash1, hash2)) {
      // ↑ timingSafeEqual() compares ALL bytes
      // Always takes same time (prevents timing attacks)
      // Returns true only if hashes are IDENTICAL
      
      console.log(`❌ Auth failed: Invalid secret for device ${deviceId}`);
      // ↑ Secret doesn't match
      // Possible reasons:
      // - Wrong secret flashed to ESP8266
      // - Attacker guessing
      // - Corrupted EEPROM on ESP8266
      return null;
    }

    // ============================================
    // STEP 4: SUCCESS
    // ============================================
    
    console.log(`✓ Auth verified: Device ${deviceId}`);
    return device;
    // ↑ Return full device object
    // Caller can access metadata, status, etc.
  }

  // ============================================
  // AUTHENTICATION LOGGING
  // ============================================
  
  /**
   * Update device's last authentication timestamp
   * 
   * Called after successful token creation
   * Useful for:
   * - Monitoring device activity
   * - Detecting inactive devices
   * - Usage analytics
   * 
   * @param {string} deviceId - Device identifier
   */
  async updateLastAuth(deviceId) {
    if (this.devices[deviceId]) {
      this.devices[deviceId].lastAuthAt = new Date().toISOString();
      // ↑ Update last auth time
      
      this.devices[deviceId].authCount += 1;
      // ↑ Increment counter
      
      await this.saveDevices();
      // ↑ Persist changes
      
      // Optional: Log to analytics service
      // analytics.track('device_auth', { deviceId, timestamp: new Date() });
    }
  }

  // ============================================
  // DEVICE REVOCATION
  // ============================================
  
  /**
   * Revoke a device (emergency access removal)
   * 
   * WHEN TO USE:
   * - Device stolen or lost
   * - Security breach detected
   * - Customer requests device removal
   * - Compliance requirement (GDPR data deletion)
   * 
   * EFFECT:
   * - Device status → 'revoked'
   * - Future auth attempts will fail
   * - Existing tokens remain valid until expiration (1 hour)
   * 
   * @param {string} deviceId - Device to revoke
   * @param {string} reason - Why revoked (for audit log)
   */
  async revokeDevice(deviceId, reason = '') {
    if (!this.devices[deviceId]) {
      throw new Error('Device not found');
    }

    this.devices[deviceId].status = 'revoked';
    // ↑ Change status to revoked
    
    this.devices[deviceId].revokedAt = new Date().toISOString();
    // ↑ Record when revoked
    
    this.devices[deviceId].revokeReason = reason;
    // ↑ Store reason for audit trail
    // Example: "Device stolen", "Security breach", "Customer request"
    
    await this.saveDevices();

    console.log(`⚠️ Device revoked: ${deviceId} - Reason: ${reason}`);
    
    // Optional: Send alert
    // sendAlert('DEVICE_REVOKED', { deviceId, reason });
    
    // Optional: Invalidate existing tokens
    // (Not possible with Firebase - tokens valid until expiration)
  }

  // ============================================
  // QUERY METHODS
  // ============================================
  
  /**
   * Get device info (without secret)
   * 
   * SECURITY: Never returns the secret
   * Safe to use in API responses
   * 
   * @param {string} deviceId - Device identifier
   * @returns {object|null} Device info or null
   */
  getDevice(deviceId) {
    const device = this.devices[deviceId];
    if (!device) return null;

    // Destructure to exclude secret
    const { secret, ...safeDevice } = device;
    // ↑ ...safeDevice = All fields EXCEPT secret
    // 
    // Before: { deviceId, secret, status, ... }
    // After:  { deviceId, status, ... }  (no secret)
    
    return safeDevice;
  }

  /**
   * List all devices
   * 
   * Used by admin dashboard
   * Returns array of devices (no secrets)
   * 
   * @returns {Array} Array of device objects
   */
  listDevices() {
    return Object.keys(this.devices).map(id => this.getDevice(id));
    // ↑ Convert object to array
    // 
    // Before: { "device1": {...}, "device2": {...} }
    // After:  [ {...}, {...} ]
    // 
    // map() = Transform each device using getDevice()
    // Result: Array of devices without secrets
  }
}

// ============================================
// EXPORT SINGLETON
// ============================================

module.exports = new DeviceModel();
// ↑ Export a single instance (singleton pattern)
// 
// Why singleton?
// - Only one device database needed
// - Share same instance across all files
// - Consistent state
// 
// Usage in other files:
//   const deviceModel = require('./models/device');
//   deviceModel.verifyDevice(...);