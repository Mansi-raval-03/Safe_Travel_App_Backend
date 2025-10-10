const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/User');
const OTPVerification = require('../models/OTPVerification');

// Rate limiting for OTP operations
const sendOTPLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // Limit each IP to 3 OTP send requests per windowMs
  message: {
    success: false,
    message: 'Too many OTP requests. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const verifyOTPLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 verification attempts per windowMs
  message: {
    success: false,
    message: 'Too many verification attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Nodemailer transporter configuration
const createEmailTransporter = () => {
  return nodemailer.createTransporter({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    tls: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.2"
    }
  });
};

// Generate 6-digit OTP
const generateOTP = () => {
  return crypto.randomInt(100000, 999999).toString();
};

// Email template for OTP
const createOTPEmailTemplate = (otp, userEmail) => {
  return {
    subject: 'Safe Travel - Email Verification Code',
    html: `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Email Verification - Safe Travel App</title>
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                line-height: 1.6;
                margin: 0;
                padding: 0;
                background-color: #f8fafc;
            }
            .container {
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                background-color: #ffffff;
                border-radius: 12px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                margin-top: 20px;
                margin-bottom: 20px;
            }
            .header {
                text-align: center;
                padding: 20px 0;
                border-bottom: 2px solid #6366f1;
                margin-bottom: 30px;
            }
            .logo {
                font-size: 28px;
                font-weight: bold;
                color: #6366f1;
                margin-bottom: 10px;
            }
            .tagline {
                color: #64748b;
                font-size: 14px;
            }
            .content {
                padding: 0 20px;
            }
            .greeting {
                font-size: 18px;
                color: #374151;
                margin-bottom: 20px;
            }
            .otp-container {
                text-align: center;
                background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
                padding: 30px;
                border-radius: 12px;
                margin: 30px 0;
                box-shadow: 0 8px 25px rgba(99, 102, 241, 0.3);
            }
            .otp-label {
                color: white;
                font-size: 14px;
                font-weight: 500;
                margin-bottom: 10px;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            .otp-code {
                font-size: 36px;
                font-weight: bold;
                color: white;
                letter-spacing: 8px;
                font-family: 'Courier New', monospace;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            }
            .instructions {
                background-color: #f1f5f9;
                padding: 20px;
                border-radius: 8px;
                margin: 20px 0;
                border-left: 4px solid #10b981;
            }
            .instructions h4 {
                color: #059669;
                margin-top: 0;
                font-size: 16px;
            }
            .instructions ul {
                margin: 10px 0;
                padding-left: 20px;
            }
            .instructions li {
                color: #374151;
                margin: 8px 0;
            }
            .security-note {
                background-color: #fef2f2;
                padding: 15px;
                border-radius: 8px;
                margin: 20px 0;
                border-left: 4px solid #ef4444;
            }
            .security-note p {
                color: #dc2626;
                margin: 0;
                font-size: 14px;
                font-weight: 500;
            }
            .footer {
                text-align: center;
                padding: 20px 0;
                border-top: 1px solid #e5e7eb;
                margin-top: 30px;
                color: #6b7280;
                font-size: 12px;
            }
            .expiry {
                background-color: #fff7ed;
                color: #ea580c;
                padding: 10px;
                border-radius: 6px;
                text-align: center;
                font-weight: 500;
                margin: 20px 0;
                border: 1px solid #fed7aa;
            }
            .button {
                display: inline-block;
                background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                color: white;
                padding: 12px 24px;
                text-decoration: none;
                border-radius: 8px;
                font-weight: 600;
                margin: 10px 0;
                transition: transform 0.2s ease;
            }
            .button:hover {
                transform: translateY(-2px);
            }
            @media (max-width: 600px) {
                .container {
                    margin: 10px;
                    padding: 15px;
                }
                .otp-code {
                    font-size: 28px;
                    letter-spacing: 4px;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">🛡️ Safe Travel</div>
                <div class="tagline">Your Safety, Our Priority</div>
            </div>
            
            <div class="content">
                <div class="greeting">
                    Welcome to Safe Travel! 👋
                </div>
                
                <p>Thank you for joining our emergency safety platform. To complete your registration and secure your account, please verify your email address using the code below:</p>
                
                <div class="otp-container">
                    <div class="otp-label">Your Verification Code</div>
                    <div class="otp-code">${otp}</div>
                </div>
                
                <div class="expiry">
                    ⏰ This code expires in 5 minutes
                </div>
                
                <div class="instructions">
                    <h4>📋 How to verify:</h4>
                    <ul>
                        <li>Open the Safe Travel app on your device</li>
                        <li>Navigate to the email verification screen</li>
                        <li>Enter the 6-digit code exactly as shown above</li>
                        <li>Tap "Verify" to complete your registration</li>
                    </ul>
                </div>
                
                <div class="security-note">
                    <p>🔒 Security Notice: Never share this code with anyone. Our team will never ask for your verification code via phone, email, or any other method.</p>
                </div>
                
                <p>If you didn't request this verification code, please ignore this email or contact our support team.</p>
                
                <div style="text-align: center; margin: 30px 0;">
                    <p>Need help? Contact our support team:</p>
                    <a href="mailto:support@safetravel.app" class="button">📧 Contact Support</a>
                </div>
            </div>
            
            <div class="footer">
                <p>Safe Travel App - Emergency Safety Platform</p>
                <p>This is an automated email. Please do not reply directly.</p>
                <p>&copy; ${new Date().getFullYear()} Safe Travel. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    `,
    text: `
Safe Travel - Email Verification

Welcome to Safe Travel!

Your verification code is: ${otp}

This code expires in 5 minutes.

How to verify:
1. Open the Safe Travel app
2. Navigate to email verification
3. Enter code: ${otp}
4. Tap "Verify"

Security Notice: Never share this code with anyone.

If you didn't request this, please ignore this email.

Support: support@safetravel.app
Safe Travel App - ${new Date().getFullYear()}
    `
  };
};

// POST /api/v1/otp/send - Send OTP to user's email
router.post('/send', sendOTPLimiter, [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
], async (req, res) => {
  try {
    // Validation check
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, name } = req.body;

    // Check if email is already verified
    const existingUser = await User.findOne({ email, isEmailVerified: true });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Email already verified and registered'
      });
    }

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

    // Store or update OTP in database
    await OTPVerification.findOneAndUpdate(
      { email },
      {
        email,
        otp,
        expiresAt,
        attempts: 0,
        isUsed: false,
        createdAt: new Date()
      },
      { upsert: true, new: true }
    );

    // Send email
    const transporter = createEmailTransporter();
    const emailTemplate = createOTPEmailTemplate(otp, email);

    await transporter.sendMail({
      from: `"Safe Travel App" <${process.env.SMTP_USER}>`,
      to: email,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
      text: emailTemplate.text,
    });

    console.log(`📧 OTP sent to ${email}: ${otp}`); // Log for development (remove in production)

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully to your email',
      data: {
        email,
        expiresIn: 300, // 5 minutes in seconds
        canResendIn: 60 // 1 minute in seconds
      }
    });

  } catch (error) {
    console.error('❌ Send OTP Error:', error);
    
    // Handle specific nodemailer errors
    if (error.code === 'EAUTH') {
      return res.status(500).json({
        success: false,
        message: 'Email service authentication failed. Please try again later.'
      });
    }
    
    if (error.code === 'ECONNECTION') {
      return res.status(500).json({
        success: false,
        message: 'Email service connection failed. Please try again later.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to send OTP. Please try again later.'
    });
  }
});

// POST /api/v1/otp/verify - Verify OTP and mark email as verified
router.post('/verify', verifyOTPLimiter, [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('otp')
    .isLength({ min: 6, max: 6 })
    .isNumeric()
    .withMessage('OTP must be a 6-digit number'),
], async (req, res) => {
  try {
    // Validation check
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, otp } = req.body;

    // Find OTP record
    const otpRecord = await OTPVerification.findOne({ email });
    
    if (!otpRecord) {
      return res.status(404).json({
        success: false,
        message: 'No OTP found for this email. Please request a new one.'
      });
    }

    // Check if OTP is already used
    if (otpRecord.isUsed) {
      return res.status(400).json({
        success: false,
        message: 'This OTP has already been used. Please request a new one.'
      });
    }

    // Check if OTP has expired
    if (otpRecord.expiresAt < new Date()) {
      await OTPVerification.deleteOne({ email });
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new one.'
      });
    }

    // Check attempt limit
    if (otpRecord.attempts >= 3) {
      await OTPVerification.deleteOne({ email });
      return res.status(429).json({
        success: false,
        message: 'Too many incorrect attempts. Please request a new OTP.'
      });
    }

    // Verify OTP
    if (otpRecord.otp !== otp) {
      // Increment attempts
      otpRecord.attempts += 1;
      await otpRecord.save();
      
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${3 - otpRecord.attempts} attempts remaining.`
      });
    }

    // OTP is valid - mark as used
    otpRecord.isUsed = true;
    otpRecord.verifiedAt = new Date();
    await otpRecord.save();

    // Update or create user with verified email
    let user = await User.findOne({ email });
    if (user) {
      user.isEmailVerified = true;
      user.emailVerifiedAt = new Date();
      await user.save();
    } else {
      // Create a temporary verified email record
      user = new User({
        email,
        isEmailVerified: true,
        emailVerifiedAt: new Date(),
        // Other fields will be filled during full registration
        name: 'Verified User',
        phone: '',
        password: '', // Will be set during registration
        isActive: false // Will be activated after full registration
      });
      await user.save();
    }

    console.log(`✅ Email verified for ${email}`);

    res.status(200).json({
      success: true,
      message: 'Email verified successfully',
      data: {
        email,
        isVerified: true,
        verifiedAt: otpRecord.verifiedAt,
        nextStep: 'complete_registration'
      }
    });

    // Clean up expired OTP records (background task)
    setTimeout(async () => {
      try {
        await OTPVerification.deleteMany({
          expiresAt: { $lt: new Date() }
        });
        console.log('🧹 Cleaned up expired OTP records');
      } catch (error) {
        console.error('❌ Error cleaning up OTP records:', error);
      }
    }, 1000);

  } catch (error) {
    console.error('❌ Verify OTP Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP. Please try again.'
    });
  }
});

// POST /api/v1/otp/resend - Resend OTP (with rate limiting)
router.post('/resend', sendOTPLimiter, [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
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

    const { email } = req.body;

    // Check if there's an existing OTP that's still valid (prevent spam)
    const existingOTP = await OTPVerification.findOne({ email });
    if (existingOTP && existingOTP.expiresAt > new Date()) {
      const timeRemaining = Math.ceil((existingOTP.expiresAt - new Date()) / 1000);
      if (timeRemaining > 240) { // Only allow resend if less than 4 minutes remaining
        return res.status(429).json({
          success: false,
          message: `Please wait ${Math.ceil(timeRemaining / 60)} minutes before requesting a new OTP.`
        });
      }
    }

    // Generate new OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Update OTP record
    await OTPVerification.findOneAndUpdate(
      { email },
      {
        email,
        otp,
        expiresAt,
        attempts: 0,
        isUsed: false,
        createdAt: new Date()
      },
      { upsert: true, new: true }
    );

    // Send email
    const transporter = createEmailTransporter();
    const emailTemplate = createOTPEmailTemplate(otp, email);

    await transporter.sendMail({
      from: `"Safe Travel App" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `${emailTemplate.subject} - Resent`,
      html: emailTemplate.html,
      text: emailTemplate.text,
    });

    console.log(`📧 OTP resent to ${email}: ${otp}`);

    res.status(200).json({
      success: true,
      message: 'New OTP sent successfully',
      data: {
        email,
        expiresIn: 300,
        canResendIn: 60
      }
    });

  } catch (error) {
    console.error('❌ Resend OTP Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend OTP. Please try again.'
    });
  }
});

// GET /api/v1/otp/status/:email - Check verification status
router.get('/status/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    // Validate email format
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    const user = await User.findOne({ email });
    const otpRecord = await OTPVerification.findOne({ email });

    res.status(200).json({
      success: true,
      data: {
        email,
        isVerified: user ? user.isEmailVerified : false,
        hasPendingOTP: otpRecord && !otpRecord.isUsed && otpRecord.expiresAt > new Date(),
        otpExpiresAt: otpRecord && !otpRecord.isUsed ? otpRecord.expiresAt : null,
        attemptsRemaining: otpRecord ? Math.max(0, 3 - otpRecord.attempts) : 3
      }
    });

  } catch (error) {
    console.error('❌ OTP Status Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get verification status'
    });
  }
});

module.exports = router;