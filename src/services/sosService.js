const axios = require('axios');

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
