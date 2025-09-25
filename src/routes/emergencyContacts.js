const express = require('express');
const { body, validationResult } = require('express-validator');
const EmergencyContact = require('../models/EmergencyContact');
const auth = require('../middleware/auth');

const router = express.Router();

// Get all emergency contacts
router.get('/', auth, async (req, res) => {
  try {
    const contacts = await EmergencyContact.find({ userId: req.user._id })
      .sort({ isPrimary: -1, createdAt: 1 });

    res.json({
      success: true,
      data: {
        contacts
      }
    });
  } catch (error) {
    console.error('Get contacts error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Add emergency contact
router.post('/', auth, [
  body('name').isLength({ min: 2, max: 50 }).trim(),
  body('phone').matches(/^[\+]?[1-9][\d]{0,15}$/),
  body('relationship').isLength({ min: 1, max: 50 }).trim(),
  body('isPrimary').optional().isBoolean()
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

    const { name, phone, relationship, isPrimary = false } = req.body;

    const contact = new EmergencyContact({
      userId: req.user._id,
      name,
      phone,
      relationship,
      isPrimary
    });

    await contact.save();

    res.status(201).json({
      success: true,
      message: 'Emergency contact added successfully',
      data: {
        contact
      }
    });
  } catch (error) {
    console.error('Add contact error:', error);
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Contact with this phone number already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update emergency contact
router.put('/:contactId', auth, [
  body('name').optional().isLength({ min: 2, max: 50 }).trim(),
  body('phone').optional().matches(/^[\+]?[1-9][\d]{0,15}$/),
  body('relationship').optional().isLength({ min: 1, max: 50 }).trim(),
  body('isPrimary').optional().isBoolean()
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

    const { contactId } = req.params;
    const updateData = req.body;

    const contact = await EmergencyContact.findOneAndUpdate(
      { _id: contactId, userId: req.user._id },
      updateData,
      { new: true, runValidators: true }
    );

    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Emergency contact not found'
      });
    }

    res.json({
      success: true,
      message: 'Emergency contact updated successfully',
      data: {
        contact
      }
    });
  } catch (error) {
    console.error('Update contact error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Delete emergency contact
router.delete('/:contactId', auth, async (req, res) => {
  try {
    const { contactId } = req.params;

    const contact = await EmergencyContact.findOneAndDelete({
      _id: contactId,
      userId: req.user._id
    });

    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Emergency contact not found'
      });
    }

    res.json({
      success: true,
      message: 'Emergency contact deleted successfully'
    });
  } catch (error) {
    console.error('Delete contact error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
