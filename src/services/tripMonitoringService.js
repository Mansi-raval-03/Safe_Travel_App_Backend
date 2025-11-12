const cron = require('node-cron');
const TripEvent = require('../models/TripEvent');
const User = require('../models/User');
const SOSAlert = require('../models/SOSAlert');
const sosService = require('./sosService');
const mongoose = require('mongoose');

class TripMonitoringService {
  constructor() {
    this.isRunning = false;
    this.monitoringJob = null;
    this.cleanupJob = null;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // schedule monitoring job (every 5 minutes)
    this.monitoringJob = cron.schedule('*/5 * * * *', async () => {
      try { await this.checkActiveTrips(); } catch (e) { console.error('monitoringJob error', e); }
    });

    // schedule cleanup job (daily at 2:00)
    this.cleanupJob = cron.schedule('0 2 * * *', async () => {
      try { await this.cleanupOldTrips(); } catch (e) { console.error('cleanupJob error', e); }
    });

    // run an immediate check
    this.checkActiveTrips().catch(err => console.error('initial checkActiveTrips failed', err));
  }

  stop() {
    if (this.monitoringJob) { this.monitoringJob.destroy(); this.monitoringJob = null; }
    if (this.cleanupJob) { this.cleanupJob.destroy(); this.cleanupJob = null; }
    this.isRunning = false;
  }

  async checkActiveTrips() {
    // Minimal safe implementation: find active trips and perform basic checks
    try {
      const now = new Date();
      const activeTrips = await TripEvent.find({ status: 'active', isActive: true }).lean().exec();
      if (!activeTrips || activeTrips.length === 0) return;

      for (const trip of activeTrips) {
        // If the trip endTime has passed, trigger an alert if needed
        if (trip.endTime && new Date(trip.endTime) < now) {
          try {
            const controller = require('../controllers/tripEventsController');
            if (controller && typeof controller.triggerAlertForEvent === 'function') {
              await controller.triggerAlertForEvent(trip);
            }
          } catch (e) {
            console.error('Error triggering alert for trip', trip._id, e);
          }
        }
      }
    } catch (err) {
      console.error('checkActiveTrips error', err);
    }
  }

  async cleanupOldTrips() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      await TripEvent.updateMany({ status: { $in: ['completed', 'cancelled', 'missed'] }, updatedAt: { $lt: thirtyDaysAgo } }, { $set: { isActive: false } }).exec();
    } catch (err) {
      console.error('cleanupOldTrips error', err);
    }
  }
}

const tripMonitoringService = new TripMonitoringService();
module.exports = tripMonitoringService;