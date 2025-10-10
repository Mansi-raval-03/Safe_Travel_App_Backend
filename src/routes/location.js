const express = require('express');
const { body, validationResult } = require('express-validator');
const Location = require('../models/Location');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// Update user location
router.post('/update', auth, [
  body('latitude').isFloat({ min: -90, max: 90 }),
  body('longitude').isFloat({ min: -180, max: 180 }),
  body('accuracy').optional().isNumeric(),
  body('address').optional().isString().trim(),
  body('timestamp').optional().isISO8601()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors.array()
      });
    }

    const { latitude, longitude, accuracy, address } = req.body;

    // Update location in Location model
    const location = await Location.findOneAndUpdate(
      { userId: req.user._id },
      {
        latitude,
        longitude,
        accuracy: accuracy || 0,
        address: address || ''
      },
      { upsert: true, new: true, runValidators: true }
    );

    // Update user's last known location and activity for auto SOS
    try {
      await req.user.updateLastKnownLocation(latitude, longitude, accuracy, address);
      console.log(`📍 Updated last known location for user ${req.user.email}`);
    } catch (userUpdateError) {
      console.error('Error updating user location:', userUpdateError);
      // Don't fail the main request if user update fails
    }

    res.json({
      success: true,
      message: 'Location updated successfully',
      data: {
        location: {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          address: location.address,
          updatedAt: location.updatedAt
        }
      }
    });
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get current location
router.get('/current', auth, async (req, res) => {
  try {
    const location = await Location.findOne({ userId: req.user._id });

    if (!location) {
      return res.status(404).json({
        success: false,
        message: 'No location data found'
      });
    }

    res.json({
      success: true,
      data: {
        location: {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          address: location.address,
          updatedAt: location.updatedAt
        }
      }
    });
  } catch (error) {
    console.error('Get location error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update user activity (for keep-alive pings)
router.post('/activity', auth, async (req, res) => {
  try {
    await req.user.updateActivity();
    
    res.json({
      success: true,
      message: 'Activity updated successfully',
      data: {
        lastActiveAt: req.user.lastActiveAt
      }
    });
  } catch (error) {
    console.error('Update activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update activity'
    });
  }
});

// Batch location update (for real-time tracking)
router.post('/batch-update', auth, [
  body('locations').isArray({ min: 1, max: 10 }).withMessage('Locations must be an array of 1-10 items'),
  body('locations.*.latitude').isFloat({ min: -90, max: 90 }),
  body('locations.*.longitude').isFloat({ min: -180, max: 180 }),
  body('locations.*.accuracy').optional().isNumeric(),
  body('locations.*.timestamp').optional().isISO8601(),
  body('locations.*.address').optional().isString().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors.array()
      });
    }

    const { locations } = req.body;
    const results = [];

    // Process locations in order (oldest to newest)
    const sortedLocations = locations.sort((a, b) => {
      const timeA = a.timestamp ? new Date(a.timestamp) : new Date();
      const timeB = b.timestamp ? new Date(b.timestamp) : new Date();
      return timeA - timeB;
    });

    for (const loc of sortedLocations) {
      try {
        // Update location in Location model
        const location = await Location.findOneAndUpdate(
          { userId: req.user._id },
          {
            latitude: loc.latitude,
            longitude: loc.longitude,
            accuracy: loc.accuracy || 0,
            address: loc.address || ''
          },
          { upsert: true, new: true, runValidators: true }
        );

        results.push({
          success: true,
          location: {
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy,
            address: location.address,
            updatedAt: location.updatedAt
          }
        });

        // Update user's last known location (only for the most recent location)
        if (loc === sortedLocations[sortedLocations.length - 1]) {
          await req.user.updateLastKnownLocation(
            loc.latitude, 
            loc.longitude, 
            loc.accuracy, 
            loc.address
          );
        }

      } catch (locationError) {
        console.error('Error updating individual location:', locationError);
        results.push({
          success: false,
          error: locationError.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    
    res.json({
      success: true,
      message: `Batch location update completed. ${successCount}/${locations.length} locations processed successfully`,
      data: {
        processed: results.length,
        successful: successCount,
        results: results
      }
    });

  } catch (error) {
    console.error('Batch location update error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get location history (for debugging and analysis)
router.get('/history', auth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;

    // Get location history from Location model
    const locations = await Location.find({ userId: req.user._id })
      .sort({ updatedAt: -1 })
      .limit(Math.min(limit, 100))
      .skip(offset);

    // Get user's SOS-related location data
    const user = await User.findById(req.user._id)
      .select('lastKnownLocation defaultLocation lastActiveAt settings.autoSOSEnabled');

    res.json({
      success: true,
      data: {
        history: locations.map(loc => ({
          latitude: loc.latitude,
          longitude: loc.longitude,
          accuracy: loc.accuracy,
          address: loc.address,
          updatedAt: loc.updatedAt
        })),
        current: {
          lastKnownLocation: user.lastKnownLocation,
          defaultLocation: user.defaultLocation,
          lastActiveAt: user.lastActiveAt,
          autoSOSEnabled: user.settings?.autoSOSEnabled || false
        },
        pagination: {
          limit,
          offset,
          total: locations.length
        }
      }
    });

  } catch (error) {
    console.error('Get location history error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
