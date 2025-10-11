const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const TripEvent = require('../models/TripEvent');
const auth = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Rate limiting for trip events
const tripEventLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 requests per windowMs
  message: {
    success: false,
    message: 'Too many trip event requests from this IP, please try again later.'
  }
});

// Apply rate limiting to all trip event routes
router.use(tripEventLimiter);

// Validation middleware
const tripEventValidation = [
  body('title')
    .notEmpty()
    .withMessage('Title is required')
    .isLength({ min: 1, max: 200 })
    .withMessage('Title must be between 1 and 200 characters')
    .trim(),
  body('startTime')
    .isISO8601()
    .withMessage('Start time must be a valid ISO 8601 date')
    .custom((value) => {
      const startTime = new Date(value);
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      if (startTime < oneYearAgo) {
        throw new Error('Start time cannot be more than 1 year in the past');
      }
      return true;
    }),
  body('endTime')
    .isISO8601()
    .withMessage('End time must be a valid ISO 8601 date')
    .custom((value, { req }) => {
      const endTime = new Date(value);
      const startTime = new Date(req.body.startTime);
      if (endTime <= startTime) {
        throw new Error('End time must be after start time');
      }
      return true;
    }),
  body('destination.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Destination latitude must be between -90 and 90'),
  body('destination.longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Destination longitude must be between -180 and 180'),
  body('destination.address')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Destination address must be less than 500 characters')
    .trim(),
  body('destination.name')
    .optional()
    .isLength({ max: 100 })
    .withMessage('Destination name must be less than 100 characters')
    .trim(),
  body('notes')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Notes must be less than 1000 characters')
    .trim(),
  body('travelMode')
    .optional()
    .isIn(['walking', 'driving', 'public_transport', 'cycling', 'other'])
    .withMessage('Travel mode must be one of: walking, driving, public_transport, cycling, other'),
  body('alertThresholds.locationTimeoutMinutes')
    .optional()
    .isInt({ min: 5, max: 180 })
    .withMessage('Location timeout must be between 5 and 180 minutes'),
  body('alertThresholds.destinationToleranceMeters')
    .optional()
    .isInt({ min: 50, max: 5000 })
    .withMessage('Destination tolerance must be between 50 and 5000 meters')
];

// Create a new trip event
router.post('/create', auth, tripEventValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const {
      title,
      startTime,
      endTime,
      destination,
      notes,
      travelMode,
      alertThresholds
    } = req.body;

    // Create new trip event
    const tripEvent = new TripEvent({
      userId: req.user._id,
      title,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      destination,
      notes,
      travelMode: travelMode || 'other',
      alertThresholds: {
        locationTimeoutMinutes: alertThresholds?.locationTimeoutMinutes || 30,
        destinationToleranceMeters: alertThresholds?.destinationToleranceMeters || 500
      }
    });

    await tripEvent.save();

    res.status(201).json({
      success: true,
      message: 'Trip event created successfully',
      data: {
        tripEvent
      }
    });
  } catch (error) {
    console.error('Create trip event error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get user's trip events
router.get('/user/:userId?', auth, [
  param('userId')
    .optional()
    .isMongoId()
    .withMessage('Invalid user ID format'),
  query('status')
    .optional()
    .isIn(['scheduled', 'active', 'completed', 'missed', 'alert_triggered', 'cancelled'])
    .withMessage('Invalid status filter'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('offset')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Offset must be a non-negative integer')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const userId = req.params.userId || req.user._id;
    const { status, limit = 20, offset = 0 } = req.query;

    // Verify user can access this data (users can only access their own trips)
    if (userId !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: You can only view your own trips'
      });
    }

    const query = { userId, isActive: true };
    if (status) {
      query.status = status;
    }

    const tripEvents = await TripEvent.find(query)
      .sort({ startTime: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset));

    const total = await TripEvent.countDocuments(query);

    res.json({
      success: true,
      message: 'Trip events retrieved successfully',
      data: {
        tripEvents,
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: total > parseInt(offset) + tripEvents.length
        }
      }
    });
  } catch (error) {
    console.error('Get trip events error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get specific trip event
router.get('/:tripId', auth, [
  param('tripId')
    .isMongoId()
    .withMessage('Invalid trip ID format')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const tripEvent = await TripEvent.findOne({
      _id: req.params.tripId,
      userId: req.user._id,
      isActive: true
    });

    if (!tripEvent) {
      return res.status(404).json({
        success: false,
        message: 'Trip event not found'
      });
    }

    res.json({
      success: true,
      message: 'Trip event retrieved successfully',
      data: {
        tripEvent
      }
    });
  } catch (error) {
    console.error('Get trip event error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update trip event
router.patch('/update/:tripId', auth, [
  param('tripId')
    .isMongoId()
    .withMessage('Invalid trip ID format'),
  body('title')
    .optional()
    .isLength({ min: 1, max: 200 })
    .withMessage('Title must be between 1 and 200 characters')
    .trim(),
  body('startTime')
    .optional()
    .isISO8601()
    .withMessage('Start time must be a valid ISO 8601 date'),
  body('endTime')
    .optional()
    .isISO8601()
    .withMessage('End time must be a valid ISO 8601 date'),
  body('destination.latitude')
    .optional()
    .isFloat({ min: -90, max: 90 })
    .withMessage('Destination latitude must be between -90 and 90'),
  body('destination.longitude')
    .optional()
    .isFloat({ min: -180, max: 180 })
    .withMessage('Destination longitude must be between -180 and 180'),
  body('destination.address')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Destination address must be less than 500 characters')
    .trim(),
  body('destination.name')
    .optional()
    .isLength({ max: 100 })
    .withMessage('Destination name must be less than 100 characters')
    .trim(),
  body('notes')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Notes must be less than 1000 characters')
    .trim(),
  body('travelMode')
    .optional()
    .isIn(['walking', 'driving', 'public_transport', 'cycling', 'other'])
    .withMessage('Travel mode must be one of: walking, driving, public_transport, cycling, other'),
  body('status')
    .optional()
    .isIn(['scheduled', 'active', 'completed', 'missed', 'alert_triggered', 'cancelled'])
    .withMessage('Invalid status'),
  body('alertThresholds.locationTimeoutMinutes')
    .optional()
    .isInt({ min: 5, max: 180 })
    .withMessage('Location timeout must be between 5 and 180 minutes'),
  body('alertThresholds.destinationToleranceMeters')
    .optional()
    .isInt({ min: 50, max: 5000 })
    .withMessage('Destination tolerance must be between 50 and 5000 meters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const tripEvent = await TripEvent.findOne({
      _id: req.params.tripId,
      userId: req.user._id,
      isActive: true
    });

    if (!tripEvent) {
      return res.status(404).json({
        success: false,
        message: 'Trip event not found'
      });
    }

    // Prevent updates to completed or cancelled trips
    if (['completed', 'cancelled'].includes(tripEvent.status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot update completed or cancelled trips'
      });
    }

    const allowedUpdates = [
      'title', 'startTime', 'endTime', 'destination', 'notes', 
      'travelMode', 'status', 'alertThresholds'
    ];
    
    const updates = {};
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        if (field === 'startTime' || field === 'endTime') {
          updates[field] = new Date(req.body[field]);
        } else {
          updates[field] = req.body[field];
        }
      }
    });

    // Validate time constraints if times are being updated
    if (updates.startTime || updates.endTime) {
      const newStartTime = updates.startTime || tripEvent.startTime;
      const newEndTime = updates.endTime || tripEvent.endTime;
      
      if (newEndTime <= newStartTime) {
        return res.status(400).json({
          success: false,
          message: 'End time must be after start time'
        });
      }
    }

    // Handle status update with proper method
    if (updates.status) {
      tripEvent.updateStatus(updates.status);
      delete updates.status; // Remove from regular updates since method handles it
    }

    Object.assign(tripEvent, updates);
    await tripEvent.save();

    res.json({
      success: true,
      message: 'Trip event updated successfully',
      data: {
        tripEvent
      }
    });
  } catch (error) {
    console.error('Update trip event error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update trip location (for active trips)
router.patch('/location/:tripId', auth, [
  param('tripId')
    .isMongoId()
    .withMessage('Invalid trip ID format'),
  body('latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  body('longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180'),
  body('address')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Address must be less than 500 characters')
    .trim(),
  body('name')
    .optional()
    .isLength({ max: 100 })
    .withMessage('Name must be less than 100 characters')
    .trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const tripEvent = await TripEvent.findOne({
      _id: req.params.tripId,
      userId: req.user._id,
      isActive: true
    });

    if (!tripEvent) {
      return res.status(404).json({
        success: false,
        message: 'Trip event not found'
      });
    }

    if (tripEvent.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Can only update location for active trips'
      });
    }

    const { latitude, longitude, address, name } = req.body;
    tripEvent.updateLocation(latitude, longitude, address, name);
    await tripEvent.save();

    res.json({
      success: true,
      message: 'Trip location updated successfully',
      data: {
        currentLocation: tripEvent.currentLocation,
        lastLocationUpdate: tripEvent.lastLocationUpdate,
        distanceToDestination: tripEvent.calculateDistanceToDestination()
      }
    });
  } catch (error) {
    console.error('Update trip location error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Delete trip event (soft delete)
router.delete('/:tripId', auth, [
  param('tripId')
    .isMongoId()
    .withMessage('Invalid trip ID format')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const tripEvent = await TripEvent.findOne({
      _id: req.params.tripId,
      userId: req.user._id,
      isActive: true
    });

    if (!tripEvent) {
      return res.status(404).json({
        success: false,
        message: 'Trip event not found'
      });
    }

    // Soft delete by setting isActive to false
    tripEvent.isActive = false;
    tripEvent.updateStatus('cancelled');
    await tripEvent.save();

    res.json({
      success: true,
      message: 'Trip event deleted successfully'
    });
  } catch (error) {
    console.error('Delete trip event error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get active trips (for monitoring system)
router.get('/monitoring/active', auth, async (req, res) => {
  try {
    const activeTrips = await TripEvent.findActiveTrips();
    
    res.json({
      success: true,
      message: 'Active trips retrieved successfully',
      data: {
        activeTrips,
        count: activeTrips.length
      }
    });
  } catch (error) {
    console.error('Get active trips error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get overdue trips (for monitoring system)
router.get('/monitoring/overdue', auth, async (req, res) => {
  try {
    const overdueTrips = await TripEvent.findOverdueTrips();
    
    res.json({
      success: true,
      message: 'Overdue trips retrieved successfully',
      data: {
        overdueTrips,
        count: overdueTrips.length
      }
    });
  } catch (error) {
    console.error('Get overdue trips error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get monitoring service status
router.get('/monitoring/status', auth, async (req, res) => {
  try {
    const tripMonitoringService = require('../services/tripMonitoringService');
    const status = tripMonitoringService.getStatus();
    
    res.json({
      success: true,
      message: 'Monitoring status retrieved successfully',
      data: status
    });
  } catch (error) {
    console.error('Get monitoring status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Manually trigger monitoring check (admin endpoint)
router.post('/monitoring/check', auth, async (req, res) => {
  try {
    const tripMonitoringService = require('../services/tripMonitoringService');
    const result = await tripMonitoringService.manualCheck();
    
    res.json({
      success: true,
      message: 'Manual monitoring check completed',
      data: result
    });
  } catch (error) {
    console.error('Manual monitoring check error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;