const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || 'lunaticlavish357@gmail.com';

// Ensure data folder and messages.json exist
const DATA_DIR = path.join(__dirname, 'data');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(MESSAGES_FILE)) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify([], null, 2), 'utf8');
}

// Helper to read and write messages
function readMessages() {
  try {
    const raw = fs.readFileSync(MESSAGES_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading messages:', err);
    return [];
  }
}

function saveMessages(messages) {
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving messages:', err);
    return false;
  }
}

// Configure Nodemailer transporter if credentials provided
function getTransporter() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: user,
      pass: pass
    }
  });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets
app.use(express.static(__dirname));

// ========================================================
// API ROUTES
// ========================================================

// 1. Health check & status
app.get('/api/health', (req, res) => {
  const isSmtpConfigured = Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);
  const messages = readMessages();
  res.json({
    status: 'online',
    smtpConfigured: isSmtpConfigured,
    notificationEmail: NOTIFICATION_EMAIL,
    totalMessages: messages.length,
    unreadMessages: messages.filter(m => m.status === 'unread' || m.status === 'new').length
  });
});

// 2. Contact Endpoint (Receive Inquiry & Send Notification Email)
app.post(['/api/contact', '/api/send-email'], async (req, res) => {
  try {
    const { name, email, projectType, message } = req.body;

    // Validate required fields
    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        error: 'Please provide name, email, and message.'
      });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address.'
      });
    }

    const newMessage = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      name: name.trim(),
      email: email.trim(),
      projectType: projectType || 'General Inquiry',
      message: message.trim(),
      status: 'new', // 'new', 'read', 'replied'
      receivedAt: new Date().toISOString(),
      clientIp: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      replies: []
    };

    // Save to persistent messages inbox
    const messages = readMessages();
    messages.unshift(newMessage);
    saveMessages(messages);

    console.log(`[INBOX] New message received from: ${newMessage.name} <${newMessage.email}>`);

    let emailSent = false;
    let emailError = null;

    // Check if SMTP is configured to dispatch live email
    const transporter = getTransporter();
    if (transporter) {
      try {
        // A. Send notification email to site owner (Lawish Kumar)
        const ownerMailOptions = {
          from: `"${process.env.EMAIL_FROM_NAME || 'Portfolio Inquiries'}" <${process.env.EMAIL_USER}>`,
          to: NOTIFICATION_EMAIL,
          replyTo: newMessage.email,
          subject: `✨ New Inquiry from ${newMessage.name} [${newMessage.projectType}]`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0b0d14; color: #ffffff; padding: 30px; border-radius: 12px; border: 1px solid #222;">
              <h2 style="color: #ff5a1f; margin-top: 0;">New Portfolio Inquiry</h2>
              <p style="color: #aaa; font-size: 14px;">You have received a new contact submission from your portfolio website:</p>
              <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ff5a1f;">
                <p style="margin: 0 0 10px 0;"><strong>Name:</strong> ${newMessage.name}</p>
                <p style="margin: 0 0 10px 0;"><strong>Email:</strong> <a href="mailto:${newMessage.email}" style="color: #3d7eff;">${newMessage.email}</a></p>
                <p style="margin: 0 0 10px 0;"><strong>Project Type:</strong> ${newMessage.projectType}</p>
                <p style="margin: 0 0 10px 0;"><strong>Received At:</strong> ${new Date(newMessage.receivedAt).toLocaleString()}</p>
                <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.1); margin: 15px 0;" />
                <p style="margin: 0; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${newMessage.message}</p>
              </div>
              <p style="font-size: 13px; color: #777;">Click Reply in your email client to respond directly to ${newMessage.name} at ${newMessage.email}.</p>
            </div>
          `
        };

        await transporter.sendMail(ownerMailOptions);
        emailSent = true;
        console.log(`[EMAIL] Notification sent to ${NOTIFICATION_EMAIL}`);

        // B. Send acknowledgment receipt to the inquirer
        const visitorMailOptions = {
          from: `"${process.env.EMAIL_FROM_NAME || 'Lawish Kumar'}" <${process.env.EMAIL_USER}>`,
          to: newMessage.email,
          subject: `Thank you for reaching out, ${newMessage.name}!`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0b0d14; color: #ffffff; padding: 30px; border-radius: 12px; border: 1px solid #222;">
              <h2 style="color: #ff5a1f; margin-top: 0;">Message Received</h2>
              <p style="font-size: 15px; line-height: 1.6; color: #ddd;">
                Hi ${newMessage.name},<br/><br/>
                Thank you for getting in touch! I have received your message regarding <strong>${newMessage.projectType}</strong> and will review it promptly.
              </p>
              <div style="background: rgba(255,255,255,0.05); padding: 18px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0; font-size: 14px; color: #bbb;"><em>"${newMessage.message}"</em></p>
              </div>
              <p style="font-size: 14px; color: #aaa;">
                Best regards,<br/>
                <strong>Lawish Kumar</strong><br/>
                Web Developer<br/>
                <a href="https://github.com/Lawish777" style="color: #3d7eff; text-decoration: none;">GitHub</a> | 
                <a href="https://www.linkedin.com/in/lawish-kumar-791391186" style="color: #3d7eff; text-decoration: none;">LinkedIn</a>
              </p>
            </div>
          `
        };

        await transporter.sendMail(visitorMailOptions);
        console.log(`[EMAIL] Auto-reply confirmation sent to ${newMessage.email}`);
      } catch (err) {
        console.error('[EMAIL ERROR]', err);
        emailError = err.message;
      }
    } else {
      console.log('[NOTE] Live SMTP credentials not configured in .env; message successfully saved to local inbox.');
    }

    return res.status(200).json({
      success: true,
      message: 'Thank you! Your message has been received.',
      messageId: newMessage.id,
      emailSent: emailSent,
      storedInInbox: true,
      emailError: emailError
    });
  } catch (error) {
    console.error('Contact endpoint error:', error);
    return res.status(500).json({
      success: false,
      error: 'An unexpected server error occurred. Please try again later.'
    });
  }
});

// 3. Get All Messages (Inbox feed)
app.get('/api/messages', (req, res) => {
  const messages = readMessages();
  res.json({
    success: true,
    count: messages.length,
    messages: messages
  });
});

// 4. Update message status (read / unread / archived)
app.patch('/api/messages/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const messages = readMessages();
  const index = messages.findIndex(m => m.id === id);

  if (index === -1) {
    return res.status(404).json({ success: false, error: 'Message not found' });
  }

  messages[index].status = status || 'read';
  saveMessages(messages);

  res.json({ success: true, message: messages[index] });
});

// 5. Reply to a message directly via email
app.post('/api/messages/:id/reply', async (req, res) => {
  try {
    const { id } = req.params;
    const { replyMessage, subject } = req.body;

    if (!replyMessage) {
      return res.status(400).json({ success: false, error: 'Reply text is required' });
    }

    const messages = readMessages();
    const index = messages.findIndex(m => m.id === id);

    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    const target = messages[index];
    const transporter = getTransporter();

    let emailSent = false;
    let emailError = null;

    if (transporter) {
      try {
        const mailOptions = {
          from: `"${process.env.EMAIL_FROM_NAME || 'Lawish Kumar'}" <${process.env.EMAIL_USER}>`,
          to: target.email,
          subject: subject || `Re: Your inquiry on Lawish Kumar Portfolio`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0b0d14; color: #ffffff; padding: 30px; border-radius: 12px; border: 1px solid #222;">
              <h2 style="color: #ff5a1f; margin-top: 0;">Reply from Lawish Kumar</h2>
              <div style="font-size: 15px; line-height: 1.6; color: #eee; margin: 20px 0; white-space: pre-wrap;">
                ${replyMessage}
              </div>
              <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.1); margin: 20px 0;" />
              <p style="font-size: 13px; color: #888;">
                <strong>Original Message from ${target.name} (${new Date(target.receivedAt).toLocaleDateString()}):</strong><br/>
                <em>"${target.message}"</em>
              </p>
              <br/>
              <p style="font-size: 14px; color: #aaa;">
                <strong>Lawish Kumar</strong><br/>
                Web Developer<br/>
                <a href="https://github.com/Lawish777" style="color: #3d7eff;">GitHub</a> | 
                <a href="https://www.linkedin.com/in/lawish-kumar-791391186" style="color: #3d7eff;">LinkedIn</a>
              </p>
            </div>
          `
        };

        await transporter.sendMail(mailOptions);
        emailSent = true;
      } catch (err) {
        console.error('Reply mail error:', err);
        emailError = err.message;
      }
    } else {
      console.log(`[REPLY] Storing reply locally for ${target.email} (SMTP credentials not configured)`);
    }

    const replyRecord = {
      replyId: 'rep_' + Date.now(),
      sentAt: new Date().toISOString(),
      replyText: replyMessage,
      emailSent: emailSent
    };

    target.status = 'replied';
    target.replies = target.replies || [];
    target.replies.push(replyRecord);

    messages[index] = target;
    saveMessages(messages);

    res.json({
      success: true,
      message: emailSent ? 'Reply email sent successfully!' : 'Reply recorded in inbox (Configure SMTP in .env for live sending).',
      emailSent: emailSent,
      reply: replyRecord,
      emailError: emailError
    });
  } catch (error) {
    console.error('Reply endpoint error:', error);
    res.status(500).json({ success: false, error: 'Failed to process reply.' });
  }
});

// 6. Delete a message
app.delete('/api/messages/:id', (req, res) => {
  const { id } = req.params;
  const messages = readMessages();
  const filtered = messages.filter(m => m.id !== id);

  if (filtered.length === messages.length) {
    return res.status(404).json({ success: false, error: 'Message not found' });
  }

  saveMessages(filtered);
  res.json({ success: true, message: 'Message deleted successfully.' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`🚀 Portfolio Backend Server Running on Port ${PORT}`);
  console.log(`📍 Web URL: http://localhost:${PORT}`);
  console.log(`📬 Inbox Dashboard: http://localhost:${PORT}/inbox.html`);
  console.log(`✉️ Notification Recipient: ${NOTIFICATION_EMAIL}`);
  console.log(`🔐 SMTP Status: ${process.env.EMAIL_USER ? 'Configured (' + process.env.EMAIL_USER + ')' : 'Local Inbox Mode (Add credentials in .env for live email)'}`);
  console.log(`=================================================`);
});
