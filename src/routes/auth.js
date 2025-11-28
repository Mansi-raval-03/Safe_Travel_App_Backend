const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const auth = require('../middleware/auth');
const OTPVerification = require('../models/OTPVerification');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Helper: create transporter
const createEmailTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' }
  });
};

const generateOTP = () => {
  return crypto.randomInt(100000, 999999).toString();
};

const createOTPPlainTemplate = (otp) => {
  return {
    subject: 'Safe Travel - Password Reset Code',
    text: `Your Safe Travel password reset code is: ${otp}. It expires in 5 minutes.`
  };
};

const router = express.Router();

// Auth-specific rate limiting
const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // limit each IP to 5 requests per windowMs
  message: 'Too many authentication attempts, please try again later.'
});

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '24h'
  });
};

// Sign up
router.post('/signup', authLimiter, [
  body('name').isLength({ min: 2, max: 50 }).trim(),
  body('email').isEmail().normalizeEmail(),
  body('phone').matches(/^[\+]?[1-9][\d]{0,15}$/),
  body('password').isLength({ min: 6, max: 128 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors.array()
      });
    }

    const { name, email, phone, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Create user
    const user = new User({
      name,
      email,
      phone,
      password
    });

    await user.save();

    // Generate token
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: {
        user: user.toJSON(),
        token,
        expiresIn: 24 * 60 * 60 // 24 hours in seconds
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Sign in
router.post('/signin', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    const { email, password } = req.body;

    // Find user (removed email verification requirement)
    const user = await User.findOne({ email, isActive: true });
    if (!user || !(await user.validatePassword(password))) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Generate token
    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Authentication successful',
      data: {
        user: user.toJSON(),
        token,
        expiresIn: 24 * 60 * 60 // 24 hours in seconds
      }
    });
  } catch (error) {
    console.error('Signin error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Refresh token
router.post('/refresh', auth, async (req, res) => {
  try {
    const token = generateToken(req.user.id);

    res.json({
      success: true,
      data: {
        token,
        expiresIn: 24 * 60 * 60 // 24 hours in seconds
      }
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Sign out
router.post('/signout', auth, async (req, res) => {
  try {
    // In a production environment, you might want to blacklist the token
    res.json({
      success: true,
      message: 'Successfully signed out'
    });
  } catch (error) {
    console.error('Signout error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// POST /api/v1/auth/forgot-password - send OTP for password reset
router.post('/forgot-password', authLimiter, [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const { email } = req.body;

    // For security, always respond success message; only send email if account exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(200).json({ success: true, message: 'If an account exists for this email, a reset code has been sent.' });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await OTPVerification.findOneAndUpdate(
      { email },
      { email, otp, expiresAt, attempts: 0, isUsed: false, createdAt: new Date() },
      { upsert: true, new: true }
    );

    // Send email
    const transporter = createEmailTransporter();
    const template = createOTPPlainTemplate(otp);
    await transporter.sendMail({
      from: `"Safe Travel App" <${process.env.SMTP_USER}>`,
      to: email,
      subject: template.subject,
      text: template.text
    });

    console.log(`📧 Password reset OTP sent to ${email}: ${otp}`);

    res.status(200).json({ success: true, message: 'If an account exists for this email, a reset code has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: 'Failed to process request' });
  }
});

module.exports = router;

// POST /api/v1/auth/reset-password - Reset password using email + OTP
router.post('/reset-password', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('otp').isLength({ min: 6, max: 6 }).isNumeric(),
  body('password').isLength({ min: 6, max: 128 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const { email, otp, password } = req.body;

    // Find valid OTP record
    const otpRecord = await OTPVerification.findOne({ email });
    if (!otpRecord) {
      return res.status(404).json({ success: false, message: 'No OTP found for this email. Please request a new one.' });
    }

    if (otpRecord.isUsed) {
      return res.status(400).json({ success: false, message: 'This OTP has already been used. Please request a new one.' });
    }

    if (otpRecord.expiresAt < new Date()) {
      await OTPVerification.deleteOne({ email });
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    if (otpRecord.attempts >= 3) {
      await OTPVerification.deleteOne({ email });
      return res.status(429).json({ success: false, message: 'Too many incorrect attempts. Please request a new OTP.' });
    }

    if (otpRecord.otp !== otp) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      return res.status(400).json({ success: false, message: `Invalid OTP. ${3 - otpRecord.attempts} attempts remaining.` });
    }

    // OTP valid - mark used
    otpRecord.isUsed = true;
    otpRecord.verifiedAt = new Date();
    await otpRecord.save();

    // Find the user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'No account found for this email' });
    }

    // Update password (pre-save hook will hash)
    user.password = password;
    await user.save();

    // Clean up OTP record
    await OTPVerification.deleteForEmail(email);

    res.status(200).json({ success: true, message: 'Password updated successfully. You can now sign in with your new password.' });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
});
