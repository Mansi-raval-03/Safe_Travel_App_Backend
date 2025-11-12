const mongoose = require('mongoose');
const { Schema } = mongoose;

// Sub-schema for trip location
const TripLocationSchema = new Schema({
  latitude: {
    type: Number,
    required: true,
    min: -90,
    max: 90,
  },
  longitude: {
    type: Number,
    required: true,
    min: -180,
    max: 180,
  },
  address: {
    type: String,
    trim: true,
    maxlength: 500
  },
  name: {
    type: String,
    trim: true,
    maxlength: 100
  }
}, { _id: false });

// Main TripEvent schema
const TripEventSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 200
  },
  startTime: {
    type: Date,
    required: true,
    validate: {
      validator: function(v) {
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        return v >= oneYearAgo;
      },
      message: 'Start time cannot be more than 1 year in the past'
    }
  },
  endTime: {
    type: Date,
    required: true,
    validate: {
      validator: function(v) {
        return this.startTime ? v > this.startTime : true;
      },
      message: 'End time must be after start time'
    }
  },
  destination: {
    type: TripLocationSchema,
    required: true
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  status: {
    type: String,
    enum: ['scheduled', 'active', 'completed', 'missed', 'alert_triggered', 'cancelled'],
    default: 'scheduled',
    index: true
  },
  travelMode: {
    type: String,
    enum: ['walking', 'driving', 'public_transport', 'cycling', 'other'],
    default: 'other'
  },
  currentLocation: {
    type: TripLocationSchema,
    default: null
  },
  lastLocationUpdate: {
    type: Date,
    default: null,
    index: true
  },
  isEmergencyContactsNotified: {
    type: Boolean,
    default: false
  },
  alertHistory: [{
    message: { type: String },
    alertType: { type: String, enum: ['location_timeout', 'destination_mismatch', 'overdue', 'manual', 'system'] },
    timestamp: { type: Date, default: Date.now }
  }],
  alertThresholds: {
    locationTimeoutMinutes: { type: Number, default: 30, min: 5, max: 180 },
    destinationToleranceMeters: { type: Number, default: 500, min: 50, max: 5000 }
  },
  isActive: { type: Boolean, default: true, index: true },
  syncVersion: { type: Number, default: 1 }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
TripEventSchema.index({ userId: 1, status: 1 });
TripEventSchema.index({ userId: 1, startTime: 1 });
TripEventSchema.index({ userId: 1, endTime: 1 });
TripEventSchema.index({ status: 1, endTime: 1 });
TripEventSchema.index({ status: 1, lastLocationUpdate: 1 });

// Virtuals
TripEventSchema.virtual('duration').get(function() { return this.endTime - this.startTime; });
TripEventSchema.virtual('isCurrentlyActive').get(function() {
  const now = new Date();
  return now >= this.startTime && now <= this.endTime && this.status === 'active';
});
TripEventSchema.virtual('isUpcoming').get(function() { return new Date() < this.startTime && this.status === 'scheduled'; });
TripEventSchema.virtual('hasEnded').get(function() { return new Date() > this.endTime; });
TripEventSchema.virtual('timeUntilStart').get(function() { const now = new Date(); return now < this.startTime ? this.startTime - now : null; });
TripEventSchema.virtual('timeRemaining').get(function() { const now = new Date(); return now < this.endTime ? this.endTime - now : null; });

// Instance methods
TripEventSchema.methods.updateLocation = function(latitude, longitude, address = null, name = null) {
  this.currentLocation = { latitude, longitude, address, name };
  this.lastLocationUpdate = new Date();
  this.syncVersion += 1;
};

TripEventSchema.methods.addAlert = function(alertType, message) {
  this.alertHistory.push({ message, alertType, timestamp: new Date() });
  this.syncVersion += 1;
};

TripEventSchema.methods.updateStatus = function(newStatus) {
  const oldStatus = this.status;
  this.status = newStatus;
  this.syncVersion += 1;
  this.addAlert('system', `Status changed from ${oldStatus} to ${newStatus}`);
  if (newStatus === 'active' && oldStatus === 'scheduled') this.lastLocationUpdate = new Date();
  if (['completed','missed','cancelled'].includes(newStatus) && !this.lastLocationUpdate) this.lastLocationUpdate = new Date();
};

TripEventSchema.methods.shouldTriggerLocationAlert = function() {
  if (!this.isCurrentlyActive || !this.lastLocationUpdate) return false;
  const diff = new Date() - this.lastLocationUpdate;
  const thresholdMs = (this.alertThresholds?.locationTimeoutMinutes || 30) * 60 * 1000;
  return diff > thresholdMs;
};

TripEventSchema.methods.calculateDistanceToDestination = function() {
  if (!this.currentLocation || !this.destination) return Infinity;
  const R = 6371e3;
  const φ1 = this.currentLocation.latitude * Math.PI/180;
  const φ2 = this.destination.latitude * Math.PI/180;
  const Δφ = (this.destination.latitude - this.currentLocation.latitude) * Math.PI/180;
  const Δλ = (this.destination.longitude - this.currentLocation.longitude) * Math.PI/180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

TripEventSchema.methods.shouldTriggerDestinationAlert = function() {
  if (!this.hasEnded || !this.currentLocation || this.status === 'completed') return false;
  const distance = this.calculateDistanceToDestination();
  const tol = (this.alertThresholds?.destinationToleranceMeters) || 500;
  return distance > tol;
};

// Statics
TripEventSchema.statics.findActiveTrips = function() {
  const now = new Date();
  return this.find({ status: 'active', startTime: { $lte: now }, endTime: { $gte: now }, isActive: true }).populate('userId', 'name email phone');
};
TripEventSchema.statics.findOverdueTrips = function() { const now = new Date(); return this.find({ status: 'active', endTime: { $lt: now }, isActive: true }).populate('userId', 'name email phone'); };
TripEventSchema.statics.findTripsNeedingLocationCheck = function() { const now = new Date(); const thirty = new Date(now.getTime() - 30*60*1000); return this.find({ status: 'active', startTime: { $lte: now }, endTime: { $gte: now }, $or: [{ lastLocationUpdate: { $lt: thirty } }, { lastLocationUpdate: null }], isActive: true }).populate('userId', 'name email phone'); };
TripEventSchema.statics.getUserTrips = function(userId, status = null) { const q = { userId, isActive: true }; if (status) q.status = status; return this.find(q).sort({ startTime: -1 }); };

// Pre-save
TripEventSchema.pre('save', function(next) {
  if (this.startTime >= this.endTime) return next(new Error('End time must be after start time'));
  next();
});

const TripEvent = mongoose.model('TripEvent', TripEventSchema);
module.exports = TripEvent;