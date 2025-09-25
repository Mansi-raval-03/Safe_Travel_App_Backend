const mongoose = require('mongoose');

const emergencyContactSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 50
  },
  phone: {
    type: String,
    required: true,
    match: [/^[\+]?[1-9][\d]{0,15}$/, 'Please enter a valid phone number']
  },
  relationship: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  isPrimary: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Compound index for userId and phone
emergencyContactSchema.index({ userId: 1, phone: 1 }, { unique: true });
emergencyContactSchema.index({ userId: 1 });

module.exports = mongoose.model('EmergencyContact', emergencyContactSchema);
