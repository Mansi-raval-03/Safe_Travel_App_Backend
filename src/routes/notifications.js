const express = require('express');
const { query } = require('express-validator');
const auth = require('../middleware/auth');

const router = express.Router();

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

module.exports = router;
