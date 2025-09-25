const express = require('express');
const { body, validationResult } = require('express-validator');
const Location = require('../models/Location');
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

module.exports = router;
