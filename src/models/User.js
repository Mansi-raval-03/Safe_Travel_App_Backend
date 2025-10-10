const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 50
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  phone: {
    type: String,
    required: true,
    match: [/^[\+]?[1-9][\d]{0,15}$/, 'Please enter a valid phone number']
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
    maxlength: 128
  },
  profileImage: {
    type: String,
    default: null
  },
  settings: {
    notifications: { type: Boolean, default: true },
    locationSharing: { type: Boolean, default: true },
    offlineMode: { type: Boolean, default: false },
    emergencyAlerts: { type: Boolean, default: true },
    autoSOSEnabled: { type: Boolean, default: true },
    deviationThresholdMeters: { type: Number, default: 500 },
    inactivityThresholdMinutes: { type: Number, default: 30 }
  },
  // Default/safe location for deviation checking
  defaultLocation: {
    latitude: { 
      type: Number, 
      min: -90, 
      max: 90,
      default: null 
    },
    longitude: { 
      type: Number, 
      min: -180, 
      max: 180,
      default: null 
    },
    address: { type: String, trim: true, default: null },
    setAt: { type: Date, default: null }
  },
  // Last known location for tracking
  lastKnownLocation: {
    latitude: { 
      type: Number, 
      min: -90, 
      max: 90,
      default: null 
    },
    longitude: { 
      type: Number, 
      min: -180, 
      max: 180,
      default: null 
    },
    accuracy: { type: Number, default: 0 },
    address: { type: String, trim: true, default: null },
    updatedAt: { type: Date, default: null }
  },
  // Last activity timestamp for inactivity detection
  lastActiveAt: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isEmailVerified: {
    type: Boolean,
    default: true
  },
  emailVerifiedAt: {
    type: Date,
    default: Date.now
  },
  emailVerificationToken: {
    type: String,
    default: null
  },
  registrationStep: {
    type: String,
    enum: ['email_verification', 'profile_setup', 'completed'],
    default: 'completed'
  }
}, {
  timestamps: true,
  toJSON: { 
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.emailVerificationToken;
      return ret;
    }
  }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Instance method to check password
userSchema.methods.validatePassword = async function(password) {
  return bcrypt.compare(password, this.password);
};

// Instance method to verify email
userSchema.methods.verifyEmail = function() {
  this.isEmailVerified = true;
  this.emailVerifiedAt = new Date();
  this.registrationStep = 'profile_setup';
  return this.save();
};

// Instance method to complete registration
userSchema.methods.completeRegistration = function() {
  this.registrationStep = 'completed';
  this.isActive = true;
  return this.save();
};

// Static method to find verified users
userSchema.statics.findVerified = function(conditions = {}) {
  return this.find({ ...conditions, isEmailVerified: true });
};

// Instance method to update last activity
userSchema.methods.updateActivity = function() {
  this.lastActiveAt = new Date();
  return this.save();
};

// Instance method to update last known location
userSchema.methods.updateLastKnownLocation = function(latitude, longitude, accuracy, address) {
  this.lastKnownLocation = {
    latitude,
    longitude,
    accuracy: accuracy || 0,
    address: address || null,
    updatedAt: new Date()
  };
  this.lastActiveAt = new Date(); // Update activity when location is updated
  return this.save();
};

// Instance method to set default/safe location
userSchema.methods.setDefaultLocation = function(latitude, longitude, address) {
  this.defaultLocation = {
    latitude,
    longitude,
    address: address || null,
    setAt: new Date()
  };
  return this.save();
};

// Instance method to check if user is inactive
userSchema.methods.isInactive = function() {
  if (!this.lastActiveAt) return true;
  
  const inactivityThreshold = this.settings?.inactivityThresholdMinutes || 30;
  const thresholdMs = inactivityThreshold * 60 * 1000; // Convert to milliseconds
  const timeSinceLastActivity = Date.now() - this.lastActiveAt.getTime();
  
  return timeSinceLastActivity > thresholdMs;
};

// Instance method to calculate distance from default location
userSchema.methods.calculateDeviationFromDefault = function() {
  const { defaultLocation, lastKnownLocation } = this;
  
  if (!defaultLocation?.latitude || !defaultLocation?.longitude || 
      !lastKnownLocation?.latitude || !lastKnownLocation?.longitude) {
    return null;
  }
  
  return this.calculateDistance(
    defaultLocation.latitude, defaultLocation.longitude,
    lastKnownLocation.latitude, lastKnownLocation.longitude
  );
};

// Instance method to calculate distance between two coordinates (Haversine formula)
userSchema.methods.calculateDistance = function(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
    
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  
  return R * c; // Distance in meters
};

// Instance method to check if location has deviated beyond threshold
userSchema.methods.hasLocationDeviated = function() {
  const deviationDistance = this.calculateDeviationFromDefault();
  
  if (deviationDistance === null) return false;
  
  const threshold = this.settings?.deviationThresholdMeters || 500;
  return deviationDistance > threshold;
};

// Instance method to check if auto SOS should be triggered
userSchema.methods.shouldTriggerAutoSOS = function() {
  if (!this.settings?.autoSOSEnabled) return { shouldTrigger: false, reason: 'Auto SOS disabled' };
  
  // Check for inactivity
  if (this.isInactive()) {
    return { 
      shouldTrigger: true, 
      reason: 'inactivity',
      details: `User inactive for more than ${this.settings.inactivityThresholdMinutes} minutes`
    };
  }
  
  // Check for location deviation
  if (this.hasLocationDeviated()) {
    const deviation = this.calculateDeviationFromDefault();
    return { 
      shouldTrigger: true, 
      reason: 'location_deviation',
      details: `User deviated ${Math.round(deviation)}m from safe location (threshold: ${this.settings.deviationThresholdMeters}m)`
    };
  }
  
  return { shouldTrigger: false, reason: 'All conditions normal' };
};

// Indexes
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ isEmailVerified: 1 });
userSchema.index({ registrationStep: 1 });
userSchema.index({ lastActiveAt: 1 }); // For inactivity queries
userSchema.index({ 'settings.autoSOSEnabled': 1 }); // For auto SOS queries

module.exports = mongoose.model('User', userSchema);
