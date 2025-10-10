const express = require('express');
const auth = require('../middleware/auth');
const autoSOSService = require('../services/autoSOSService');
const sosMonitoringJob = require('../services/sosMonitoringJob');
const { body, validationResult } = require('express-validator');

const router = express.Router();

/**
 * Get user's SOS status and settings
 * GET /api/v1/auto-sos/status
 */
router.get('/status', auth, async (req, res) => {
  try {
    const sosStatus = await autoSOSService.getUserSOSStatus(req.user._id);
    
    res.json({
      success: true,
      data: sosStatus
    });
  } catch (error) {
    console.error('Error getting SOS status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get SOS status',
      error: error.message
    });
  }
});

/**
 * Update user's SOS settings
 * PUT /api/v1/auto-sos/settings
 */
router.put('/settings', auth, [
  body('autoSOSEnabled').optional().isBoolean().withMessage('autoSOSEnabled must be a boolean'),
  body('deviationThresholdMeters').optional().isInt({ min: 100, max: 5000 }).withMessage('deviationThresholdMeters must be between 100 and 5000'),
  body('inactivityThresholdMinutes').optional().isInt({ min: 5, max: 180 }).withMessage('inactivityThresholdMinutes must be between 5 and 180')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const result = await autoSOSService.updateSOSSettings(req.user._id, req.body);
    
    res.json({
      success: true,
      message: 'SOS settings updated successfully',
      data: result
    });
  } catch (error) {
    console.error('Error updating SOS settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update SOS settings',
      error: error.message
    });
  }
});

/**
 * Set user's default/safe location
 * PUT /api/v1/auto-sos/safe-location
 */
router.put('/safe-location', auth, [
  body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Latitude must be between -90 and 90'),
  body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Longitude must be between -180 and 180'),
  body('address').optional().isString().trim().withMessage('Address must be a string')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { latitude, longitude, address } = req.body;
    const result = await autoSOSService.updateUserSafeLocation(req.user._id, latitude, longitude, address);
    
    res.json({
      success: true,
      message: 'Safe location updated successfully',
      data: result
    });
  } catch (error) {
    console.error('Error updating safe location:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update safe location',
      error: error.message
    });
  }
});

/**
 * Manually trigger SOS alert (for testing)
 * POST /api/v1/auto-sos/trigger
 */
router.post('/trigger', auth, [
  body('reason').optional().isString().trim().withMessage('Reason must be a string')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const reason = req.body.reason || 'manual_test';
    const result = await autoSOSService.manualTriggerSOS(req.user._id, reason);
    
    res.json({
      success: true,
      message: 'SOS alert triggered successfully',
      data: result
    });
  } catch (error) {
    console.error('Error triggering manual SOS:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to trigger SOS alert',
      error: error.message
    });
  }
});

/**
 * Get monitoring system status (admin only)
 * GET /api/v1/auto-sos/monitoring/status
 */
router.get('/monitoring/status', auth, async (req, res) => {
  try {
    // Simple admin check - in production you might have a proper role system
    const isAdmin = req.user.email.includes('admin') || req.headers['x-admin-key'] === process.env.ADMIN_KEY;
    
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const status = sosMonitoringJob.getStatus();
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Error getting monitoring status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get monitoring status',
      error: error.message
    });
  }
});

/**
 * Manually trigger system-wide SOS check (admin only)
 * POST /api/v1/auto-sos/monitoring/check
 */
router.post('/monitoring/check', auth, async (req, res) => {
  try {
    // Simple admin check
    const isAdmin = req.user.email.includes('admin') || req.headers['x-admin-key'] === process.env.ADMIN_KEY;
    
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const result = await sosMonitoringJob.manualSOSCheck();
    
    res.json({
      success: true,
      message: 'Manual SOS check completed',
      data: result
    });
  } catch (error) {
    console.error('Error in manual SOS check:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to perform manual SOS check',
      error: error.message
    });
  }
});

/**
 * Enable/disable high-risk monitoring (admin only)
 * POST /api/v1/auto-sos/monitoring/high-risk
 */
router.post('/monitoring/high-risk', auth, [
  body('enabled').isBoolean().withMessage('enabled must be a boolean')
], async (req, res) => {
  try {
    // Simple admin check
    const isAdmin = req.user.email.includes('admin') || req.headers['x-admin-key'] === process.env.ADMIN_KEY;
    
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { enabled } = req.body;
    const result = enabled ? 
      sosMonitoringJob.enableHighRiskMonitoring() : 
      sosMonitoringJob.disableHighRiskMonitoring();
    
    res.json({
      success: true,
      message: `High-risk monitoring ${enabled ? 'enabled' : 'disabled'}`,
      data: { enabled: result }
    });
  } catch (error) {
    console.error('Error toggling high-risk monitoring:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle high-risk monitoring',
      error: error.message
    });
  }
});

/**
 * Health check for auto SOS system
 * GET /api/v1/auto-sos/health
 */
router.get('/health', async (req, res) => {
  try {
    const status = sosMonitoringJob.getStatus();
    const isHealthy = status.totalJobs > 0 && status.jobs.some(job => job.running);
    
    res.status(isHealthy ? 200 : 503).json({
      success: isHealthy,
      message: isHealthy ? 'Auto SOS system is healthy' : 'Auto SOS system has issues',
      data: {
        healthy: isHealthy,
        monitoringActive: status.totalJobs > 0,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error checking auto SOS health:', error);
    res.status(503).json({
      success: false,
      message: 'Health check failed',
      error: error.message
    });
  }
});

module.exports = router;