const mongoose = require('mongoose');

// Sub-schema for trip location
const TripLocationSchema = new mongoose.Schema({
  latitude: {
    type: Number,
    required: true,
    min: -90,
    max: 90,
    validate: {
      validator: function(v) {
        return v >= -90 && v <= 90;
      },
      message: 'Latitude must be between -90 and 90'
    }
  },
  longitude: {
    type: Number,
    required: true,
    min: -180,
    max: 180,
    validate: {
      validator: function(v) {
        return v >= -180 && v <= 180;
      },
      message: 'Longitude must be between -180 and 180'
    }
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
const TripEventSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
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
        // Start time should not be in the far past (more than 1 year ago)
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
        // End time must be after start time
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
  
  // Location tracking fields
  currentLocation: {
    type: TripLocationSchema,
    default: null
  },
  lastLocationUpdate: {
    type: Date,
    default: null,
    index: true
  },
  
  // Alert and notification fields
  isEmergencyContactsNotified: {
    type: Boolean,
    default: false
  },
  alertHistory: [{
    type: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    alertType: {
      type: String,
      enum: ['location_timeout', 'destination_mismatch', 'overdue', 'manual', 'system']
    }
  }],
  
  // Monitoring configuration
  alertThresholds: {
    locationTimeoutMinutes: {
      type: Number,
      default: 30,
      min: 5,
      max: 180
    },
    destinationToleranceMeters: {
      type: Number,
      default: 500,
      min: 50,
      max: 5000
    }
  },
  
  // System fields
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  syncVersion: {
    type: Number,
    default: 1
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for efficient queries
TripEventSchema.index({ userId: 1, status: 1 });
TripEventSchema.index({ userId: 1, startTime: 1 });
TripEventSchema.index({ userId: 1, endTime: 1 });
TripEventSchema.index({ status: 1, endTime: 1 }); // For monitoring active trips
TripEventSchema.index({ status: 1, lastLocationUpdate: 1 }); // For location timeout checks
TripEventSchema.index({ createdAt: 1 });

// Virtual fields
TripEventSchema.virtual('duration').get(function() {
  return this.endTime - this.startTime;
});

TripEventSchema.virtual('isCurrentlyActive').get(function() {
  const now = new Date();
  return now >= this.startTime && now <= this.endTime && this.status === 'active';
});

TripEventSchema.virtual('isUpcoming').get(function() {
  return new Date() < this.startTime && this.status === 'scheduled';
});

TripEventSchema.virtual('hasEnded').get(function() {
  return new Date() > this.endTime;
});

TripEventSchema.virtual('timeUntilStart').get(function() {
  const now = new Date();
  return now < this.startTime ? this.startTime - now : null;
});

TripEventSchema.virtual('timeRemaining').get(function() {
  const now = new Date();
  return now < this.endTime ? this.endTime - now : null;
});

// Instance methods
TripEventSchema.methods.updateLocation = function(latitude, longitude, address = null, name = null) {
  this.currentLocation = {
    latitude,
    longitude,
    address,
    name
  };
  this.lastLocationUpdate = new Date();
  this.syncVersion += 1;
};

TripEventSchema.methods.addAlert = function(alertType, message) {
  this.alertHistory.push({
    type: message,
    alertType,
    timestamp: new Date()
  });
  this.syncVersion += 1;
};

TripEventSchema.methods.updateStatus = function(newStatus) {
  const oldStatus = this.status;
  this.status = newStatus;
  this.syncVersion += 1;
  
  // Add status change to alert history
  this.addAlert('system', `Status changed from ${oldStatus} to ${newStatus}`);
  
  // Auto-update timestamps based on status
  if (newStatus === 'active' && oldStatus === 'scheduled') {
    // Trip started
    this.lastLocationUpdate = new Date();
  } else if (['completed', 'missed', 'cancelled'].includes(newStatus)) {
    // Trip ended
    if (!this.lastLocationUpdate) {
      this.lastLocationUpdate = new Date();
    }
  }
};

TripEventSchema.methods.shouldTriggerLocationAlert = function() {
  if (!this.isCurrentlyActive || !this.lastLocationUpdate) {
    return false;
  }
  
  const timeSinceLastUpdate = new Date() - this.lastLocationUpdate;
  const thresholdMs = this.alertThresholds.locationTimeoutMinutes * 60 * 1000;
  
  return timeSinceLastUpdate > thresholdMs;
};

TripEventSchema.methods.shouldTriggerDestinationAlert = function() {
  if (!this.hasEnded || !this.currentLocation || this.status === 'completed') {
    return false;
  }
  
  // Calculate distance between current location and destination
  const distance = this.calculateDistanceToDestination();
  return distance > this.alertThresholds.destinationToleranceMeters;
};

TripEventSchema.methods.calculateDistanceToDestination = function() {
  if (!this.currentLocation || !this.destination) {
    return Infinity;
  }
  
  // Haversine formula for calculating distance between two points
  const R = 6371e3; // Earth's radius in meters
  const φ1 = this.currentLocation.latitude * Math.PI/180;
  const φ2 = this.destination.latitude * Math.PI/180;
  const Δφ = (this.destination.latitude - this.currentLocation.latitude) * Math.PI/180;
  const Δλ = (this.destination.longitude - this.currentLocation.longitude) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
};

// Static methods
TripEventSchema.statics.findActiveTrips = function() {
  const now = new Date();
  return this.find({
    status: 'active',
    startTime: { $lte: now },
    endTime: { $gte: now },
    isActive: true
  }).populate('userId', 'name email phone');
};

TripEventSchema.statics.findOverdueTrips = function() {
  const now = new Date();
  return this.find({
    status: 'active',
    endTime: { $lt: now },
    isActive: true
  }).populate('userId', 'name email phone');
};

TripEventSchema.statics.findTripsNeedingLocationCheck = function() {
  const now = new Date();
  const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
  
  return this.find({
    status: 'active',
    startTime: { $lte: now },
    endTime: { $gte: now },
    $or: [
      { lastLocationUpdate: { $lt: thirtyMinutesAgo } },
      { lastLocationUpdate: null }
    ],
    isActive: true
  }).populate('userId', 'name email phone');
};

TripEventSchema.statics.getUserTrips = function(userId, status = null) {
  const query = { userId, isActive: true };
  if (status) {
    query.status = status;
  }
  return this.find(query).sort({ startTime: -1 });
};

// Pre-save middleware
TripEventSchema.pre('save', function(next) {
  // Validate start and end times
  if (this.startTime >= this.endTime) {
    return next(new Error('End time must be after start time'));
  }
  
  // Auto-set status based on current time
  const now = new Date();
  if (this.isNew || this.isModified('startTime') || this.isModified('endTime')) {
    if (now < this.startTime && this.status === 'active') {
      this.status = 'scheduled';
    } else if (now >= this.startTime && now <= this.endTime && this.status === 'scheduled') {
      // Don't auto-activate, let the monitoring system handle it
    } else if (now > this.endTime && ['scheduled', 'active'].includes(this.status)) {
      // Don't auto-complete, let the monitoring system handle it
    }
  }
  
  next();
});

// Post-save middleware for logging
TripEventSchema.post('save', function(doc) {
  console.log(`TripEvent ${doc._id} saved with status: ${doc.status}`);
});

const TripEvent = mongoose.model('TripEvent', TripEventSchema);

module.exports = TripEvent;