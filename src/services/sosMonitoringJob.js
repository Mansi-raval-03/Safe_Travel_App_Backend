const cron = require('node-cron');
const autoSOSService = require('./autoSOSService');

class SOSMonitoringJob {
  constructor() {
    this.isRunning = false;
    this.jobs = new Map();
  }

  /**
   * Start all monitoring jobs
   */
  startMonitoring() {
    console.log('🔄 Starting SOS monitoring jobs...');
    
    // Main SOS check - every 10 minutes
    this.startMainSOSCheck();
    
    // Cleanup job - every hour
    this.startCleanupJob();
    
    console.log('✅ SOS monitoring jobs started successfully');
  }

  /**
   * Start main SOS checking job
   * Runs every 10 minutes to check all users for SOS conditions
   */
  startMainSOSCheck() {
    const cronExpression = '*/10 * * * *'; // Every 10 minutes
    
    const job = cron.schedule(cronExpression, async () => {
      if (this.isRunning) {
        console.log('⏳ SOS check already running, skipping this cycle');
        return;
      }

      this.isRunning = true;
      const startTime = Date.now();
      
      try {
        console.log(`🔍 [${new Date().toISOString()}] Starting scheduled SOS check...`);
        
        await autoSOSService.checkAllUsersForAutoSOS();
        
        const duration = Date.now() - startTime;
        console.log(`✅ SOS check completed in ${duration}ms`);
        
      } catch (error) {
        console.error('❌ Error in scheduled SOS check:', error);
      } finally {
        this.isRunning = false;
      }
    }, {
      scheduled: true,
      timezone: "UTC"
    });

    this.jobs.set('main-sos-check', job);
    console.log('📅 Main SOS check job scheduled (every 10 minutes)');
  }

  /**
   * Start cleanup job
   * Runs every hour to clean up old alerts and maintain system health
   */
  startCleanupJob() {
    const cronExpression = '0 * * * *'; // Every hour at minute 0
    
    const job = cron.schedule(cronExpression, async () => {
      try {
        console.log(`🧹 [${new Date().toISOString()}] Starting system cleanup...`);
        
        await this.performCleanup();
        
        console.log('✅ System cleanup completed');
        
      } catch (error) {
        console.error('❌ Error in system cleanup:', error);
      }
    }, {
      scheduled: true,
      timezone: "UTC"
    });

    this.jobs.set('cleanup', job);
    console.log('📅 Cleanup job scheduled (every hour)');
  }

  /**
   * Perform system cleanup tasks
   */
  async performCleanup() {
    try {
      // Clear old resolved SOS alerts (older than 24 hours)
      const SOSAlert = require('../models/SOSAlert');
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const deletedAlerts = await SOSAlert.deleteMany({
        status: 'resolved',
        updatedAt: { $lt: twentyFourHoursAgo }
      });
      
      if (deletedAlerts.deletedCount > 0) {
        console.log(`🗑️  Cleaned up ${deletedAlerts.deletedCount} old SOS alerts`);
      }
      
      // Log system statistics
      await this.logSystemStats();
      
    } catch (error) {
      console.error('❌ Error in cleanup tasks:', error);
    }
  }

  /**
   * Log system statistics
   */
  async logSystemStats() {
    try {
      const User = require('../models/User');
      const SOSAlert = require('../models/SOSAlert');
      
      // Count active users with auto SOS enabled
      const autoSOSUsers = await User.countDocuments({
        isActive: true,
        'settings.autoSOSEnabled': true
      });
      
      // Count active SOS alerts
      const activeAlerts = await SOSAlert.countDocuments({
        status: 'active'
      });
      
      // Count recent alerts (last 24 hours)
      const recentAlerts = await SOSAlert.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      });
      
      console.log(`📊 System Stats: ${autoSOSUsers} users with auto SOS, ${activeAlerts} active alerts, ${recentAlerts} alerts in last 24h`);
      
    } catch (error) {
      console.error('❌ Error logging system stats:', error);
    }
  }

  /**
   * Start frequent check for high-risk users
   * Optional: More frequent checking for users in dangerous situations
   */
  startHighRiskMonitoring() {
    const cronExpression = '*/2 * * * *'; // Every 2 minutes
    
    const job = cron.schedule(cronExpression, async () => {
      try {
        console.log('⚡ Checking high-risk users...');
        
        // Find users who have been flagged as high risk
        // This could be users who recently triggered an alert or are in dangerous areas
        const User = require('../models/User');
        const highRiskUsers = await User.find({
          isActive: true,
          'settings.autoSOSEnabled': true,
          // Add conditions for high-risk users
          // For example: users with recent alerts, in dangerous areas, etc.
        }).limit(10);
        
        for (const user of highRiskUsers) {
          await autoSOSService.checkUserForAutoSOS(user);
        }
        
        if (highRiskUsers.length > 0) {
          console.log(`⚡ Checked ${highRiskUsers.length} high-risk users`);
        }
        
      } catch (error) {
        console.error('❌ Error in high-risk monitoring:', error);
      }
    }, {
      scheduled: false, // Start manually when needed
      timezone: "UTC"
    });

    this.jobs.set('high-risk-monitoring', job);
    console.log('⚡ High-risk monitoring job created (start manually)');
  }

  /**
   * Stop all monitoring jobs
   */
  stopMonitoring() {
    console.log('🛑 Stopping SOS monitoring jobs...');
    
    this.jobs.forEach((job, name) => {
      job.stop();
      console.log(`🛑 Stopped ${name} job`);
    });
    
    this.jobs.clear();
    this.isRunning = false;
    
    console.log('✅ All SOS monitoring jobs stopped');
  }

  /**
   * Get monitoring status
   */
  getStatus() {
    const jobsStatus = Array.from(this.jobs.entries()).map(([name, job]) => ({
      name,
      running: job.running
    }));
    
    return {
      isRunning: this.isRunning,
      totalJobs: this.jobs.size,
      jobs: jobsStatus,
      nextRun: this.getNextRunTimes()
    };
  }

  /**
   * Get next run times for all jobs
   */
  getNextRunTimes() {
    const nextRuns = {};
    
    this.jobs.forEach((job, name) => {
      try {
        // Note: node-cron doesn't expose next run time directly
        // This is a placeholder - in production you might want to use a different cron library
        nextRuns[name] = 'Next run time not available with node-cron';
      } catch (error) {
        nextRuns[name] = 'Error calculating next run';
      }
    });
    
    return nextRuns;
  }

  /**
   * Manually trigger SOS check (for testing)
   */
  async manualSOSCheck() {
    if (this.isRunning) {
      throw new Error('SOS check already running');
    }

    console.log('🔍 Manual SOS check triggered...');
    
    this.isRunning = true;
    const startTime = Date.now();
    
    try {
      await autoSOSService.checkAllUsersForAutoSOS();
      
      const duration = Date.now() - startTime;
      console.log(`✅ Manual SOS check completed in ${duration}ms`);
      
      return { success: true, duration };
      
    } catch (error) {
      console.error('❌ Error in manual SOS check:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Enable high-risk monitoring
   */
  enableHighRiskMonitoring() {
    const job = this.jobs.get('high-risk-monitoring');
    if (job) {
      job.start();
      console.log('⚡ High-risk monitoring enabled');
      return true;
    }
    return false;
  }

  /**
   * Disable high-risk monitoring
   */
  disableHighRiskMonitoring() {
    const job = this.jobs.get('high-risk-monitoring');
    if (job) {
      job.stop();
      console.log('🛑 High-risk monitoring disabled');
      return true;
    }
    return false;
  }
}

module.exports = new SOSMonitoringJob();