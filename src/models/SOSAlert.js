const mongoose = require('mongoose');

const sosAlertSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'resolved', 'cancelled'],
    default: 'active'
  },
  emergencyType: {
    type: String,
    enum: ['medical', 'police', 'fire', 'general'],
    default: 'general'
  },
  location: {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    address: { type: String, default: 'Location not specified' }
  },
  message: {
    type: String,
    default: 'Emergency assistance required',
    maxlength: 500
  },
  emergencyServicesNotified: {
    type: Boolean,
    default: false
  },
  emergencyServicesNotifiedAt: {
    type: Date,
    default: null
  },
  immediateAlert: {
    type: Boolean,
    default: false
  },
  cancelledAt: {
    type: Date,
    default: null
  },
  cancelReason: {
    type: String,
    maxlength: 200
  }
}, {
  timestamps: true
});

// Indexes
sosAlertSchema.index({ userId: 1 });
sosAlertSchema.index({ status: 1 });
sosAlertSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SOSAlert', sosAlertSchema);
