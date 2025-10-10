const User = require('../models/User');
const SOSAlert = require('../models/SOSAlert');
const EmergencyContact = require('../models/EmergencyContact');
const sosService = require('./sosService');
const twilio = require('twilio');

class AutoSOSService {
  constructor() {
    // Initialize Twilio client
    this.twilioClient = null;
    this.initializeTwilio();
    
    // Track processed alerts to prevent duplicates
    this.processedAlerts = new Set();
  }

  /**
   * Initialize Twilio client for SMS functionality
   */
  initializeTwilio() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    
    if (accountSid && authToken) {
      this.twilioClient = twilio(accountSid, authToken);
      console.log('✅ Twilio client initialized successfully');
    } else {
      console.warn('⚠️  Twilio credentials not found. SMS functionality will be disabled.');
      console.warn('   Please set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables');
    }
  }

  /**
   * Check all users for auto SOS conditions
   * Called periodically by cron job
   */
  async checkAllUsersForAutoSOS() {
    try {
      console.log('🔍 Starting auto SOS check for all users...');
      
      // Find active users with auto SOS enabled
      const users = await User.find({
        isActive: true,
        'settings.autoSOSEnabled': true
      }).select('+lastActiveAt +lastKnownLocation +defaultLocation');

      console.log(`📊 Found ${users.length} users with auto SOS enabled`);
      
      let alertsTriggered = 0;
      
      for (const user of users) {
        try {
          await this.checkUserForAutoSOS(user);
        } catch (error) {
          console.error(`❌ Error checking user ${user.email}:`, error);
        }
      }
      
      console.log(`✅ Auto SOS check completed. Alerts triggered: ${alertsTriggered}`);
      
    } catch (error) {
      console.error('❌ Error in auto SOS check:', error);
    }
  }

  /**
   * Check individual user for auto SOS conditions
   */
  async checkUserForAutoSOS(user) {
    try {
      const sosCheck = user.shouldTriggerAutoSOS();
      
      if (!sosCheck.shouldTrigger) {
        // User is normal, remove from processed alerts if present
        this.processedAlerts.delete(user._id.toString());
        return false;
      }

      // Check if we already processed an alert for this user recently
      const alertKey = `${user._id}_${sosCheck.reason}`;
      if (this.processedAlerts.has(alertKey)) {
        console.log(`⚠️  Auto SOS already processed for user ${user.email} (${sosCheck.reason})`);
        return false;
      }

      console.log(`🚨 Triggering auto SOS for user ${user.email}: ${sosCheck.details}`);
      
      // Trigger SOS alert
      const alertData = await this.triggerAutoSOS(user, sosCheck);
      
      // Mark as processed to prevent duplicates
      this.processedAlerts.add(alertKey);
      
      // Set timeout to remove from processed alerts after 1 hour
      setTimeout(() => {
        this.processedAlerts.delete(alertKey);
      }, 60 * 60 * 1000); // 1 hour

      return alertData;
      
    } catch (error) {
      console.error(`❌ Error checking user ${user.email} for auto SOS:`, error);
      return false;
    }
  }

  /**
   * Trigger automatic SOS alert
   */
  async triggerAutoSOS(user, sosCheck) {
    try {
      // Create SOS alert record
      const alertData = {
        userId: user._id,
        status: 'active',
        emergencyType: 'general',
        location: {
          latitude: user.lastKnownLocation?.latitude || 0,
          longitude: user.lastKnownLocation?.longitude || 0,
          address: user.lastKnownLocation?.address || 'Location unavailable'
        },
        message: `AUTOMATIC SOS ALERT: ${sosCheck.details}. Last known location provided.`,
        immediateAlert: true
      };

      const sosAlert = await SOSAlert.create(alertData);
      console.log(`📝 Created auto SOS alert with ID: ${sosAlert._id}`);

      // Get user's emergency contacts
      const emergencyContacts = await EmergencyContact.find({ 
        userId: user._id 
      }).sort({ isPrimary: -1 });

      if (emergencyContacts.length === 0) {
        console.warn(`⚠️  No emergency contacts found for user ${user.email}`);
        return { sosAlert, contactsNotified: 0 };
      }

      // Send notifications to emergency contacts
      const notificationResults = await this.notifyEmergencyContacts(
        sosAlert, 
        emergencyContacts, 
        user
      );

      console.log(`📱 Notified ${notificationResults.length} emergency contacts`);

      return {
        sosAlert,
        contactsNotified: notificationResults.length,
        notificationResults
      };

    } catch (error) {
      console.error('❌ Error triggering auto SOS:', error);
      throw error;
    }
  }

  /**
   * Send notifications to emergency contacts
   */
  async notifyEmergencyContacts(sosAlert, contacts, user) {
    const results = [];
    
    for (const contact of contacts) {
      try {
        // Create notification message
        const message = this.createEmergencyMessage(sosAlert, user, contact);
        
        // Send SMS if Twilio is available
        if (this.twilioClient) {
          const smsResult = await this.sendEmergencySMS(contact.phone, message);
          results.push({
            contactId: contact._id,
            method: 'sms',
            status: smsResult.success ? 'sent' : 'failed',
            details: smsResult
          });
        }
        
        // Also use existing SOS service notification
        const sosNotification = await sosService.notifyEmergencyContacts(
          sosAlert, 
          [contact], 
          user
        );
        
        results.push({
          contactId: contact._id,
          method: 'sos_service',
          status: 'sent',
          details: sosNotification
        });

      } catch (error) {
        console.error(`❌ Failed to notify contact ${contact.name}:`, error);
        results.push({
          contactId: contact._id,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    return results;
  }

  /**
   * Create emergency message text
   */
  createEmergencyMessage(sosAlert, user, contact) {
    const locationText = sosAlert.location.latitude && sosAlert.location.longitude
      ? `https://www.google.com/maps?q=${sosAlert.location.latitude},${sosAlert.location.longitude}`
      : 'Location unavailable';
    
    const timestamp = new Date().toLocaleString();
    
    return `🚨 EMERGENCY ALERT 🚨

${user.name} might be in danger!

Reason: ${sosAlert.message}

Last known location: ${locationText}

Time: ${timestamp}

Please contact them immediately or call emergency services.

- Safe Travel App`;
  }

  /**
   * Send SMS using Twilio
   */
  async sendEmergencySMS(phoneNumber, message) {
    try {
      if (!this.twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      const twilioMessage = await this.twilioClient.messages.create({
        body: message,
        to: phoneNumber,
        from: process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM_NUMBER
      });

      console.log(`📱 SMS sent successfully to ${phoneNumber}, SID: ${twilioMessage.sid}`);
      
      return {
        success: true,
        messageSid: twilioMessage.sid,
        status: twilioMessage.status
      };

    } catch (error) {
      console.error(`❌ Failed to send SMS to ${phoneNumber}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Manually trigger SOS for testing
   */
  async manualTriggerSOS(userId, reason = 'manual_test') {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const sosCheck = {
        shouldTrigger: true,
        reason: reason,
        details: 'Manual SOS trigger for testing'
      };

      return await this.triggerAutoSOS(user, sosCheck);

    } catch (error) {
      console.error('❌ Error in manual SOS trigger:', error);
      throw error;
    }
  }

  /**
   * Update user's safe location
   */
  async updateUserSafeLocation(userId, latitude, longitude, address) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      await user.setDefaultLocation(latitude, longitude, address);
      
      console.log(`📍 Updated safe location for user ${user.email}`);
      
      return {
        success: true,
        location: user.defaultLocation
      };

    } catch (error) {
      console.error('❌ Error updating safe location:', error);
      throw error;
    }
  }

  /**
   * Update user's SOS settings
   */
  async updateSOSSettings(userId, settings) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      if (settings.autoSOSEnabled !== undefined) {
        user.settings.autoSOSEnabled = settings.autoSOSEnabled;
      }
      
      if (settings.deviationThresholdMeters !== undefined) {
        user.settings.deviationThresholdMeters = Math.max(100, Math.min(5000, settings.deviationThresholdMeters));
      }
      
      if (settings.inactivityThresholdMinutes !== undefined) {
        user.settings.inactivityThresholdMinutes = Math.max(5, Math.min(180, settings.inactivityThresholdMinutes));
      }

      await user.save();
      
      console.log(`⚙️  Updated SOS settings for user ${user.email}`);
      
      return {
        success: true,
        settings: user.settings
      };

    } catch (error) {
      console.error('❌ Error updating SOS settings:', error);
      throw error;
    }
  }

  /**
   * Get user's SOS status and settings
   */
  async getUserSOSStatus(userId) {
    try {
      const user = await User.findById(userId).select('+lastActiveAt +lastKnownLocation +defaultLocation');
      if (!user) {
        throw new Error('User not found');
      }

      const sosCheck = user.shouldTriggerAutoSOS();
      const deviation = user.calculateDeviationFromDefault();

      return {
        userId: user._id,
        settings: {
          autoSOSEnabled: user.settings?.autoSOSEnabled || false,
          deviationThresholdMeters: user.settings?.deviationThresholdMeters || 500,
          inactivityThresholdMinutes: user.settings?.inactivityThresholdMinutes || 30
        },
        status: {
          isActive: !user.isInactive(),
          lastActiveAt: user.lastActiveAt,
          hasDefaultLocation: !!(user.defaultLocation?.latitude && user.defaultLocation?.longitude),
          hasLastKnownLocation: !!(user.lastKnownLocation?.latitude && user.lastKnownLocation?.longitude),
          deviationFromSafe: deviation,
          shouldTriggerSOS: sosCheck.shouldTrigger,
          sosReason: sosCheck.reason,
          sosDetails: sosCheck.details
        },
        locations: {
          defaultLocation: user.defaultLocation,
          lastKnownLocation: user.lastKnownLocation
        }
      };

    } catch (error) {
      console.error('❌ Error getting SOS status:', error);
      throw error;
    }
  }
}

module.exports = new AutoSOSService();