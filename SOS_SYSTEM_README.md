# Automatic SOS System Documentation

## Overview

The Safe Travel App now includes a comprehensive automatic SOS (Save Our Souls) alert system that monitors users for potential emergencies and automatically sends SMS alerts to their emergency contacts. The system uses location deviation detection and inactivity monitoring to identify when users may be in distress.

## Features

### 1. Location Deviation Detection
- **Safe Location Setting**: Users can set their default/safe location through the API
- **Deviation Monitoring**: System monitors if users deviate beyond their configured threshold from their safe location
- **Configurable Thresholds**: Each user can set their own deviation threshold (default: 5000 meters)

### 2. Inactivity Detection  
- **Activity Tracking**: System tracks user's last known activity through location updates
- **Inactivity Thresholds**: Configurable timeout for inactivity detection (default: 60 minutes)
- **Automatic Triggers**: SOS alerts triggered when users are inactive beyond their threshold

### 3. SMS Alert System
- **Twilio Integration**: Uses Twilio service to send emergency SMS messages
- **Emergency Contacts**: Automatically notifies all configured emergency contacts
- **Rich Messaging**: SMS includes user's current location, emergency type, and timestamp
- **Duplicate Prevention**: System prevents sending duplicate alerts within time windows

### 4. Background Monitoring
- **Cron Jobs**: Automated background monitoring every 10 minutes
- **System Cleanup**: Hourly cleanup of old SOS alerts and notifications
- **Performance Monitoring**: Built-in health checks and system statistics

## API Endpoints

### User SOS Settings

#### Get SOS Status
```
GET /api/v1/auto-sos/status
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "autoSOSEnabled": true,
    "deviationThresholdMeters": 5000,
    "inactivityThresholdMinutes": 60,
    "defaultLocation": {
      "latitude": 40.7128,
      "longitude": -74.0060
    },
    "lastKnownLocation": {
      "latitude": 40.7130,
      "longitude": -74.0058
    },
    "lastActiveAt": "2024-01-20T10:30:00.000Z"
  }
}
```

#### Update SOS Settings
```
PUT /api/v1/auto-sos/settings
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "autoSOSEnabled": true,
  "deviationThresholdMeters": 3000,
  "inactivityThresholdMinutes": 45
}
```

#### Set Safe Location
```
PUT /api/v1/auto-sos/safe-location
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "latitude": 40.7128,
  "longitude": -74.0060
}
```

#### Manual SOS Trigger
```
POST /api/v1/auto-sos/trigger
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "emergencyType": "medical",
  "customMessage": "I need immediate help"
}
```

### Admin Monitoring Endpoints

#### Manual SOS Check
```
POST /api/v1/auto-sos/admin/manual-check
Authorization: Bearer <admin_jwt_token>
```

#### System Statistics
```
GET /api/v1/auto-sos/admin/stats
Authorization: Bearer <admin_jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalUsers": 150,
    "autoSOSEnabledUsers": 120,
    "lastMonitoringRun": "2024-01-20T10:40:00.000Z",
    "alertsTriggeredLast24h": 3,
    "systemHealth": "operational"
  }
}
```

## Configuration

### Environment Variables

Add the following to your `.env` file:

```bash
# Twilio Configuration (Required for SOS Alerts)
TWILIO_ACCOUNT_SID=your_twilio_account_sid_here
TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
TWILIO_PHONE_NUMBER=+1234567890

# Feature Flags  
AUTO_SOS_ENABLED=true
```

### Twilio Setup

1. **Create Twilio Account**: Sign up at [twilio.com](https://www.twilio.com)
2. **Get Credentials**: 
   - Account SID from Twilio Console Dashboard
   - Auth Token from Twilio Console Dashboard  
3. **Get Phone Number**: Purchase a Twilio phone number for SMS sending
4. **Update Environment**: Add credentials to your `.env` file

### Default Configuration

The system comes with sensible defaults:

- **Deviation Threshold**: 5000 meters (5km)
- **Inactivity Threshold**: 60 minutes
- **Monitoring Frequency**: Every 10 minutes
- **Cleanup Frequency**: Every hour
- **Auto SOS**: Disabled by default (users must opt-in)

## Database Schema

### User Model Extensions

The User model has been extended with SOS-specific fields:

```javascript
{
  // ... existing user fields
  
  // SOS Configuration
  autoSOSEnabled: { type: Boolean, default: false },
  deviationThresholdMeters: { type: Number, default: 5000 },
  inactivityThresholdMinutes: { type: Number, default: 60 },
  
  // Location Tracking
  defaultLocation: {
    latitude: Number,
    longitude: Number
  },
  lastKnownLocation: {
    latitude: Number, 
    longitude: Number,
    timestamp: { type: Date, default: Date.now }
  },
  lastActiveAt: { type: Date, default: Date.now }
}
```

### SOS Alert Model

Stores all triggered SOS alerts:

```javascript
{
  userId: ObjectId,
  alertType: String, // 'deviation', 'inactivity', 'manual'
  triggerReason: String,
  location: {
    latitude: Number,
    longitude: Number
  },
  isResolved: Boolean,
  resolvedAt: Date,
  emergencyType: String, // 'medical', 'police', 'fire', 'general'
  customMessage: String,
  createdAt: Date
}
```

## System Architecture

### Services

1. **autoSOSService.js**: Core SOS detection and alerting logic
2. **sosMonitoringJob.js**: Cron-based background monitoring
3. **socketHandler.js**: Real-time location updates (existing)
4. **sosService.js**: General SOS utilities (existing)

### Background Jobs

1. **Main SOS Check**: Runs every 10 minutes
   - Checks all users with auto-SOS enabled
   - Detects location deviation and inactivity
   - Triggers alerts for qualifying conditions

2. **Cleanup Job**: Runs every hour
   - Removes old SOS alerts (>30 days)
   - Cleans up resolved notifications
   - Maintains database performance

3. **High-Risk Monitoring** (Optional): Every 2 minutes
   - For users with recent SOS alerts
   - Enhanced monitoring for at-risk individuals

### Alert Flow

1. **Detection**: Background job identifies potential emergency
2. **Validation**: Prevents duplicate alerts within time windows
3. **Alert Creation**: Creates SOSAlert record in database
4. **Contact Notification**: Sends SMS to all emergency contacts
5. **Logging**: Records alert details for tracking and analytics

## Testing

### Manual Testing Endpoints

The system includes several endpoints for testing:

#### Trigger Test Alert
```bash
curl -X POST http://localhost:3000/api/v1/auto-sos/trigger \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "emergencyType": "test",
    "customMessage": "This is a test alert"
  }'
```

#### Check System Status  
```bash
curl -X GET http://localhost:3000/api/v1/auto-sos/status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Manual Monitoring Check (Admin)
```bash
curl -X POST http://localhost:3000/api/v1/auto-sos/admin/manual-check \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN"
```

### Development Testing

1. **Set Short Thresholds**: For testing, set low thresholds:
   ```json
   {
     "deviationThresholdMeters": 100,
     "inactivityThresholdMinutes": 2
   }
   ```

2. **Use Test Phone Numbers**: Twilio provides test credentials that don't send real SMS
3. **Monitor Logs**: Check server logs for SOS system activity
4. **Database Inspection**: Verify SOSAlert and User records are created correctly

## Monitoring & Troubleshooting

### Health Checks

The system provides comprehensive health monitoring:

- **Cron Job Status**: Logs show when monitoring jobs run
- **Twilio Connection**: Error handling for SMS sending failures  
- **Database Health**: Automatic cleanup prevents database bloat
- **Alert Statistics**: Track system performance and usage

### Common Issues

#### SMS Not Sending
1. **Check Twilio Credentials**: Verify Account SID, Auth Token, and Phone Number
2. **Check Phone Number Format**: Must include country code (+1234567890)
3. **Verify Twilio Balance**: Ensure account has sufficient credits
4. **Check Logs**: Look for Twilio error messages in server logs

#### False Alerts
1. **Adjust Thresholds**: Increase deviation/inactivity thresholds
2. **Check Location Updates**: Ensure location tracking is working properly
3. **Verify Safe Location**: Make sure user's safe location is set correctly

#### Missing Alerts  
1. **Enable Auto-SOS**: Users must explicitly enable the feature
2. **Check Emergency Contacts**: Ensure users have emergency contacts configured
3. **Verify Background Jobs**: Check if cron jobs are running properly

### Logging

The system provides detailed logging:

```javascript
// Example log output
[2024-01-20 10:45:00] SOS Monitor: Starting monitoring cycle...
[2024-01-20 10:45:01] SOS Monitor: Checking 45 users with auto-SOS enabled
[2024-01-20 10:45:02] SOS Alert: User 507f1f77bcf86cd799439011 deviation detected (6.2km from safe location)
[2024-01-20 10:45:03] SMS Sent: Emergency alert sent to 3 contacts for user 507f1f77bcf86cd799439011
[2024-01-20 10:45:05] SOS Monitor: Monitoring cycle complete - 1 alert triggered
```

## Security Considerations

1. **Authentication**: All endpoints require valid JWT tokens
2. **Authorization**: Admin endpoints require admin-level access
3. **Rate Limiting**: SOS endpoints have appropriate rate limits
4. **Data Privacy**: Location data is handled according to privacy policies
5. **Twilio Security**: Credentials stored securely in environment variables

## Future Enhancements

- **Email Notifications**: Backup notification method
- **Voice Calls**: Emergency voice calling capability
- **Geofencing**: Advanced location-based alert zones
- **Machine Learning**: Smarter emergency detection algorithms
- **Mobile Push**: Real-time push notifications
- **Emergency Services**: Direct integration with 911/emergency services

## Support

For technical support or questions:
1. Check server logs for error details
2. Verify Twilio configuration and credits
3. Test with manual SOS trigger endpoints
4. Contact system administrators with specific error messages