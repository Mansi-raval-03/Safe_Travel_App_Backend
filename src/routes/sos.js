const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const SOSAlert = require('../models/SOSAlert');
const ContactNotification = require('../models/ContactNotification');
const EmergencyContact = require('../models/EmergencyContact');
const auth = require('../middleware/auth');
const sosService = require('../services/sosService');

const router = express.Router();

// SOS-specific rate limiting
const sosLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 requests per windowMs
  message: 'Too many SOS requests, please try again later.'
});

// Trigger SOS alert
router.post('/trigger', auth, sosLimiter, [
  body('latitude').isFloat({ min: -90, max: 90 }),
  body('longitude').isFloat({ min: -180, max: 180 }),
  body('address').optional().isLength({ max: 255 }),
  body('emergencyType').optional().isIn(['medical', 'police', 'fire', 'general']),
  body('message').optional().isLength({ max: 500 }),
  body('immediateAlert').optional().isBoolean()
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

    const {
      latitude,
      longitude,
      address,
      emergencyType = 'general',
      message,
      immediateAlert = false
    } = req.body;

    // Create SOS alert
    const alert = new SOSAlert({
      userId: req.user._id,
      status: 'active',
      emergencyType,
      location: {
        latitude,
        longitude,
        address: address || 'Location not specified'
      },
      message: message || 'Emergency assistance required',
      emergencyServicesNotified: false,
      immediateAlert
    });

    await alert.save();

    // Get user's emergency contacts
    const emergencyContacts = await EmergencyContact.find({ userId: req.user._id })
      .sort({ isPrimary: -1, createdAt: 1 });

    // Create contact notifications
    const contactNotifications = await Promise.all(
      emergencyContacts.map(async contact => {
        const notification = new ContactNotification({
          alertId: alert._id,
          contactId: contact._id,
          notificationStatus: 'pending'
        });
        return await notification.save();
      })
    );

    // Trigger emergency services notification
    if (immediateAlert) {
      try {
        const result = await sosService.notifyEmergencyServices(alert, req.user);
        if (result.success) {
          alert.emergencyServicesNotified = true;
          alert.emergencyServicesNotifiedAt = result.notifiedAt;
          await alert.save();
        }
      } catch (serviceError) {
        console.error('Emergency services notification failed:', serviceError);
      }
    }

    // Send notifications to emergency contacts (async)
    sosService.notifyEmergencyContacts(alert, emergencyContacts, req.user)
      .catch(error => console.error('Contact notifications failed:', error));

    // Send push notifications to other app users (async)
    sosService.notifyPushToAllUsers(alert, req.user)
      .then(res => console.log('Push notify result:', res))
      .catch(err => console.error('Push notifications failed:', err));

    // Populate contact details for response
    const populatedNotifications = await ContactNotification.find({ alertId: alert._id })
      .populate('contactId', 'name phone relationship');

    res.status(201).json({
      success: true,
      message: 'SOS alert triggered successfully',
      data: {
        alert: {
          id: alert._id,
          userId: alert.userId,
          status: alert.status,
          emergencyType: alert.emergencyType,
          location: alert.location,
          message: alert.message,
          emergencyServices: {
            notified: alert.emergencyServicesNotified,
            notifiedAt: alert.emergencyServicesNotifiedAt
          },
          contacts: populatedNotifications.map(cn => ({
            contactId: cn.contactId._id,
            name: cn.contactId.name,
            phone: cn.contactId.phone,
            relationship: cn.contactId.relationship,
            notificationStatus: cn.notificationStatus,
            notifiedAt: cn.notifiedAt
          })),
          createdAt: alert.createdAt,
          updatedAt: alert.updatedAt
        }
      }
    });
  } catch (error) {
    console.error('SOS trigger error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get alert status
router.get('/alerts/:alertId', auth, async (req, res) => {
  try {
    const { alertId } = req.params;

    const alert = await SOSAlert.findOne({ 
      _id: alertId, 
      userId: req.user._id 
    });

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }

    const contactNotifications = await ContactNotification.find({ alertId: alert._id })
      .populate('contactId', 'name phone relationship');

    res.json({
      success: true,
      data: {
        alert: {
          id: alert._id,
          status: alert.status,
          emergencyType: alert.emergencyType,
          location: alert.location,
          message: alert.message,
          emergencyServices: {
            notified: alert.emergencyServicesNotified,
            notifiedAt: alert.emergencyServicesNotifiedAt
          },
          contacts: contactNotifications.map(cn => ({
            contactId: cn.contactId._id,
            name: cn.contactId.name,
            phone: cn.contactId.phone,
            relationship: cn.contactId.relationship,
            notificationStatus: cn.notificationStatus,
            notifiedAt: cn.notifiedAt
          })),
          createdAt: alert.createdAt,
          updatedAt: alert.updatedAt
        }
      }
    });
  } catch (error) {
    console.error('Get alert status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Cancel alert
router.post('/alerts/:alertId/cancel', auth, [
  body('reason').optional().isLength({ max: 200 })
], async (req, res) => {
  try {
    const { alertId } = req.params;
    const { reason } = req.body;

    const alert = await SOSAlert.findOne({
      _id: alertId,
      userId: req.user._id,
      status: 'active'
    });

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Active alert not found'
      });
    }

    alert.status = 'cancelled';
    alert.cancelledAt = new Date();
    alert.cancelReason = reason || 'Cancelled by user';
    await alert.save();

    res.json({
      success: true,
      message: 'SOS alert cancelled successfully',
      data: {
        alert: {
          id: alert._id,
          status: 'cancelled',
          cancelledAt: alert.cancelledAt,
          cancelReason: alert.cancelReason
        }
      }
    });
  } catch (error) {
    console.error('Cancel alert error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get active alerts
router.get('/alerts/active', auth, async (req, res) => {
  try {
    const alerts = await SOSAlert.find({
      userId: req.user._id,
      status: 'active'
    })
    .select('_id status emergencyType location createdAt')
    .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        alerts: alerts.map(alert => ({
          id: alert._id,
          status: alert.status,
          emergencyType: alert.emergencyType,
          location: alert.location,
          createdAt: alert.createdAt
        }))
      }
    });
  } catch (error) {
    console.error('Get active alerts error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
