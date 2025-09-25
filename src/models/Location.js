const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  latitude: {
    type: Number,
    required: true,
    min: -90,
    max: 90
  },
  longitude: {
    type: Number,
    required: true,
    min: -180,
    max: 180
  },
  accuracy: {
    type: Number,
    default: 0
  },
  address: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Index for geospatial queries
locationSchema.index({ location: '2dsphere' });
locationSchema.index({ userId: 1 });

module.exports = mongoose.model('Location', locationSchema);
