const express = require('express');
const { query, body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');

const router = express.Router();

// Mock nearby services data
const mockServices = [
  {
    id: 'hospital_1',
    name: 'City General Hospital',
    type: 'hospital',
    address: '456 Medical Center Blvd',
    phone: '+1-555-0123',
    location: { latitude: 40.7589, longitude: -73.9851 },
    distance: 2.1,
    estimatedTime: 8,
    isOpen24Hours: true,
    currentStatus: 'open',
    rating: 4.2
  },
  {
    id: 'police_1',
    name: 'Central Police Station',
    type: 'police',
    address: '789 Justice Ave',
    phone: '+1-555-0911',
    location: { latitude: 40.7505, longitude: -73.9934 },
    distance: 1.5,
    estimatedTime: 6,
    isOpen24Hours: true,
    currentStatus: 'open',
    rating: 4.0
  },
  {
    id: 'gas_1',
    name: 'QuickFill Gas Station',
    type: 'gas_station',
    address: '321 Highway 101',
    phone: '+1-555-0456',
    location: { latitude: 40.7614, longitude: -73.9776 },
    distance: 0.8,
    estimatedTime: 3,
    isOpen24Hours: false,
    currentStatus: 'open',
    rating: 3.8
  }
];

// Get nearby services
router.get('/nearby-services', auth, [
  query('latitude').isFloat({ min: -90, max: 90 }),
  query('longitude').isFloat({ min: -180, max: 180 }),
  query('radius').optional().isInt({ min: 1, max: 50 }),
  query('type').optional().isIn(['hospital', 'police', 'fire', 'gas_station', 'mechanic', 'all'])
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

    const { latitude, longitude, radius = 10, type = 'all' } = req.query;

    // Filter services based on type
    let filteredServices = mockServices;
    if (type !== 'all') {
      filteredServices = mockServices.filter(service => service.type === type);
    }

    // In a real implementation, you would calculate actual distances
    // and filter based on the radius parameter

    res.json({
      success: true,
      data: {
        services: filteredServices
      }
    });
  } catch (error) {
    console.error('Get nearby services error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get route between two points
router.post('/route', auth, [
  body('origin.latitude').isFloat({ min: -90, max: 90 }),
  body('origin.longitude').isFloat({ min: -180, max: 180 }),
  body('destination.latitude').isFloat({ min: -90, max: 90 }),
  body('destination.longitude').isFloat({ min: -180, max: 180 }),
  body('routeType').optional().isIn(['fastest', 'safest', 'shortest']),
  body('avoidTolls').optional().isBoolean(),
  body('avoidHighways').optional().isBoolean()
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

    const { origin, destination, routeType = 'safest' } = req.body;

    // Mock route response
    const mockRoute = {
      distance: 12.5,
      duration: 18,
      routeType,
      polyline: 'encodedPolylineString',
      steps: [
        {
          instruction: 'Head north on Main St',
          distance: 500,
          duration: 60,
          location: origin
        },
        {
          instruction: 'Turn right on Highway 101',
          distance: 1200,
          duration: 120,
          location: { latitude: origin.latitude + 0.01, longitude: origin.longitude }
        }
      ],
      trafficInfo: {
        level: 'moderate',
        incidents: [
          {
            type: 'construction',
            description: 'Road work ahead',
            severity: 'medium',
            location: { latitude: 40.7505, longitude: -73.9934 }
          }
        ]
      },
      safetyScore: 8
    };

    res.json({
      success: true,
      data: {
        route: mockRoute
      }
    });
  } catch (error) {
    console.error('Get route error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
