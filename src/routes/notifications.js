const express = require('express');
const { query } = require('express-validator');
const auth = require('../middleware/auth');

const router = express.Router();
const DeviceToken = require('../models/DeviceToken');
const sosService = require('../services/sosService');
const User = require('../models/User');

// Mock notifications data
const mockNotifications = [
  {
    id: '1',
    type: 'safety',
    title: 'Location Updated',
    message: 'Your location has been successfully updated',
    isRead: false,
    priority: 'low',
    createdAt: new Date()
  },
  {
    id: '2',
    type: 'alert',
    title: 'Emergency Contact Added',
    message: 'New emergency contact has been added to your profile',
    isRead: true,
    priority: 'medium',
    createdAt: new Date(Date.now() - 86400000) // 1 day ago
  }
];

// Get notifications
router.get('/', auth, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('type').optional().isIn(['alert', 'safety', 'system', 'all']),
  query('unreadOnly').optional().isBoolean()
], async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      type = 'all',
      unreadOnly = false
    } = req.query;

    let filteredNotifications = [...mockNotifications];

    // Filter by type
    if (type !== 'all') {
      filteredNotifications = filteredNotifications.filter(n => n.type === type);
    }

    // Filter by read status
    if (unreadOnly === 'true') {
      filteredNotifications = filteredNotifications.filter(n => !n.isRead);
    }

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedNotifications = filteredNotifications.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: {
        notifications: paginatedNotifications,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: filteredNotifications.length,
          totalPages: Math.ceil(filteredNotifications.length / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Mark notification as read
router.put('/:notificationId/read', auth, async (req, res) => {
  try {
    const { notificationId } = req.params;

    // In a real implementation, you would update the notification in the database
    const notification = mockNotifications.find(n => n.id === notificationId);
    if (notification) {
      notification.isRead = true;
    }

    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// List device tokens (admin / debug) - returns limited info
router.get('/device-tokens', auth, async (req, res) => {
  try {
    const tokens = await DeviceToken.find().limit(200).select('token user platform createdAt updatedAt');
    res.json({ success: true, data: { tokens } });
  } catch (error) {
    console.error('List device tokens error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Trigger a test push to all users (except sender) to validate FCM path
router.post('/test-push', auth, async (req, res) => {
  try {
    // Build a fake alert-like payload
    const fakeAlert = {
      _id: 'test-' + Date.now(),
      location: {
        latitude: req.body.latitude || 0,
        longitude: req.body.longitude || 0,
        address: req.body.address || 'Test Location'
      },
      message: req.body.message || 'Test SOS notification',
      emergencyType: req.body.emergencyType || 'general'
    };

    const result = await sosService.notifyPushToAllUsers(fakeAlert, req.user);
    res.json({ success: true, message: 'Test push triggered', data: result });
  } catch (error) {
    console.error('Test push error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
