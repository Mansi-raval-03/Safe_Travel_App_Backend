const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const TripHistory = require('../models/TripHistory');
const auth = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const tripsLimiter = rateLimit({ windowMs: 15*60*1000, max: 100, message: { success:false, message: 'Too many requests' } });
router.use(tripsLimiter);

// Simple validator for creation
const createValidation = [
  body('title').notEmpty().isLength({ min:1, max:200 }).trim(),
  body('startTime').isISO8601().withMessage('startTime must be ISO8601'),
  body('endTime').isISO8601().withMessage('endTime must be ISO8601'),
  body('destination.latitude').isFloat({ min:-90, max:90 }),
  body('destination.longitude').isFloat({ min:-180, max:180 }),
];

// Create trip history entry (requires auth)
router.post('/', auth, createValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success:false, message:'Validation errors', errors: errors.array() });
  try {
    const { title, startTime, endTime, destination, notes, travelMode } = req.body;
    const doc = new TripHistory({ userId: req.user._id, title, startTime: new Date(startTime), endTime: new Date(endTime), destination, notes, travelMode: travelMode || 'other' });
    await doc.save();
    return res.status(201).json({ success:true, message:'Trip saved', data: { trip: doc } });
  } catch (err) {
    console.error('Create trip history error:', err);
    return res.status(500).json({ success:false, message:'Internal server error' });
  }
});

// Fetch user trips (with optional limit)
router.get('/user/:userId?', auth, [ param('userId').optional().isMongoId(), query('limit').optional().isInt({ min:1, max:200 }) ], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success:false, message:'Validation errors', errors: errors.array() });
  try {
    const userId = req.params.userId || req.user._id;
    if (userId.toString() !== req.user._id.toString()) return res.status(403).json({ success:false, message:'Access denied' });
    const limit = parseInt(req.query.limit || '20');
    const trips = await TripHistory.find({ userId }).sort({ startTime: -1 }).limit(limit);
    return res.json({ success:true, message:'Trip history retrieved', data: { trips } });
  } catch (err) {
    console.error('Fetch trip history error:', err);
    return res.status(500).json({ success:false, message:'Internal server error' });
  }
});

module.exports = router;
