const axios = require('axios');
const DeviceToken = require('../models/DeviceToken');

// Try to initialize Firebase Admin for push notifications if credentials available
let fcm = null;
try {
  const admin = require('firebase-admin');
  if (!admin.apps || admin.apps.length === 0) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      // Expecting JSON string of service account in env for CI/deployments
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      console.log('Firebase Admin initialized from FIREBASE_SERVICE_ACCOUNT');
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      // If GOOGLE_APPLICATION_CREDENTIALS points to a file path, admin can auto-init
      admin.initializeApp();
      console.log('Firebase Admin initialized via GOOGLE_APPLICATION_CREDENTIALS');
    }
  }
  if (admin.apps && admin.apps.length > 0) {
    fcm = admin.messaging();
  }
} catch (err) {
  console.warn('Firebase Admin SDK not configured or failed to load. Push notifications disabled.');
}

class SOSService {
  // Notify emergency services
  async notifyEmergencyServices(alert, user) {
    try {
      console.log('Notifying emergency services for alert:', alert._id);
      
      // In a real implementation, this would call actual emergency service APIs
      // For now, we'll just log the notification
      const emergencyData = {
        alertId: alert._id,
        userId: user._id,
        userName: user.name,
        userPhone: user.phone,
        location: alert.location,
        emergencyType: alert.emergencyType,
        message: alert.message,
        timestamp: new Date().toISOString()
      };

      console.log('Emergency services notified with data:', emergencyData);
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return { success: true, notifiedAt: new Date() };
    } catch (error) {
      console.error('Failed to notify emergency services:', error);
      throw error;
    }
  }

  // Send push notifications to all other app users (who have device tokens)
  async notifyPushToAllUsers(alert, user) {
    try {
      if (!fcm) {
        console.log('FCM not configured, skipping push notifications');
        return { success: false, reason: 'fcm_not_configured' };
      }

      // Fetch all tokens except those belonging to the alert sender
      const tokensDocs = await DeviceToken.find({ user: { $ne: user._id } }).select('token -_id');
      const tokens = tokensDocs.map(d => d.token).filter(Boolean);
      if (!tokens || tokens.length === 0) {
        console.log('No device tokens found for push delivery');
        return { success: true, sent: 0 };
      }

      // Build message payload
      const payload = {
        notification: {
          title: `${user.name} needs help`,
          body: alert.message || `${user.name} has triggered an SOS alert nearby.`
        },
        data: {
          type: 'sos',
          alertId: String(alert._id),
          userId: String(user._id),
          latitude: String(alert.location?.latitude || ''),
          longitude: String(alert.location?.longitude || '')
        }
      };

      // FCM supports up to 500 tokens in sendMulticast; chunk if necessary
      const chunkSize = 400; // keep under limits
      let successCount = 0;
      for (let i = 0; i < tokens.length; i += chunkSize) {
        const chunk = tokens.slice(i, i + chunkSize);
        // Ensure Android notification uses the emergency_alerts channel so system notifications
        // are delivered with the expected importance and the local plugin can map to it.
        const message = {
          tokens: chunk,
          notification: payload.notification,
          data: payload.data,
          android: {
            priority: 'high',
            notification: {
              channelId: 'emergency_alerts',
              defaultSound: true,
            }
          },
          apns: {
            headers: { 'apns-priority': '10' },
            payload: {
              aps: {
                alert: {
                  title: payload.notification.title,
                  body: payload.notification.body
                },
                sound: 'default'
              }
            }
          }
        };
        const response = await fcm.sendMulticast(message);
        successCount += response.successCount || 0;
        console.log(`FCM chunk sent: success=${response.successCount} failure=${response.failureCount}`);

        // Collect invalid tokens and remove them from DB to avoid repeated failures
        const failedTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errCode = resp.error && resp.error.code ? resp.error.code : null;
            const tokenFailed = chunk[idx];
            if (errCode === 'messaging/invalid-registration-token' || errCode === 'messaging/registration-token-not-registered') {
              failedTokens.push(tokenFailed);
            }
          }
        });

        if (failedTokens.length > 0) {
          try {
            const del = await DeviceToken.deleteMany({ token: { $in: failedTokens } });
            console.log(`Removed ${del.deletedCount || 0} invalid device tokens from DB`);
          } catch (delErr) {
            console.error('Failed to remove invalid tokens:', delErr);
          }
        }
      }

      return { success: true, sent: successCount };
    } catch (error) {
      console.error('Push notification sending error:', error);
      return { success: false, error: error.message };
    }
  }

  // Notify emergency contacts
  async notifyEmergencyContacts(alert, contacts, user) {
    try {
      console.log('Notifying emergency contacts for alert:', alert._id);
      
      const notifications = [];
      
      for (const contact of contacts) {
        try {
          // In a real implementation, this would send SMS/calls to contacts
          const message = `EMERGENCY ALERT: ${user.name} has triggered an SOS alert. Location: ${alert.location.address || 'Location unavailable'}. Please contact them immediately or call emergency services.`;
          
          console.log(`Sending emergency notification to ${contact.name} (${contact.phone}): ${message}`);
          
          // Simulate notification delay
          await new Promise(resolve => setTimeout(resolve, 500));
          
          notifications.push({
            contactId: contact._id,
            status: 'sent',
            sentAt: new Date()
          });
          
        } catch (contactError) {
          console.error(`Failed to notify contact ${contact.name}:`, contactError);
          notifications.push({
            contactId: contact._id,
            status: 'failed',
            error: contactError.message
          });
        }
      }
      
      return notifications;
    } catch (error) {
      console.error('Failed to notify emergency contacts:', error);
      throw error;
    }
  }

  // Send SMS (placeholder implementation)
  async sendSMS(phoneNumber, message) {
    try {
      // In production, integrate with SMS service like Twilio
      console.log(`SMS to ${phoneNumber}: ${message}`);
      return { success: true, messageId: 'mock_message_id' };
    } catch (error) {
      console.error('SMS sending failed:', error);
      throw error;
    }
  }

  // Make phone call (placeholder implementation)
  async makeCall(phoneNumber, message) {
    try {
      // In production, integrate with calling service like Twilio Voice
      console.log(`Call to ${phoneNumber}: ${message}`);
      return { success: true, callId: 'mock_call_id' };
    } catch (error) {
      console.error('Call failed:', error);
      throw error;
    }
  }
}

module.exports = new SOSService();
