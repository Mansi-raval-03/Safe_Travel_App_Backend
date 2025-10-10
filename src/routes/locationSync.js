const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Location = require('../models/Location');

/**
 * @route   POST /api/v1/location/sync
 * @desc    Sync location data from mobile app after reconnection
 * @access  Private (requires JWT token)
 */
router.post('/sync',
  auth,
  [
    // Validation rules
    body('locations')
      .isArray({ min: 1 })
      .withMessage('Locations must be a non-empty array'),
    body('locations.*.latitude')
      .isFloat({ min: -90, max: 90 })
      .withMessage('Latitude must be a valid number between -90 and 90'),
    body('locations.*.longitude')
      .isFloat({ min: -180, max: 180 })
      .withMessage('Longitude must be a valid number between -180 and 180'),
    body('locations.*.timestamp')
      .isISO8601()
      .withMessage('Timestamp must be a valid ISO8601 date'),
    body('locations.*.accuracy')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Accuracy must be a positive number'),
    body('deviceInfo.offlineDuration')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Offline duration must be a positive integer (minutes)'),
    body('syncReason')
      .optional()
      .isString()
      .withMessage('Sync reason must be a string'),
  ],
  async (req, res) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const userId = req.user.id;
      const { locations, deviceInfo = {}, syncReason = 'auto_sync' } = req.body;

      console.log(`📱 Location sync request from user ${userId}: ${locations.length} locations, reason: ${syncReason}`);

      // Validate user exists and is active
      const user = await User.findById(userId);
      if (!user || !user.isActive) {
        return res.status(404).json({
          success: false,
          message: 'User not found or inactive'
        });
      }

      // Process and save locations
      const savedLocations = [];
      const skippedLocations = [];
      
      for (const locationData of locations) {
        try {
          // Check if location already exists (prevent duplicates)
          const existingLocation = await Location.findOne({
            userId: userId,
            timestamp: new Date(locationData.timestamp),
            latitude: locationData.latitude,
            longitude: locationData.longitude
          });

          if (existingLocation) {
            skippedLocations.push({
              ...locationData,
              reason: 'duplicate'
            });
            continue;
          }

          // Create new location record
          const location = new Location({
            userId: userId,
            latitude: locationData.latitude,
            longitude: locationData.longitude,
            accuracy: locationData.accuracy,
            timestamp: new Date(locationData.timestamp),
            source: 'mobile_sync',
            metadata: {
              syncReason,
              offlineDuration: deviceInfo.offlineDuration,
              syncedAt: new Date(),
              deviceInfo: deviceInfo
            }
          });

          await location.save();
          savedLocations.push(location);

        } catch (locationError) {
          console.error(`❌ Error saving location ${JSON.stringify(locationData)}:`, locationError);
          skippedLocations.push({
            ...locationData,
            reason: 'save_error',
            error: locationError.message
          });
        }
      }

      // Update user's last known location and last active timestamp
      if (savedLocations.length > 0) {
        // Get the most recent location
        const mostRecentLocation = savedLocations.sort((a, b) => 
          new Date(b.timestamp) - new Date(a.timestamp)
        )[0];

        // Update user record
        await User.findByIdAndUpdate(userId, {
          lastKnownLocation: {
            latitude: mostRecentLocation.latitude,
            longitude: mostRecentLocation.longitude,
            timestamp: mostRecentLocation.timestamp
          },
          lastActiveAt: new Date()
        });

        console.log(`✅ Updated user ${userId} last known location and activity`);
      }

      // Prepare response
      const response = {
        success: true,
        message: 'Location sync completed',
        data: {
          processed: locations.length,
          saved: savedLocations.length,
          skipped: skippedLocations.length,
          syncedAt: new Date().toISOString(),
          syncReason,
        }
      };

      // Include skipped locations info if any
      if (skippedLocations.length > 0) {
        response.data.skippedLocations = skippedLocations;
      }

      // Include offline duration info if provided
      if (deviceInfo.offlineDuration) {
        response.data.offlineDuration = deviceInfo.offlineDuration;
        response.message += ` (after ${deviceInfo.offlineDuration} minutes offline)`;
      }

      console.log(`📡 Location sync completed for user ${userId}: ${savedLocations.length}/${locations.length} saved`);

      res.status(200).json(response);

    } catch (error) {
      console.error('❌ Location sync error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error during location sync',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
      });
    }
  }
);

/**
 * @route   GET /api/v1/location/sync/status
 * @desc    Get location sync status for current user
 * @access  Private
 */
router.get('/sync/status',
  auth,
  async (req, res) => {
    try {
      const userId = req.user.id;

      // Get user's sync statistics
      const user = await User.findById(userId).select('lastKnownLocation lastActiveAt');
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Count locations by source
      const [totalLocations, syncedLocations, recentSyncedLocations] = await Promise.all([
        Location.countDocuments({ userId }),
        Location.countDocuments({ userId, source: 'mobile_sync' }),
        Location.countDocuments({ 
          userId, 
          source: 'mobile_sync',
          'metadata.syncedAt': { 
            $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        })
      ]);

      // Get most recent sync
      const lastSyncLocation = await Location.findOne({
        userId,
        source: 'mobile_sync'
      }).sort({ 'metadata.syncedAt': -1 });

      res.json({
        success: true,
        data: {
          userId,
          lastKnownLocation: user.lastKnownLocation,
          lastActiveAt: user.lastActiveAt,
          stats: {
            totalLocations,
            syncedLocations,
            recentSyncedLocations,
          },
          lastSync: lastSyncLocation ? {
            syncedAt: lastSyncLocation.metadata?.syncedAt,
            locationTimestamp: lastSyncLocation.timestamp,
            syncReason: lastSyncLocation.metadata?.syncReason,
            offlineDuration: lastSyncLocation.metadata?.offlineDuration,
          } : null
        }
      });

    } catch (error) {
      console.error('❌ Sync status error:', error);
      res.status(500).json({
        success: false,
        message: 'Error retrieving sync status',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
      });
    }
  }
);

/**
 * @route   POST /api/v1/location/sync/test
 * @desc    Test endpoint for manual sync triggering (development only)
 * @access  Private
 */
router.post('/sync/test',
  auth,
  async (req, res) => {
    // Only allow in development environment
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        message: 'Test endpoints not available in production'
      });
    }

    try {
      const userId = req.user.id;
      const now = new Date();

      // Create test location data
      const testLocation = {
        latitude: 37.7749 + (Math.random() - 0.5) * 0.01, // San Francisco area with small random offset
        longitude: -122.4194 + (Math.random() - 0.5) * 0.01,
        accuracy: 10,
        timestamp: now.toISOString()
      };

      // Simulate sync request
      const testSyncData = {
        locations: [testLocation],
        deviceInfo: {
          offlineDuration: 20, // 20 minutes offline
          deviceType: 'test_device',
          appVersion: '1.0.0-test'
        },
        syncReason: 'manual_test'
      };

      // Forward to main sync endpoint logic
      req.body = testSyncData;
      
      // Create test location
      const location = new Location({
        userId: userId,
        latitude: testLocation.latitude,
        longitude: testLocation.longitude,
        accuracy: testLocation.accuracy,
        timestamp: now,
        source: 'test_sync',
        metadata: {
          syncReason: 'manual_test',
          offlineDuration: 20,
          syncedAt: now,
          deviceInfo: testSyncData.deviceInfo
        }
      });

      await location.save();

      console.log(`🧪 Test sync completed for user ${userId}`);

      res.json({
        success: true,
        message: 'Test sync completed successfully',
        data: {
          testLocation: location,
          syncedAt: now.toISOString()
        }
      });

    } catch (error) {
      console.error('❌ Test sync error:', error);
      res.status(500).json({
        success: false,
        message: 'Test sync failed',
        error: error.message
      });
    }
  }
);

module.exports = router;