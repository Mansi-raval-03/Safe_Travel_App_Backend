const mongoose = require('mongoose');

const otpVerificationSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  otp: {
    type: String,
    required: true,
    length: 6
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 } // MongoDB will automatically delete expired documents
  },
  attempts: {
    type: Number,
    default: 0,
    min: 0,
    max: 3
  },
  isUsed: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  verifiedAt: {
    type: Date,
    default: null
  },
  ipAddress: {
    type: String,
    default: null
  },
  userAgent: {
    type: String,
    default: null
  }
}, {
  timestamps: true,
  collection: 'otp_verifications'
});

// Indexes for performance
otpVerificationSchema.index({ email: 1, expiresAt: 1 });
otpVerificationSchema.index({ email: 1, isUsed: 1 });
otpVerificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3600 }); // Clean up after 1 hour

// Instance methods
otpVerificationSchema.methods.isExpired = function() {
  return this.expiresAt < new Date();
};

otpVerificationSchema.methods.isValid = function() {
  return !this.isUsed && !this.isExpired() && this.attempts < 3;
};

otpVerificationSchema.methods.canAttempt = function() {
  return this.attempts < 3 && !this.isUsed && !this.isExpired();
};

otpVerificationSchema.methods.incrementAttempt = function() {
  this.attempts += 1;
  return this.save();
};

otpVerificationSchema.methods.markAsUsed = function() {
  this.isUsed = true;
  this.verifiedAt = new Date();
  return this.save();
};

// Static methods
otpVerificationSchema.statics.findValidOTP = function(email) {
  return this.findOne({
    email,
    isUsed: false,
    expiresAt: { $gt: new Date() },
    attempts: { $lt: 3 }
  });
};

otpVerificationSchema.statics.cleanupExpired = function() {
  return this.deleteMany({
    expiresAt: { $lt: new Date() }
  });
};

otpVerificationSchema.statics.deleteForEmail = function(email) {
  return this.deleteMany({ email });
};

// Pre-save hooks
otpVerificationSchema.pre('save', function(next) {
  // Ensure OTP is exactly 6 digits
  if (this.otp && !/^\d{6}$/.test(this.otp)) {
    const error = new Error('OTP must be exactly 6 digits');
    return next(error);
  }
  
  // Ensure expiration is in the future for new records
  if (this.isNew && this.expiresAt <= new Date()) {
    const error = new Error('OTP expiration must be in the future');
    return next(error);
  }
  
  next();
});

// Pre-find hooks to exclude expired records by default
otpVerificationSchema.pre(['find', 'findOne', 'findOneAndUpdate'], function() {
  // Only apply this filter if no explicit expiry condition is set
  if (!this.getQuery().expiresAt && !this.getOptions().includeExpired) {
    this.where({ expiresAt: { $gt: new Date() } });
  }
});

module.exports = mongoose.model('OTPVerification', otpVerificationSchema);