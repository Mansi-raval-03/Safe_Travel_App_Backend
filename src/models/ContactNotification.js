const mongoose = require('mongoose');

const contactNotificationSchema = new mongoose.Schema({
  alertId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SOSAlert',
    required: true
  },
  contactId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EmergencyContact',
    required: true
  },
  notificationStatus: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'failed'],
    default: 'pending'
  },
  notifiedAt: {
    type: Date,
    default: null
  },
  failureReason: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Indexes
contactNotificationSchema.index({ alertId: 1 });
contactNotificationSchema.index({ contactId: 1 });

module.exports = mongoose.model('ContactNotification', contactNotificationSchema);
