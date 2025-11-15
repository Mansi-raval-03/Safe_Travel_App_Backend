const mongoose = require('mongoose');
const { Schema } = mongoose;

const TripLocationSchema = new Schema({
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  address: { type: String, trim: true, maxlength: 500 },
  name: { type: String, trim: true, maxlength: 200 }
}, { _id: false });

const TripHistorySchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  destination: { type: TripLocationSchema, required: true },
  notes: { type: String, trim: true, maxlength: 1000 },
  travelMode: { type: String, enum: ['walking','driving','public_transport','cycling','other'], default: 'other' },
  backendId: { type: String },
  syncedAt: { type: Date, default: Date.now }
}, { timestamps: true });

TripHistorySchema.index({ userId: 1, startTime: -1 });

const TripHistory = mongoose.model('TripHistory', TripHistorySchema);
module.exports = TripHistory;
