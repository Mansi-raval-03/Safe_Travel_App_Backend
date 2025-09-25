const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// Get user profile
router.get('/profile', auth, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        user: req.user.toJSON()
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update user profile
router.put('/profile', auth, [
  body('name').optional().isLength({ min: 2, max: 50 }).trim(),
  body('phone').optional().matches(/^[\+]?[1-9][\d]{0,15}$/),
  body('profileImage').optional().isString()
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

    const { name, phone, profileImage } = req.body;
    const updateData = {};
    
    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (profileImage !== undefined) updateData.profileImage = profileImage;

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      updateData,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: updatedUser.toJSON()
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update user settings
router.put('/settings', auth, [
  body('notifications').optional().isBoolean(),
  body('locationSharing').optional().isBoolean(),
  body('offlineMode').optional().isBoolean(),
  body('emergencyAlerts').optional().isBoolean()
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

    const { notifications, locationSharing, offlineMode, emergencyAlerts } = req.body;
    const settingsUpdate = {};
    
    if (notifications !== undefined) settingsUpdate['settings.notifications'] = notifications;
    if (locationSharing !== undefined) settingsUpdate['settings.locationSharing'] = locationSharing;
    if (offlineMode !== undefined) settingsUpdate['settings.offlineMode'] = offlineMode;
    if (emergencyAlerts !== undefined) settingsUpdate['settings.emergencyAlerts'] = emergencyAlerts;

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $set: settingsUpdate },
      { new: true }
    );

    res.json({
      success: true,
      message: 'Settings updated successfully',
      data: {
        settings: updatedUser.settings
      }
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
