const cron = require('node-cron');
const TripEvent = require('../models/TripEvent');
const User = require('../models/User');
const SOSAlert = require('../models/SOSAlert');
const sosService = require('./sosService');

class TripMonitoringService {
  constructor() {
    this.isRunning = false;
    this.monitoringJob = null;
    this.cleanupJob = null;
  }

  /**
   * Start the trip monitoring service
   */
  start() {
    if (this.isRunning) {
      console.log('Trip monitoring service is already running');
      return;
    }

    console.log('Starting Trip Monitoring Service...');

    // Monitor active trips every 5 minutes
    this.monitoringJob = cron.schedule('*/5 * * * *', async () => {
      await this.checkActiveTrips();
    });

    // Cleanup completed trips daily at 2 AM
    this.cleanupJob = cron.schedule('0 2 * * *', async () => {
      await this.cleanupOldTrips();
    });

    this.isRunning = true;
    console.log('Trip monitoring service started successfully');
    
    // Run initial check
    this.checkActiveTrips();
  }

  /**
   * Stop the trip monitoring service
   */
  stop() {
    if (!this.isRunning) {
      console.log('Trip monitoring service is not running');
      return;
    }

    if (this.monitoringJob) {
      this.monitoringJob.destroy();
      this.monitoringJob = null;
    }

    if (this.cleanupJob) {
      this.cleanupJob.destroy();
      this.cleanupJob = null;
    }

    this.isRunning = false;
    console.log('Trip monitoring service stopped');
  }

  /**
   * Check all active trips for alerts
   */
  async checkActiveTrips() {
    try {
      console.log('Checking active trips for alerts...');
      
      const now = new Date();
      
      // Get all active trips
      const activeTrips = await TripEvent.findActiveTrips();
      console.log(`Found ${activeTrips.length} active trips to monitor`);

      // Check overdue trips
      await this.checkOverdueTrips(now);
      
      // Check location timeouts
      await this.checkLocationTimeouts(now);
      
      // Update trip statuses based on time
      await this.updateTripStatuses(now);
      
      console.log('Active trip monitoring check completed');
    } catch (error) {
      console.error('Error during trip monitoring:', error);
    }
  }

  /**
   * Check for overdue trips and trigger alerts
   */
  async checkOverdueTrips(now = new Date()) {
    try {
      const overdueTrips = await TripEvent.findOverdueTrips();
      
      if (overdueTrips.length === 0) {
        console.log('No overdue trips found');
        return;
      }

      console.log(`Found ${overdueTrips.length} overdue trips`);

      for (const trip of overdueTrips) {
        console.log(`Processing overdue trip: ${trip.title} (ID: ${trip._id})`);
        
        // Update trip status to alert_triggered if not already
        if (trip.status !== 'alert_triggered') {
          trip.updateStatus('alert_triggered');
          trip.addAlert('system', `Trip became overdue at ${now.toISOString()}`);
          await trip.save();
        }

        // Trigger emergency notifications
        await this.triggerEmergencyAlert(trip, 'overdue', {
          message: `${trip.userId.name} is overdue for their trip: ${trip.title}`,
          location: trip.currentLocation || trip.destination,
          overdueTime: Math.floor((now - trip.endTime) / (1000 * 60)) // minutes overdue
        });
      }
    } catch (error) {
      console.error('Error checking overdue trips:', error);
    }
  }

  /**
   * Check for location timeouts and trigger alerts
   */
  async checkLocationTimeouts(now = new Date()) {
    try {
      const tripsNeedingLocationCheck = await TripEvent.findTripsNeedingLocationCheck();
      
      if (tripsNeedingLocationCheck.length === 0) {
        console.log('No trips with location timeouts found');
        return;
      }

      console.log(`Found ${tripsNeedingLocationCheck.length} trips with potential location timeouts`);

      for (const trip of tripsNeedingLocationCheck) {
        const timeSinceUpdate = trip.lastLocationUpdate 
          ? now - trip.lastLocationUpdate 
          : now - trip.startTime;
        
        const timeoutMinutes = Math.floor(timeSinceUpdate / (1000 * 60));
        const thresholdMinutes = trip.alertThresholds.locationTimeoutMinutes;

        if (timeoutMinutes >= thresholdMinutes) {
          console.log(`Location timeout for trip: ${trip.title} (${timeoutMinutes} minutes since last update)`);
          
          // Update trip status if needed
          if (trip.status === 'active') {
            trip.updateStatus('alert_triggered');
            trip.addAlert('location_timeout', `No location update for ${timeoutMinutes} minutes`);
            await trip.save();
          }

          // Trigger emergency notifications
          await this.triggerEmergencyAlert(trip, 'location_timeout', {
            message: `Lost contact with ${trip.userId.name} during trip: ${trip.title}`,
            location: trip.currentLocation || trip.destination,
            timeoutMinutes: timeoutMinutes
          });
        }
      }
    } catch (error) {
      console.error('Error checking location timeouts:', error);
    }
  }

  /**
   * Update trip statuses based on current time
   */
  async updateTripStatuses(now = new Date()) {
    try {
      // Activate scheduled trips that should now be active
      const tripsToActivate = await TripEvent.find({
        status: 'scheduled',
        startTime: { $lte: now },
        endTime: { $gt: now },
        isActive: true
      });

      for (const trip of tripsToActivate) {
        console.log(`Activating trip: ${trip.title}`);
        trip.updateStatus('active');
        await trip.save();
      }

      // Mark trips as missed if they never started
      const tripsToMarkMissed = await TripEvent.find({
        status: 'scheduled',
        endTime: { $lt: now },
        isActive: true
      });

      for (const trip of tripsToMarkMissed) {
        console.log(`Marking trip as missed: ${trip.title}`);
        trip.updateStatus('missed');
        await trip.save();
      }

      if (tripsToActivate.length > 0 || tripsToMarkMissed.length > 0) {
        console.log(`Status updates: ${tripsToActivate.length} activated, ${tripsToMarkMissed.length} marked as missed`);
      }
    } catch (error) {
      console.error('Error updating trip statuses:', error);
    }
  }

  /**
   * Trigger emergency alert for a trip
   */
  async triggerEmergencyAlert(trip, alertType, alertData) {
    try {
      console.log(`Triggering emergency alert for trip ${trip._id}: ${alertType}`);
      
      // Create an SOS alert entry for logging/tracking
      const sosAlert = new SOSAlert({
        userId: trip.userId._id,
        type: 'automated_trip_alert',
        message: alertData.message,
        location: alertData.location || {
          latitude: 0,
          longitude: 0,
          address: 'Unknown location'
        },
        isResolved: false,
        metadata: {
          tripId: trip._id,
          tripTitle: trip.title,
          alertType: alertType,
          ...alertData
        }
      });

      await sosAlert.save();

      // Get user's emergency contacts
      const user = await User.findById(trip.userId._id).populate('emergencyContacts');
      
      if (!user || !user.emergencyContacts || user.emergencyContacts.length === 0) {
        console.warn(`No emergency contacts found for user ${trip.userId._id}`);
        return;
      }

      // Send notifications to emergency contacts
      const notificationPromises = user.emergencyContacts.map(contact => 
        this.sendEmergencyNotification(contact, trip, alertType, alertData)
      );

      await Promise.allSettled(notificationPromises);

      // Mark that emergency contacts have been notified
      if (!trip.isEmergencyContactsNotified) {
        trip.isEmergencyContactsNotified = true;
        await trip.save();
      }

      console.log(`Emergency notifications sent for trip ${trip._id}`);
    } catch (error) {
      console.error(`Error triggering emergency alert for trip ${trip._id}:`, error);
    }
  }

  /**
   * Send emergency notification to a specific contact
   */
  async sendEmergencyNotification(contact, trip, alertType, alertData) {
    try {
      // Use existing SOS service to send notifications
      const notificationMessage = this.buildNotificationMessage(trip, alertType, alertData);
      
      // Send SMS notification if phone number available
      if (contact.phone) {
        // TODO: Integrate with Twilio or SMS service
        console.log(`Would send SMS to ${contact.phone}: ${notificationMessage}`);
      }

      // Send email notification if email available
      if (contact.email) {
        // TODO: Integrate with email service
        console.log(`Would send email to ${contact.email}: ${notificationMessage}`);
      }

      // Create notification record
      // TODO: Use existing notification system if available
      console.log(`Emergency notification prepared for ${contact.name} (${contact.relationship})`);
      
    } catch (error) {
      console.error(`Error sending notification to contact ${contact.name}:`, error);
    }
  }

  /**
   * Build notification message for emergency contacts
   */
  buildNotificationMessage(trip, alertType, alertData) {
    const userName = trip.userId.name;
    const tripTitle = trip.title;
    
    let message = `SAFETY ALERT: ${userName} needs assistance.\n`;
    
    switch (alertType) {
      case 'overdue':
        message += `They are ${alertData.overdueTime} minutes overdue for their trip: "${tripTitle}".\n`;
        break;
      case 'location_timeout':
        message += `Lost contact during trip: "${tripTitle}" (${alertData.timeoutMinutes} minutes since last update).\n`;
        break;
      case 'destination_mismatch':
        message += `They appear to be far from their intended destination during trip: "${tripTitle}".\n`;
        break;
      default:
        message += `Alert triggered during trip: "${tripTitle}".\n`;
    }
    
    if (alertData.location) {
      if (alertData.location.latitude && alertData.location.longitude) {
        message += `Last known location: ${alertData.location.latitude}, ${alertData.location.longitude}\n`;
      }
      if (alertData.location.address) {
        message += `Address: ${alertData.location.address}\n`;
      }
    }
    
    message += '\nPlease check on them immediately. If you cannot reach them, consider contacting emergency services.';
    message += '\n\nThis is an automated alert from the Safe Travel App.';
    
    return message;
  }

  /**
   * Clean up old completed trips (older than 30 days)
   */
  async cleanupOldTrips() {
    try {
      console.log('Running trip cleanup job...');
      
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      // Soft delete old completed/cancelled trips
      const result = await TripEvent.updateMany(
        {
          status: { $in: ['completed', 'cancelled', 'missed'] },
          updatedAt: { $lt: thirtyDaysAgo },
          isActive: true
        },
        {
          $set: { isActive: false }
        }
      );
      
      console.log(`Cleanup completed: ${result.modifiedCount} old trips archived`);
    } catch (error) {
      console.error('Error during trip cleanup:', error);
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      uptime: process.uptime(),
      lastCheck: new Date().toISOString()
    };
  }

  /**
   * Manually trigger a check (for testing or admin purposes)
   */
  async manualCheck() {
    console.log('Manual trip monitoring check triggered');
    await this.checkActiveTrips();
    return this.getStatus();
  }
}

// Create singleton instance
const tripMonitoringService = new TripMonitoringService();

module.exports = tripMonitoringService;