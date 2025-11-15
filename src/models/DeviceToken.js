const mongoose = require('mongoose');

const deviceTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  platform: {
    type: String,
    enum: ['android', 'ios', 'web', 'unknown'],
    default: 'unknown'
  }
}, {
  timestamps: true
});

deviceTokenSchema.index({ token: 1 }, { unique: true });

module.exports = mongoose.model('DeviceToken', deviceTokenSchema);
