const TripEvent = require('../models/TripEvent');
const User = require('../models/User');
const ContactNotification = require('../models/ContactNotification');
const sosService = require('../services/sosService');

exports.createEvent = async (req, res, next) => {
  try {
    const payload = req.body;
    const event = new TripEvent({
      userId: payload.userId,
      title: payload.title,
      startTime: new Date(payload.startTime),
      endTime: new Date(payload.endTime),
      destination: { lat: payload.destinationLat, long: payload.destinationLong },
      notes: payload.notes,
      modeOfTravel: payload.modeOfTravel,
    });

    await event.save();
    return res.status(201).json({ success: true, message: 'Trip event created', data: event });
  } catch (error) {
    next(error);
  }
};

exports.getUserEvents = async (req, res, next) => {
  try {
    const userId = req.params.id;
    const events = await TripEvent.find({ userId }).sort({ startTime: 1 });
    return res.status(200).json({ success: true, data: events });
  } catch (error) {
    next(error);
  }
};

exports.updateEvent = async (req, res, next) => {
  try {
    const id = req.params.id;
    const update = req.body;
    const event = await TripEvent.findByIdAndUpdate(id, update, { new: true });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    return res.status(200).json({ success: true, data: event });
  } catch (error) {
    next(error);
  }
};

// Helper to mark event as alert_triggered and notify emergency contacts
exports.triggerAlertForEvent = async (event) => {
  try {
    // set status
    event.status = 'alert_triggered';
    await event.save();

    // find user and their emergency contacts
    const user = await User.findById(event.userId).lean().exec();
    const contacts = await ContactNotification.find({ userId: event.userId }).lean().exec();

    // build a fake alert object
    const alert = {
      _id: `trip_alert_${Date.now()}`,
      userId: event.userId,
      message: `Trip alert for ${event.title} — user may be missing or offline`,
      location: { lat: event.destination.lat, long: event.destination.long }
    };

    // Use sosService to notify contacts (placeholder)
    await sosService.notifyEmergencyContacts(alert, contacts, user);

    return true;
  } catch (error) {
    console.error('Error triggering alert for event:', error);
    return false;
  }
};
