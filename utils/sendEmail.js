const nodemailer = require('nodemailer');

const sendEmail = async ({ to, subject, html, text, otp }) => {
  const host = process.env.SMTP_HOST || process.env.EMAIL_HOST;
  const port = parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || '587', 10);
  const user = process.env.SMTP_USER || process.env.EMAIL_USER || process.env.EMAIL_USERNAME;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD;
  const from = process.env.EMAIL_FROM || '"SpeddyProp" <no-reply@SpeddyProp.com>';

  // If SMTP credentials are not configured in .env, log OTP in console for dev mode
  if (!user || !pass || user.includes('your_email')) {
    console.log('\n======================================================');
    console.log(' [EMAIL SERVICE - DEV MODE] (SMTP not configured in .env)');
    console.log(` To: ${to}`);
    console.log(` Subject: ${subject}`);
    if (otp) {
      console.log(` OTP CODE: >>> ${otp} <<< (Valid for 10 minutes)`);
    }
    console.log('======================================================\n');

    return {
      success: true,
      mode: 'dev',
      messageId: `dev-${Date.now()}`,
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: host || 'smtp.gmail.com',
      port,
      secure: port === 465,
      tls: {
        rejectUnauthorized: false, // ⚠️ only for development
      },
      auth: {
        user,
        pass,
      },
    });

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: text || (otp ? `Your SpeddyProp password reset code is: ${otp}. Valid for 10 minutes.` : ''),
      html:
        html ||
        `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #2563eb; text-align: center;">SpeddyProp</h2>
          <p style="font-size: 16px; color: #334155;">Hello,</p>
          <p style="font-size: 15px; color: #475569;">You requested a password reset for your SpeddyProp account. Use the OTP code below to verify your request:</p>
          <div style="text-align: center; margin: 30px 0;">
            <span style="display: inline-block; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1e293b; background: #f1f5f9; padding: 12px 28px; border-radius: 6px; border: 1px dashed #cbd5e1;">
              ${otp}
            </span>
          </div>
          <p style="font-size: 14px; color: #64748b;">This code is valid for <strong>10 minutes</strong>. If you did not request this, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="font-size: 12px; color: #94a3b8; text-align: center;">SpeddyProp Real Estate Platform - Dominican Republic</p>
        </div>
      `,
    });

    console.log(`Email sent successfully to ${to}. MessageId: ${info.messageId}`);
    return {
      success: true,
      mode: 'smtp',
      messageId: info.messageId,
    };
  } catch (err) {
    console.error(`Failed to send email via SMTP: ${err.message}`);
    // Log OTP fallback even if SMTP fails so user/developer is never stuck
    if (otp) {
      console.log(`[FALLBACK DEV LOG] OTP for ${to}: ${otp}`);
    }
    return {
      success: false,
      error: err.message,
    };
  }
};

module.exports = sendEmail;