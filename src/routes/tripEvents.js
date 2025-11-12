const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const TripEvent = require('../models/TripEvent');
const auth = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Rate limiting
const tripEventLimiter = rateLimit({ windowMs: 15*60*1000, max: 50, message: { success: false, message: 'Too many trip event requests, try later' } });
router.use(tripEventLimiter);

const tripEventValidation = [
  body('title').notEmpty().withMessage('Title is required').isLength({ min:1, max:200 }).trim(),
  body('startTime').isISO8601().withMessage('Start time must be ISO8601').custom(v => { const d = new Date(v); const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear()-1); if (d < oneYearAgo) throw new Error('Start time cannot be more than 1 year in the past'); return true; }),
  body('endTime').isISO8601().withMessage('End time must be ISO8601').custom((v, { req }) => { const end = new Date(v); const start = new Date(req.body.startTime); if (end <= start) throw new Error('End time must be after start time'); return true; }),
  body('destination.latitude').isFloat({ min:-90, max:90 }).withMessage('Latitude must be between -90 and 90'),
  body('destination.longitude').isFloat({ min:-180, max:180 }).withMessage('Longitude must be between -180 and 180'),
  body('notes').optional().isLength({ max:1000 }).trim(),
  body('travelMode').optional().isIn(['walking','driving','public_transport','cycling','other']),
  body('alertThresholds.locationTimeoutMinutes').optional().isInt({ min:5, max:180 }),
  body('alertThresholds.destinationToleranceMeters').optional().isInt({ min:50, max:5000 })
];

// Create
router.post('/create', auth, tripEventValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success:false, message:'Validation errors', errors: errors.array() });
  try {
    const { title, startTime, endTime, destination, notes, travelMode, alertThresholds } = req.body;
    const trip = new TripEvent({ userId: req.user._id, title, startTime: new Date(startTime), endTime: new Date(endTime), destination, notes, travelMode: travelMode || 'other', alertThresholds: alertThresholds || undefined });
    await trip.save();
    return res.status(201).json({ success:true, message:'Trip event created', data: { tripEvent: trip } });
  } catch (err) {
    console.error('Create trip event error:', err);
    return res.status(500).json({ success:false, message:'Internal server error' });
  }
});

// Get user trips
router.get('/user/:userId?', auth, [ param('userId').optional().isMongoId(), query('status').optional().isIn(['scheduled','active','completed','missed','alert_triggered','cancelled']), query('limit').optional().isInt({ min:1, max:100 }), query('offset').optional().isInt({ min:0 }) ], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success:false, message:'Validation errors', errors: errors.array() });
  try {
    const userId = req.params.userId || req.user._id;
    if (userId.toString() !== req.user._id.toString()) return res.status(403).json({ success:false, message:'Access denied' });
    const { status, limit = 20, offset = 0 } = req.query;
    const q = { userId, isActive: true }; if (status) q.status = status;
    const trips = await TripEvent.find(q).sort({ startTime:-1 }).limit(parseInt(limit)).skip(parseInt(offset));
    const total = await TripEvent.countDocuments(q);
    return res.json({ success:true, message:'Trip events retrieved', data: { tripEvents: trips, pagination: { total, limit: parseInt(limit), offset: parseInt(offset), hasMore: total > parseInt(offset) + trips.length } } });
  } catch (err) { console.error('Get trip events error:', err); return res.status(500).json({ success:false, message:'Internal server error' }); }
});

// Get specific trip
router.get('/:tripId', auth, [ param('tripId').isMongoId() ], async (req, res) => {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ success:false, message:'Validation errors', errors: errors.array() });
  try {
    const trip = await TripEvent.findOne({ _id: req.params.tripId, userId: req.user._id, isActive: true });
    if (!trip) return res.status(404).json({ success:false, message:'Trip event not found' });
    return res.json({ success:true, message:'Trip event retrieved', data: { tripEvent: trip } });
  } catch (err) { console.error('Get trip event error:', err); return res.status(500).json({ success:false, message:'Internal server error' }); }
});

// Update trip
router.patch('/update/:tripId', auth, [ param('tripId').isMongoId() ], async (req, res) => {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ success:false, message:'Validation errors', errors: errors.array() });
  try {
    const trip = await TripEvent.findOne({ _id: req.params.tripId, userId: req.user._id, isActive: true });
    if (!trip) return res.status(404).json({ success:false, message:'Trip event not found' });
    if (['completed','cancelled'].includes(trip.status)) return res.status(400).json({ success:false, message:'Cannot update completed or cancelled trips' });
    const allowed = ['title','startTime','endTime','destination','notes','travelMode','status','alertThresholds'];
    allowed.forEach(f => { if (req.body[f] !== undefined) { trip[f] = (f==='startTime' || f==='endTime') ? new Date(req.body[f]) : req.body[f]; } });
    if (req.body.status) { trip.updateStatus(req.body.status); }
    await trip.save();
    return res.json({ success:true, message:'Trip event updated', data: { tripEvent: trip } });
  } catch (err) { console.error('Update trip event error:', err); return res.status(500).json({ success:false, message:'Internal server error' }); }
});

// Update location
router.patch('/location/:tripId', auth, [ param('tripId').isMongoId(), body('latitude').isFloat({ min:-90, max:90 }), body('longitude').isFloat({ min:-180, max:180 }) ], async (req, res) => {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ success:false, message:'Validation errors', errors: errors.array() });
  try {
    const trip = await TripEvent.findOne({ _id: req.params.tripId, userId: req.user._id, isActive: true });
    if (!trip) return res.status(404).json({ success:false, message:'Trip event not found' });
    if (trip.status !== 'active') return res.status(400).json({ success:false, message:'Can only update location for active trips' });
    const { latitude, longitude, address, name } = req.body; trip.updateLocation(latitude, longitude, address, name); await trip.save();
    return res.json({ success:true, message:'Trip location updated', data: { currentLocation: trip.currentLocation, lastLocationUpdate: trip.lastLocationUpdate, distanceToDestination: trip.calculateDistanceToDestination() } });
  } catch (err) { console.error('Update trip location error:', err); return res.status(500).json({ success:false, message:'Internal server error' }); }
});

// Delete (soft)
router.delete('/:tripId', auth, [ param('tripId').isMongoId() ], async (req, res) => {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ success:false, message:'Validation errors', errors: errors.array() });
  try {
    const trip = await TripEvent.findOne({ _id: req.params.tripId, userId: req.user._id, isActive: true });
    if (!trip) return res.status(404).json({ success:false, message:'Trip event not found' });
    trip.isActive = false; trip.updateStatus('cancelled'); await trip.save();
    return res.json({ success:true, message:'Trip event deleted' });
  } catch (err) { console.error('Delete trip event error:', err); return res.status(500).json({ success:false, message:'Internal server error' }); }
});

// Monitoring endpoints (read-only)
router.get('/monitoring/active', auth, async (req, res) => { try { const active = await TripEvent.findActiveTrips(); return res.json({ success:true, message:'Active trips', data:{ activeTrips: active, count: active.length } }); } catch (err) { console.error(err); return res.status(500).json({ success:false, message:'Internal server error' }); } });
router.get('/monitoring/overdue', auth, async (req, res) => { try { const overdue = await TripEvent.findOverdueTrips(); return res.json({ success:true, message:'Overdue trips', data:{ overdueTrips: overdue, count: overdue.length } }); } catch (err) { console.error(err); return res.status(500).json({ success:false, message:'Internal server error' }); } });

module.exports = router;