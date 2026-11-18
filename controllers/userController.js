const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const Agency = require('../models/Agency');
const Notification = require('../models/Notification');
const Property = require('../models/Property');
const Lead = require('../models/Lead');
const sendEmail = require('../utils/sendEmail');
const { resolveLanguage, getLocalizedMessage } = require('../utils/languageHelper');
const Tier = require("../models/Tier");

// Helper to get JWT Secret with fallback
const getJwtSecret = () => process.env.JWT_SECRET || 'mycustomsupersecretkeyforjwt123';

// Helper function to generate JWT Access Token
const generateAccessToken = (id) => {
  return jwt.sign({ id }, getJwtSecret(), {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '7d',
  });
};

// Helper function to generate JWT Refresh Token
const generateRefreshToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_REFRESH_SECRET || getJwtSecret(), {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  });
};

// Helper to safely delete an old file from disk
const deleteOldFile = (filePath) => {
  if (!filePath) return;
  try {
    const cleanPath = filePath.replace(/^\//, '');
    const fullPath = path.join(__dirname, '..', cleanPath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (err) {
    console.error(`Failed to delete old file: ${err.message}`);
  }
};

// Helper to cleanup uploaded files on error
const cleanupUploadedFiles = (files) => {
  if (!files) return;
  try {
    const fileList = Array.isArray(files) ? files : Object.values(files).flat();
    fileList.forEach((file) => {
      if (file && file.path && fs.existsSync(file.path)) {
        try {
          fs.unlinkSync(file.path);
        } catch (e) { }
      }
    });
  } catch (err) {
    console.error(`Failed to cleanup uploaded files: ${err.message}`);
  }
};

const registerUser = async (req, res, next) => {
  try {
    const { name, email, password, phone, role } = req.body;
    const cleanEmail = email.toLowerCase().trim();

    // Determine language (defaults to 'english')
    const inputLang = (req.body.language || req.body.rawLang || req.body.lang || req.body.preferredLanguage || '').toString().toLowerCase().trim();
    let preferredLanguage = 'english';
    if (inputLang === 'spanish' || inputLang === 'es') {
      preferredLanguage = 'spanish';
    } else if (inputLang === 'english' || inputLang === 'en') {
      preferredLanguage = 'english';
    }

    // 1. Check if user already exists
    const userExists = await User.findOne({ email: cleanEmail });
    if (userExists) {
      if (req.file) {
        try { fs.unlinkSync(req.file.path); } catch (e) { }
      }
      const lang = preferredLanguage === 'spanish' ? 'es' : 'en';
      const error = new Error(getLocalizedMessage('emailExists', lang));
      error.statusCode = 400;
      return next(error);
    }

    // 2. Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 3. Determine profile image path if uploaded
    let profileImage = null;
    if (req.file) {
      profileImage = `/uploads/${req.file.filename}`;
    }

    // 4. Create new user (buyers always default to approved status)
    const accountStatus = (role === 'agent') ? 'pending' : 'approved';

    const user = new User({
      name,
      email: cleanEmail,
      password: hashedPassword,
      phone,
      role: role || 'buyer',
      status: accountStatus,
      profileImage,
      preferredLanguage,
    });

    // 5. Generate tokens and save refreshToken in database
    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    user.refreshToken = refreshToken;
    await user.save();

    // Auto-claim any leads sent to this agent's email before registration
    if (user.role === 'agent') {
      try {
        const unassignedLeads = await Lead.find({
          agentEmail: cleanEmail,
          isClaimed: false,
        });

        if (unassignedLeads && unassignedLeads.length > 0) {
          await Lead.updateMany(
            { agentEmail: cleanEmail, isClaimed: false },
            { $set: { agent: user._id, isClaimed: true } }
          );

          await Notification.create({
            recipient: user._id,
            title: {
              en: `${unassignedLeads.length} Inquiry(ies) Linked to Your Account`,
              es: `${unassignedLeads.length} Consulta(s) Vinculada(s) a Su Cuenta`,
            },
            message: {
              en: `You had ${unassignedLeads.length} inquiry(ies) received before registration. They are now linked to your dashboard.`,
              es: `Tenía ${unassignedLeads.length} consulta(s) recibida(s) antes de registrarse. Ahora están vinculadas a su panel.`,
            },
            type: 'LEAD_RECEIVED',
            data: {
              link: '/agent/leads',
            },
          });
        }
      } catch (claimErr) {
        console.error(`Auto-claim leads on registration error: ${claimErr.message}`);
      }
    }

    res.locals.userId = user._id; // Provide userId to auditLog middleware

    const lang = resolveLanguage(req, user);

    // 6. Send response with access and refresh tokens
    res.status(201).json({
      success: true,
      message: getLocalizedMessage('userRegistered', lang),
      data: {
        accessToken,
        refreshToken,
        token: accessToken, // Alias for backward compatibility
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          status: user.status,
          profileImage: user.profileImage,
          language: user.preferredLanguage || 'english',
          preferredLanguage: user.preferredLanguage || 'english',
          createdAt: user.createdAt,
        }
      }
    });

  } catch (err) {
    console.error(`Register error: ${err.message}`);
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkErr) {
        console.error(`Error deleting uploaded file: ${unlinkErr.message}`);
      }
    }
    next(err);
  }
};

const registerAgent = async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      agency,
      licenseNumber,
      document,
      profileImage,
    } = req.body;
    const cleanEmail = email.toLowerCase().trim();

    // Determine language (defaults to 'english') 
    const inputLang = (req.body.language || req.body.rawLang || req.body.lang || req.body.preferredLanguage || '').toString().toLowerCase().trim();
    let preferredLanguage = 'english';
    if (inputLang === 'spanish' || inputLang === 'es') {
      preferredLanguage = 'spanish';
    } else if (inputLang === 'english' || inputLang === 'en') {
      preferredLanguage = 'english';
    }

    // Check agency by ID if provided
    // Agency optional check: agar string "null"/"undefined"/empty ho toh null maanein
    const targetAgencyId = (agency && agency !== 'null' && agency !== 'undefined' && agency.trim() !== '')
      ? agency.trim()
      : null;
    let agencyDoc = null;

    if (targetAgencyId) {
      if (!mongoose.Types.ObjectId.isValid(targetAgencyId)) {
        if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) { } }
        if (req.files) {
          Object.values(req.files).flat().forEach((f) => {
            try { if (f && f.path) fs.unlinkSync(f.path); } catch (e) { }
          });
        }
        const error = new Error('Invalid Agency ID format');
        error.statusCode = 400;
        return next(error);
      }

      agencyDoc = await Agency.findById(targetAgencyId);
      if (!agencyDoc) {
        if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) { } }
        if (req.files) {
          Object.values(req.files).flat().forEach((f) => {
            try { if (f && f.path) fs.unlinkSync(f.path); } catch (e) { }
          });
        }
        const error = new Error('Agency not found');
        error.statusCode = 404;
        return next(error);
      }

      if (agencyDoc.isActive === false) {
        if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) { } }
        if (req.files) {
          Object.values(req.files).flat().forEach((f) => {
            try { if (f && f.path) fs.unlinkSync(f.path); } catch (e) { }
          });
        }
        const error = new Error('Selected agency is currently inactive');
        error.statusCode = 400;
        return next(error);
      }
    }

    // 1. Check if user already exists
    const userExists = await User.findOne({ email: cleanEmail });
    if (userExists) {
      if (req.file) {
        try { fs.unlinkSync(req.file.path); } catch (e) { }
      }
      if (req.files) {
        Object.values(req.files).flat().forEach((f) => {
          try { if (f && f.path) fs.unlinkSync(f.path); } catch (e) { }
        });
      }
      const lang = preferredLanguage === 'spanish' ? 'es' : 'en';
      const error = new Error(getLocalizedMessage('emailExists', lang));
      error.statusCode = 400;
      return next(error);
    }

    // 2. Hash password (fallback to default temporary password if not provided)
    const userPassword = password;
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(userPassword, salt);

    // 3. Resolve profileImage and document paths if uploaded
    let resolvedProfileImage = profileImage || null;
    let resolvedDocument = document || null;

    if (req.file) {
      if (req.file.fieldname === 'profileImage') {
        resolvedProfileImage = `/uploads/${req.file.filename}`;
      } else if (req.file.fieldname === 'document') {
        resolvedDocument = `/uploads/${req.file.filename}`;
      }
    }

    if (req.files) {
      if (req.files.profileImage && req.files.profileImage[0]) {
        resolvedProfileImage = `/uploads/${req.files.profileImage[0].filename}`;
      }
      if (req.files.document && req.files.document[0]) {
        resolvedDocument = `/uploads/${req.files.document[0].filename}`;
      }
    }

    const agentLicense = (licenseNumber || '').trim();

    // Generate secure email verification token
    const rawVerificationToken = crypto.randomBytes(32).toString('hex');
    const hashedVerificationToken = crypto.createHash('sha256').update(rawVerificationToken).digest('hex');
    const verificationTokenExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes validity

    //  ================= 4. AGENCY SEATS / QUOTA & TIER LOGIC =================
    let isCoveredByAgency = false;
    let assignedTierId = null;
    let coverageMessage = '';

    // Default Tier 1 (Basic / Free) nikaal lein fallback ke liye
    const defaultTier1 = await Tier.findOne({ tierLevel: 1 });

    if (agencyDoc) {
      const seatsLimit = agencyDoc.agentSeatsLimit || 0;
      const currentCount = agencyDoc.coveredAgentsCount || 0;
      // Check karein: Kya Agency ke plan me seat khali hai?
      if (seatsLimit > 0 && currentCount < seatsLimit) {
        //  SEAT AVAILABLE HAI:
        isCoveredByAgency = true;
        assignedTierId = agencyDoc.tier || (defaultTier1 ? defaultTier1._id : null);

        // Agency ki used seats (+1) update karein
        agencyDoc.coveredAgentsCount = currentCount + 1;
        await agencyDoc.save();
        coverageMessage = `Covered under ${agencyDoc.name} plan (${currentCount + 1}/${seatsLimit} seats used).`;
      } else {
        //  SEATS FULL HAIN ya Agency ka koi paid quota nahi hai:
        isCoveredByAgency = false;
        assignedTierId = defaultTier1 ? defaultTier1._id : null; // Default Free Tier 1
        coverageMessage = seatsLimit > 0
          ? `Agency limit reached (${seatsLimit}/${seatsLimit} seats). Agent must purchase an additional seat.`
          : 'Agency has no covered seat quota. Agent defaults to Basic Tier.';
      }
    } else {
      // Independent Agent (No Agency selected)
      isCoveredByAgency = false;
      assignedTierId = defaultTier1 ? defaultTier1._id : null;
      coverageMessage = 'Independent agent registered with Basic Tier.';
    }

    // 4. Create new Agent user (Role: 'agent', Status: 'pending', isEmailVerified: false) 
    const user = new User({
      name,
      email: cleanEmail,
      password: hashedPassword,
      phone,
      role: 'agent',
      status: 'pending',
      agency: agencyDoc ? agencyDoc._id : null,
      licenseNumber: agentLicense,
      document: resolvedDocument,
      profileImage: resolvedProfileImage,
      preferredLanguage,
      verificationToken: hashedVerificationToken,
      verificationTokenExpires,
      isEmailVerified: false,

      // ✅ Quota & Tier fields:
      tier: assignedTierId,
      isCoveredByAgency: isCoveredByAgency,
    });

    // user.refreshToken = refreshToken;
    await user.save();

    // Auto-link existing unclaimed properties matching this agent's email or phone
    let linkedPropertiesCount = 0;
    try {
      const cleanPhoneDigits = (phone || '').replace(/[^0-9]/g, '');
      const orLinkConditions = [{ 'agentDetails.email': cleanEmail }];
      if (cleanPhoneDigits.length >= 7) {
        orLinkConditions.push({ 'agentDetails.phone': { $regex: cleanPhoneDigits.slice(-8) } });
      }

      const linkQuery = {
        agent: null,
        $or: orLinkConditions,
      };

      const updateFields = { agent: user._id };
      if (user.agency) {
        updateFields.agency = user.agency;
      }

      const linkResult = await Property.updateMany(linkQuery, { $set: updateFields });
      linkedPropertiesCount = linkResult.modifiedCount || 0;
      if (linkedPropertiesCount > 0) {
        console.log(`Auto-linked ${linkedPropertiesCount} properties to newly registered agent: ${user.name} (${user.email})`);
      }
    } catch (linkErr) {
      console.error(`Auto-linking properties failed: ${linkErr.message}`);
    }

    // Auto-link existing unclaimed leads matching this agent's email
    let linkedLeadsCount = 0;
    try {
      const Lead = require('../models/Lead');
      const leadLinkResult = await Lead.updateMany(
        { agentEmail: cleanEmail.toLowerCase(), isClaimed: false },
        { $set: { agent: user._id, isClaimed: true } }
      );
      linkedLeadsCount = leadLinkResult.modifiedCount || 0;
      if (linkedLeadsCount > 0) {
        console.log(`Auto-linked ${linkedLeadsCount} leads to newly registered agent: ${user.name} (${user.email})`);
      }
    } catch (leadLinkErr) {
      console.error(`Auto-linking leads failed: ${leadLinkErr.message}`);
    }

    // 5. Send Verification Email to Agent
    const baseUrl = (process.env.BASE_URL || 'https://mobappssolutiondevelopment.com/kleverProp').replace(/\/+$/, '');
    const verificationUrl = `${baseUrl}/api/users/verify-email?token=${rawVerificationToken}`;

    try {
      const isSpanish = preferredLanguage === 'spanish';
      const emailSubject = isSpanish
        ? 'Verifique y active su cuenta de asesor - KleverProp'
        : 'Verify and Activate Your Agent Account - KleverProp';

      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; background-color: #ffffff;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #2563eb; margin: 0; font-size: 26px; font-weight: bold;">KleverProp</h1>
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Real Estate Platform</p>
          </div>
          <div style="border-top: 1px solid #f1f5f9; padding-top: 20px;">
            <h2 style="color: #1e293b; font-size: 20px; margin-bottom: 12px;">
              ${isSpanish ? `¡Hola, ${user.name}!` : `Hello, ${user.name}!`}
            </h2>
            <p style="font-size: 15px; color: #475569; line-height: 1.6;">
              ${isSpanish
          ? 'Gracias por registrarte como asesor en KleverProp. Tu cuenta se encuentra actualmente con estado <strong>Pendiente</strong>. Para verificar tu correo electrónico antes de la revisión y aprobación de tus documentos de KYC por el administrador, por favor haz clic en el siguiente botón:'
          : 'Thank you for registering as an agent on KleverProp. Your account is currently in <strong>Pending</strong> status. To verify your email address before our admin reviews and approves your KYC documents, please click the button below:'}
            </p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${verificationUrl}" target="_blank" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 32px; font-size: 16px; font-weight: bold; border-radius: 6px; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);">
                ${isSpanish ? 'Verificar Correo Electrónico' : 'Verify Email Address'}
              </a>
            </div>
            <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
              ${isSpanish
          ? `Si el botón no funciona, copia y pega el siguiente enlace en tu navegador:<br/><a href="${verificationUrl}" style="color: #2563eb; word-break: break-all;">${verificationUrl}</a>`
          : `If the button does not work, copy and paste the following link into your browser:<br/><a href="${verificationUrl}" style="color: #2563eb; word-break: break-all;">${verificationUrl}</a>`}
            </p>
            <p style="font-size: 13px; color: #dc2626; margin-top: 20px; font-weight: bold;">
              ${isSpanish ? '⚠️ Este enlace de verificación es válido por 5 minutos.' : '⚠️ This verification link is valid for 5 minutes.'}
            </p>
          </div>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
            KleverProp Real Estate &copy; ${new Date().getFullYear()}
          </p>
        </div>
      `;

      await sendEmail({
        to: user.email,
        subject: emailSubject,
        html: emailHtml,
        text: isSpanish
          ? `Hola ${user.name}, verifique su cuenta haciendo clic en el siguiente enlace (válido por 5 minutos): ${verificationUrl}`
          : `Hello ${user.name}, please verify your account by clicking this link (valid for 5 minutes): ${verificationUrl}`,
      });
    } catch (emailErr) {
      console.error(`Failed to send agent verification email: ${emailErr.message}`);
    }

    // Send in-app notifications
    try {
      // 1. If agent registered under an agency but seats are full, notify the agent
      if (agencyDoc && !isCoveredByAgency) {
        await Notification.create({
          recipient: user._id,
          sender: null,
          title: {
            en: 'Agency Seat Limit Reached',
            es: 'Límite de Asientos de Agencia Alcanzado',
          },
          message: {
            en: `You registered under ${agencyDoc.name}, but their covered agent seats are currently full (${agencyDoc.agentSeatsLimit || 0}/${agencyDoc.agentSeatsLimit || 0} seats used). Your account is currently on the Basic Tier. You can upgrade your plan or purchase an additional seat anytime to unlock ${agencyDoc.name}'s tier benefits.`,
            es: `Se ha registrado bajo ${agencyDoc.name}, pero sus asientos cubiertos para asesores están actualmente llenos (${agencyDoc.agentSeatsLimit || 0}/${agencyDoc.agentSeatsLimit || 0} asientos usados). Su cuenta se encuentra actualmente en el Plan Básico. Puede actualizar su plan o adquirir un asiento adicional en cualquier momento para desbloquear los beneficios del plan de ${agencyDoc.name}.`,
          },
          type: 'SYSTEM_ALERT',
          data: {
            metadata: {
              agencyId: agencyDoc._id,
              agencyName: agencyDoc.name,
              isCoveredByAgency: false,
              seatsLimit: agencyDoc.agentSeatsLimit || 0,
              coveredAgentsCount: agencyDoc.coveredAgentsCount || 0,
            },
          },
        });
      }

      // 2. Notify all admin users about the new agent registration (including agency limit status)
      const admins = await User.find({ role: 'admin' }).select('_id');
      if (admins && admins.length > 0) {
        const isQuotaFull = agencyDoc && !isCoveredByAgency;

        const adminTitle = isQuotaFull
          ? {
            en: `Agency Limit Exceeded: ${agencyDoc.name}`,
            es: `Límite de Agencia Superado: ${agencyDoc.name}`,
          }
          : {
            en: 'New Agent Approval Required',
            es: 'Se requiere aprobación de nuevo asesor',
          };

        const adminMessage = isQuotaFull
          ? {
            en: `Agent ${user.name} (${user.email}) registered under ${agencyDoc.name}, but the agency seat limit (${agencyDoc.agentSeatsLimit || 0}/${agencyDoc.agentSeatsLimit || 0}) is full. Agent assigned to Basic Tier.`,
            es: `El asesor ${user.name} (${user.email}) se registró bajo ${agencyDoc.name}, pero el límite de asientos (${agencyDoc.agentSeatsLimit || 0}/${agencyDoc.agentSeatsLimit || 0}) está lleno. Asesor asignado al Plan Básico.`,
          }
          : {
            en: `New agent registration: ${user.name} (${user.email}). Account is pending approval.`,
            es: `Nuevo registro de asesor: ${user.name} (${user.email}). La cuenta está pendiente de aprobación.`,
          };

        const notifications = admins.map((adminUser) => ({
          recipient: adminUser._id,
          sender: user._id,
          title: adminTitle,
          message: adminMessage,
          type: 'AGENT_REGISTRATION',
          data: {
            link: `/admin/agents/${user._id}`,
            metadata: {
              agentId: user._id,
              agentName: user.name,
              agentEmail: user.email,
              phone: user.phone,
              agency: user.agency,
              agencyName: agencyDoc ? agencyDoc.name : null,
              licenseNumber: user.licenseNumber,
              status: user.status,
              isCoveredByAgency: user.isCoveredByAgency,
              agencySeatsLimit: agencyDoc ? agencyDoc.agentSeatsLimit : null,
            },
          },
        }));

        await Notification.insertMany(notifications);
      }
    } catch (notifErr) {
      console.error(`Failed to send agent registration notifications: ${notifErr.message}`);
    }

    // 6. Send response
    res.locals.userId = user._id; // Provide userId to auditLog middleware
    const lang = resolveLanguage(req, user);

    res.status(201).json({
      success: true,
      message: getLocalizedMessage('verificationEmailSent', lang),
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status, // 'pending'
        isEmailVerified: user.isEmailVerified,
        agency: agencyDoc ? {
          _id: agencyDoc._id,
          name: agencyDoc.name,
          logo: agencyDoc.logo || null,
        } : user.agency,
        licenseNumber: user.licenseNumber,
        document: user.document,
        profileImage: user.profileImage,
        language: user.preferredLanguage || 'english',
        preferredLanguage: user.preferredLanguage || 'english',
        linkedProperties: linkedPropertiesCount,
        createdAt: user.createdAt,
      }
    });

  } catch (err) {
    console.error(`Register agent error: ${err.message}`);
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkErr) {
        console.error(`Error deleting uploaded file: ${unlinkErr.message}`);
      }
    }
    if (req.files) {
      Object.values(req.files).flat().forEach((f) => {
        try {
          if (f && f.path) fs.unlinkSync(f.path);
        } catch (unlinkErr) {
          console.error(`Error deleting uploaded file: ${unlinkErr.message}`);
        }
      });
    }
    next(err);
  }
};

const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const rawLanguage = req.body.language || req.body.preferredLanguage || req.body.lang;

    const cleanEmail = email.toLowerCase().trim();

    // 1. Find user
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      // User nahi mila, isliye body/header se language resolve hogi
      const lang = resolveLanguage(req);

      const error = new Error(
        getLocalizedMessage('invalidCredentials', lang)
      );

      error.statusCode = 401;
      return next(error);
    }

    // 2. Body me language aaye to user profile me save karo 
    //ankit,ritik, verma, shivam, upendra, kali, ankush bhai, gla, askay, tushar, 
    if (typeof rawLanguage === 'string' && rawLanguage.trim() !== '') {
      const normalizedLanguage = rawLanguage.toLowerCase().trim();

      if (['english', 'en'].includes(normalizedLanguage)) {
        user.preferredLanguage = 'english';
      } else if (['spanish', 'es'].includes(normalizedLanguage)) {
        user.preferredLanguage = 'spanish';
      }
    }

    // resolveLanguage() hamesha 'en' ya 'es' return karega
    // Body language available hai to updated user preference use hogi
    // Body language nahi hai to DB wali preference use hogi
    const finalLang = resolveLanguage(req, user);

    // 3. Check active account
    if (user.isActive === false) {
      const error = new Error(
        getLocalizedMessage('accountDeactivated', finalLang)
      );

      error.statusCode = 403;
      return next(error);
    }

    // 4. Check email verification for agents
    if (user.role === 'agent' && user.isEmailVerified === false) {
      const error = new Error(
        getLocalizedMessage('emailVerificationRequired', finalLang)
      );

      error.statusCode = 403;
      return next(error);
    }

    // 5. Check password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      const error = new Error(
        getLocalizedMessage('invalidCredentials', finalLang)
      );

      error.statusCode = 401;
      return next(error);
    }

    // 6. Generate tokens
    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    user.refreshToken = refreshToken;

    // Language body me aayi ho to updated preferredLanguage save hogi
    await user.save();

    // 7. Send response
    res.json({
      success: true,

      // finalLang yahan 'en' ya 'es' hoga
      message: getLocalizedMessage('loginSuccess', finalLang),

      data: {
        accessToken,
        refreshToken,

        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          status: user.status,
          agency: user.agency || null,
          isEmailVerified: user.isEmailVerified ?? false,
          isCoveredByAgency: Boolean(user.isCoveredByAgency),
          tier: user.tier || null,

          licenseNumber:
            user.licenseNumber || user.liceneseNumber,

          liceneseNumber:
            user.liceneseNumber || user.licenseNumber,

          document: user.document,
          profileImage: user.profileImage,

          // Response me readable value bhejo
          // 'en' ke liye english, 'es' ke liye spanish
          preferredLanguage:
            finalLang === 'es' ? 'spanish' : 'english',

          preferredCurrency: user.preferredCurrency ? user.preferredCurrency : "Dollar",

          createdAt: user.createdAt
        }
      }
    });
  } catch (err) {
    console.error(`Login error: ${err.message}`);
    next(err);
  }
};

// const getUserProfile = async (req, res, next) => {
//   try {
//     const lang = resolveLanguage(req);
//     res.json({
//       success: true,
//       message: getLocalizedMessage('profileRetrieved', lang),
//       data: {
//         id: req.user._id,
//         name: req.user.name,
//         email: req.user.email,
//         phone: req.user.phone,
//         role: req.user.role,
//         status: req.user.status,
//         agency: req.user.agency || null,
//         licenseNumber: req.user.licenseNumber || req.user.liceneseNumber,
//         liceneseNumber: req.user.liceneseNumber || req.user.licenseNumber,
//         document: req.user.document,
//         profileImage: req.user.profileImage,
//         preferredLanguage: req.user.preferredLanguage || 'english',
//         createdAt: req.user.createdAt,
//       }
//     });
//   } catch (err) {
//     console.error(`Get profile error: ${err.message}`);
//     next(err);
//   }
// };

const getUserProfile = async (req, res, next) => {
  try {
    const lang = resolveLanguage(req);

    let user = await User.findById(req.user._id)
      .populate({
        path: "agency",
        select: "_id name logo",
      })
      .populate({
        path: "tier",
        select: "_id tierLevel name description pricing uiAppearance",
      })
      .select("-password -refreshToken");

    if (!user) {
      const error = new Error(
        lang === "es" ? "Usuario no encontrado" : "User not found"
      );

      error.statusCode = 404;
      return next(error);
    }

    // Fallback: Agar agent ke paas tier null hai, toh Tier 1 (Basic) assign karke populate karein
    if (user.role === "agent" && !user.tier) {
      const defaultTier = await Tier.findOne({ tierLevel: 1 });
      if (defaultTier) {
        user.tier = defaultTier;
        User.updateOne({ _id: user._id }, { $set: { tier: defaultTier._id } }).exec().catch(() => { });
      }
    }

    return res.json({
      success: true,
      message: getLocalizedMessage("profileRetrieved", lang),
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,

        isEmailVerified: user.isEmailVerified,

        aiChatUsage: {
          totalAiLimit: 5,
          aiUserUsage: user.aiChatUsage.count
        },

        agency: user.agency
          ? {
            id: user.agency._id,
            name: user.agency.name,
            logo: user.agency.logo,
          }
          : null,

        tier: user.tier || null,
        isCoveredByAgency: Boolean(user.isCoveredByAgency),

        licenseNumber: user.licenseNumber || null,
        document: user.document || null,
        profileImage: user.profileImage || null,
        preferredLanguage: user.preferredLanguage || "english",
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    console.error(`Get profile error: ${err.message}`);
    next(err);
  }
};

const updateUserProfile = async (req, res, next) => {
  const uploadedFiles = [];

  try {
    const lang = resolveLanguage(req);

    const user = await User.findById(req.user._id);

    if (!user) {
      cleanupUploadedFiles(req.files);

      const error = new Error(
        lang === "es" ? "Usuario no encontrado" : "User not found"
      );

      error.statusCode = 404;
      return next(error);
    }

    const profileImageFile = req.files?.profileImage?.[0];
    const documentFile = req.files?.document?.[0];

    if (profileImageFile) {
      uploadedFiles.push(profileImageFile.path);
    }

    if (documentFile) {
      uploadedFiles.push(documentFile.path);
    }

    // Email update
    if (req.body.email) {
      const cleanEmail = req.body.email.toLowerCase().trim();

      if (cleanEmail !== user.email) {
        const existingUser = await User.findOne({
          email: cleanEmail,
          _id: { $ne: req.user._id },
        });

        if (existingUser) {
          cleanupUploadedFiles(req.files);

          const error = new Error(
            lang === "es"
              ? "El correo electrónico ya está registrado"
              : "Email is already in use by another user"
          );

          error.statusCode = 400;
          return next(error);
        }

        user.email = cleanEmail;
      }
    }

    // Text fields update
    if (req.body.name !== undefined) {
      user.name = req.body.name.trim();
    }

    if (req.body.phone !== undefined) {
      user.phone = req.body.phone.trim();
    }

    if (req.body.role !== undefined) {
      user.role = req.body.role;
    }

    const incomingLicense = req.body.licenseNumber !== undefined ? req.body.licenseNumber : req.body.liceneseNumber;
    if (incomingLicense !== undefined) {
      user.licenseNumber = incomingLicense ? incomingLicense.trim() : null;
    }

    if (req.body.preferredLanguage !== undefined) {
      user.preferredLanguage = req.body.preferredLanguage
        .toLowerCase()
        .trim();
    }

    // Agency update
    const incomingAgencyId = req.body.agency || req.body.agencyId;

    if (incomingAgencyId !== undefined) {
      if (incomingAgencyId === "" || incomingAgencyId === null) {
        user.agency = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(incomingAgencyId)) {
          const error = new Error(
            lang === "es" ? "Agencia inválida" : "Invalid agency"
          );

          error.statusCode = 400;
          return next(error);
        }

        const agencyDoc = await Agency.findOne({
          _id: incomingAgencyId,
          isActive: true,
        });

        if (!agencyDoc) {
          const error = new Error(
            lang === "es"
              ? "Agencia no encontrada o inactiva"
              : "Agency not found or inactive"
          );

          error.statusCode = 404;
          return next(error);
        }

        user.agency = agencyDoc._id;
      }
    }

    // Profile image update
    if (profileImageFile) {
      deleteOldFile(user.profileImage);
      user.profileImage = `/uploads/${profileImageFile.filename}`;
    } else if (req.body.profileImage !== undefined) {
      if (!req.body.profileImage) {
        deleteOldFile(user.profileImage);
        user.profileImage = null;
      } else {
        user.profileImage = req.body.profileImage.trim();
      }
    }

    let isDocUpdated = false;

    // Document update
    if (documentFile) {
      deleteOldFile(user.document);
      user.document = `/uploads/${documentFile.filename}`;
      isDocUpdated = true;
    } else if (req.body.document !== undefined) {
      if (!req.body.document) {
        deleteOldFile(user.document);
        user.document = null;
      } else if (user.document !== req.body.document.trim()) {
        user.document = req.body.document.trim();
        isDocUpdated = true;
      }
    }

    // Agar agent ne document naya daala hai, toh status reset hokar 'pending' ho jayega
    if (user.role === 'agent' && isDocUpdated) {
      user.status = 'pending';
    }

    const updatedUser = await user.save();
    if (updatedUser.agency) {
      await updatedUser.populate('agency', 'name logo description isActive');
    }
    if (updatedUser.tier) {
      await updatedUser.populate('tier', '_id tierLevel name description pricing uiAppearance');
    }

    // Document update hone par sabhi Admins ko instant notification bhejo
    if (user.role === 'agent' && isDocUpdated) {
      try {
        const admins = await User.find({ role: 'admin' }).select('_id');
        if (admins && admins.length > 0) {
          const notifications = admins.map((adminUser) => ({
            recipient: adminUser._id,
            sender: user._id,
            title: {
              en: 'KYC Documents Resubmitted',
              es: 'Documentos KYC Reenviados',
            },
            message: {
              en: `Agent ${user.name} (${user.email}) has updated/resubmitted their KYC documents for approval.`,
              es: `El asesor ${user.name} (${user.email}) ha actualizado/reenviado sus documentos de KYC para su aprobación.`,
            },
            type: 'AGENT_REGISTRATION',
            data: {
              link: `/admin/agents/${user._id}`,
              metadata: {
                agentId: user._id,
                agentName: user.name,
                agentEmail: user.email,
                phone: user.phone,
                licenseNumber: user.licenseNumber,
                status: 'pending',
                isResubmission: true,
              },
            },
          }));
          await Notification.insertMany(notifications);
        }
      } catch (notifErr) {
        console.error(`Failed to send KYC update notification to admin: ${notifErr.message}`);
      }
    }

    return res.json({
      success: true,
      message: getLocalizedMessage("profileUpdated", lang),
      data: {
        user: {
          id: updatedUser._id,
          name: updatedUser.name,
          email: updatedUser.email,
          phone: updatedUser.phone,
          role: updatedUser.role,
          status: updatedUser.status,

          agency: updatedUser.agency
            ? (typeof updatedUser.agency === 'object' && updatedUser.agency.name
              ? {
                id: updatedUser.agency._id,
                name: updatedUser.agency.name,
                logo: updatedUser.agency.logo || null,
              }
              : updatedUser.agency)
            : null,

          tier: updatedUser.tier || null,
          isCoveredByAgency: Boolean(updatedUser.isCoveredByAgency),

          licenseNumber: updatedUser.licenseNumber || null,
          document: updatedUser.document || null,
          profileImage: updatedUser.profileImage || null,
          preferredLanguage:
            updatedUser.preferredLanguage || "english",
          createdAt: updatedUser.createdAt,
        },
      },
    });
  } catch (err) {
    console.error(`Update profile error: ${err.message}`);

    cleanupUploadedFiles(req.files);

    next(err);
  }
};

const resubmitKYC = async (req, res, next) => {
  try {
    const lang = resolveLanguage(req, req.user);

    // 1. Must be an agent
    if (!req.user || req.user.role !== 'agent') {
      if (req.file) deleteOldFile(req.file.path);
      if (req.files) {
        Object.values(req.files).flat().forEach((f) => deleteOldFile(f.path));
      }
      const error = new Error(
        lang === 'es'
          ? 'Solo los asesores pueden enviar o reenviar documentos de KYC'
          : 'Only agents can submit or resubmit KYC documents'
      );
      error.statusCode = 403;
      return next(error);
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      if (req.file) deleteOldFile(req.file.path);
      if (req.files) {
        Object.values(req.files).flat().forEach((f) => deleteOldFile(f.path));
      }
      const error = new Error(getLocalizedMessage('userNotFound', lang));
      error.statusCode = 404;
      return next(error);
    }

    // 2. Resolve document upload (single file or body string)
    let newDocument = null;
    if (req.file) {
      newDocument = `/uploads/${req.file.filename}`;
    } else if (req.files && req.files.document && req.files.document[0]) {
      newDocument = `/uploads/${req.files.document[0].filename}`;
    } else if (req.body.document && typeof req.body.document === 'string') {
      newDocument = req.body.document.trim();
    }

    // License number update (if provided)
    const incomingLicense = req.body.licenseNumber || req.body.liceneseNumber || req.body.license_number;
    if (incomingLicense && typeof incomingLicense === 'string' && incomingLicense.trim() !== '') {
      user.licenseNumber = incomingLicense.trim();
    }

    // Must have at least a document provided or already in place
    if (!newDocument && !user.document) {
      if (req.file) deleteOldFile(req.file.path);
      if (req.files) {
        Object.values(req.files).flat().forEach((f) => deleteOldFile(f.path));
      }
      const error = new Error(getLocalizedMessage('kycDocumentRequired', lang));
      error.statusCode = 400;
      return next(error);
    }

    if (newDocument) {
      if (user.document && user.document !== newDocument) {
        deleteOldFile(user.document);
      }
      user.document = newDocument;
    }

    // 3. Reset status to 'pending'
    user.status = 'pending';
    await user.save();

    // 4. Send Notification to all Admins
    try {
      const admins = await User.find({ role: 'admin' }).select('_id');
      if (admins && admins.length > 0) {
        const notifications = admins.map((adminUser) => ({
          recipient: adminUser._id,
          sender: user._id,
          title: {
            en: 'KYC Documents Resubmitted',
            es: 'Documentos KYC Reenviados',
          },
          message: {
            en: `Agent ${user.name} (${user.email}) has resubmitted their KYC documents for approval.`,
            es: `El asesor ${user.name} (${user.email}) ha reenviado sus documentos de KYC para su aprobación.`,
          },
          type: 'AGENT_REGISTRATION',
          data: {
            link: `/admin/agents/${user._id}`,
            metadata: {
              agentId: user._id,
              agentName: user.name,
              agentEmail: user.email,
              phone: user.phone,
              licenseNumber: user.licenseNumber,
              status: 'pending',
              isResubmission: true,
            },
          },
        }));

        await Notification.insertMany(notifications);
      }
    } catch (notifErr) {
      console.error(`Failed to send KYC resubmission notification to admin: ${notifErr.message}`);
    }

    // 5. Send Response
    return res.status(200).json({
      success: true,
      message: getLocalizedMessage('kycResubmittedSuccess', lang),
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status, // 'pending'
        isEmailVerified: user.isEmailVerified,
        licenseNumber: user.licenseNumber,
        document: user.document,
        updatedAt: user.updatedAt,
      },
    });
  } catch (err) {
    console.error(`Resubmit KYC error: ${err.message}`);
    if (req.file) deleteOldFile(req.file.path);
    if (req.files) {
      Object.values(req.files).flat().forEach((f) => deleteOldFile(f.path));
    }
    next(err);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const oldPassword = req.body.oldPassword || req.body.old_password;
    const { newPassword, confirmPassword } = req.body;
    const lang = resolveLanguage(req);

    if (!oldPassword) {
      const error = new Error(
        lang === "es"
          ? "La contraseña anterior es obligatoria"
          : "Old password is required"
      );

      error.statusCode = 400;
      return next(error);
    }

    if (!newPassword || !confirmPassword) {
      const error = new Error(
        lang === "es"
          ? "La nueva contraseña y la confirmación son obligatorias"
          : "New password and confirm password are required"
      );

      error.statusCode = 400;
      return next(error);
    }

    if (newPassword !== confirmPassword) {
      const error = new Error(
        lang === "es"
          ? "Las contraseñas no coinciden"
          : "Passwords do not match"
      );

      error.statusCode = 400;
      return next(error);
    }

    const strongPasswordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,}$/;
    if (!strongPasswordPattern.test(newPassword)) {
      const error = new Error(
        lang === "es"
          ? "La contraseña debe tener al menos 6 caracteres y contener al menos 1 letra mayúscula, 1 minúscula, 1 número y 1 carácter especial"
          : "Password must be at least 6 characters long and contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character"
      );

      error.statusCode = 400;
      return next(error);
    }

    const user = await User.findById(req.user._id).select('+password');

    if (!user) {
      const error = new Error(
        lang === "es" ? "Usuario no encontrado" : "User not found"
      );

      error.statusCode = 404;
      return next(error);
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      const error = new Error(
        lang === "es"
          ? "La contraseña anterior no coincide"
          : "Old password does not match"
      );

      error.statusCode = 400;
      return next(error);
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    // Active refresh sessions invalidate करना
    user.refreshToken = null;

    await user.save();

    return res.json({
      success: true,
      message: getLocalizedMessage("passwordChanged", lang),
      data: null,
    });
  } catch (err) {
    console.error(`Change password error: ${err.message}`);
    next(err);
  }
};

const changeLanguage = async (req, res, next) => {
  try {
    const rawLanguage = req.body.preferredLanguage || req.body.language;

    if (!rawLanguage) {
      const error = new Error('Preferred language is required');
      error.statusCode = 400;
      return next(error);
    }

    const language = rawLanguage.toLowerCase().trim();
    const validLanguages = ['english', 'spanish'];

    if (!validLanguages.includes(language)) {
      const error = new Error('Invalid language. Allowed values are english or spanish');
      error.statusCode = 400;
      return next(error);
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      return next(error);
    }

    user.preferredLanguage = language;
    await user.save();

    res.status(200).json({
      success: true,
      message: language === 'spanish'
        ? 'Idioma actualizado exitosamente'
        : 'Language updated successfully',
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        preferredLanguage: user.preferredLanguage,
      },
    });
  } catch (err) {
    console.error(`Change language error: ${err.message}`);
    next(err);
  }
};

const changeCurrency = async (req, res, next) => {
  try {
    const lang = resolveLanguage(req);
    const rawCurrency = req.body.preferredCurrency || req.body.Currency || req.body.currency;

    if (!rawCurrency) {
      const error = new Error(
        getLocalizedMessage('preferredCurrencyRequired', lang) ||
        (lang === 'es' ? 'La moneda preferida es obligatoria' : 'Preferred Currency is required')
      );
      error.statusCode = 400;
      return next(error);
    }

    const currencyMap = {
      pesos: 'Pesos',
      dollar: 'Dollar',
      euros: 'Euros',
      peso: 'Pesos',
      dollars: 'Dollar',
      euro: 'Euros',
      dop: 'Pesos',
      usd: 'Dollar',
      eur: 'Euros',
    };

    const currency = currencyMap[rawCurrency.toString().toLowerCase().trim()];

    if (!currency) {
      const error = new Error(
        getLocalizedMessage('invalidCurrency', lang) ||
        (lang === 'es' ? 'Moneda no válida. Los valores permitidos son Pesos, Dollar y Euros' : 'Invalid currency. Allowed values are Pesos, Dollar, and Euros')
      );
      error.statusCode = 400;
      return next(error);
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      const error = new Error(
        getLocalizedMessage('userNotFound', lang) ||
        (lang === 'es' ? 'Usuario no encontrado' : 'User not found')
      );
      error.statusCode = 404;
      return next(error);
    }

    user.preferredCurrency = currency;
    await user.save();

    const userLang = resolveLanguage(req, user);

    res.status(200).json({
      success: true,
      message:
        getLocalizedMessage('currencyUpdated', userLang) ||
        (userLang === 'es' ? 'Moneda actualizada exitosamente' : 'Currency updated successfully'),
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        preferredCurrency: user.preferredCurrency,
      },
    });
  } catch (err) {
    console.error(`Change currency error: ${err.message}`);
    next(err);
  }
};

const getAllAgents = async (req, res, next) => {
  try {
    const lang = resolveLanguage(req);
    const agents = await User.find({ role: 'agent', isActive: { $ne: false }, status: { $in: ['approved', undefined] } }).select('-password -recentlyViewed -role -updatedAt -createdAt');
    res.json({
      success: true,
      message: getLocalizedMessage('agentsRetrieved', lang),
      data: agents
    });
  } catch (err) {
    console.error(`Get all agents error: ${err.message}`);
    next(err);
  }
};

const logoutUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (user) {
      user.refreshToken = null;
      await user.save();
    }
    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
      data: null,
    });
  } catch (err) {
    console.error(`Logout error: ${err.message}`);
    next(err);
  }
};

const refreshAccessToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      const error = new Error('Refresh token is required');
      error.statusCode = 400;
      return next(error);
    }

    // 1. Verify Refresh 
    let decoded;
    try {
      decoded = jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
      );
    } catch (err) {
      const error = new Error('Invalid or expired refresh token');
      error.statusCode = 401;
      return next(error);
    }

    // 2. Find user by ID and check if refresh token matches the one in DB 
    const user = await User.findById(decoded.id);
    if (!user || user.refreshToken !== refreshToken) {
      const error = new Error('Invalid refresh token or session has expired. Please login again.');
      error.statusCode = 401;
      return next(error);
    }

    // 3. Check if user is active
    if (user.isActive === false) {
      const error = new Error('Account deactivated. Please contact the administrator.');
      error.statusCode = 403;
      return next(error);
    }

    // 4. Generate new Access Token and new Refresh Token (Token Rotation)
    const newAccessToken = generateAccessToken(user._id);
    const newRefreshToken = generateRefreshToken(user._id);

    // Save rotated refresh token in DB
    user.refreshToken = newRefreshToken;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Access token refreshed successfully',
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        // token: newAccessToken, // Alias for backward  compatibility
      }
    });

  } catch (err) {
    console.error(`Refresh token error: ${err.message}`);
    next(err);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    const { email, language } = req.body;

    if (!email) {
      const lang = resolveLanguage(req);

      const error = new Error(
        getLocalizedMessage('emailRequired', lang)
      );

      error.statusCode = 400;
      return next(error);
    }

    const cleanEmail = email.toLowerCase().trim();

    // User ko email se find karo
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      // User nahi mila, isliye body/header/query se language resolve hogi 
      const lang = resolveLanguage(req);

      const error = new Error(
        getLocalizedMessage('noAccountWithEmail', lang)
      );

      error.statusCode = 404;
      return next(error);
    }

    /*
      Agar body me language aaye:
      - language profile me save hogi
      - wahi response/message me use hogi
 
      Agar body me language na aaye:
      - user.preferredLanguage ki DB wali value use hogi
    */
    if (typeof language === 'string' && language.trim() !== '') {
      const normalizedLanguage = language.toLowerCase().trim();

      if (['english', 'en'].includes(normalizedLanguage)) {
        user.preferredLanguage = 'english';
      } else if (['spanish', 'es'].includes(normalizedLanguage)) {
        user.preferredLanguage = 'spanish';
      }
    }

    /*
      resolveLanguage hamesha 'en' ya 'es' return karega.
      Body me language na hone par user ki DB preference use hogi.
    */
    const finalLang = resolveLanguage(req, user);

    if (user.isActive === false) {
      const error = new Error(
        getLocalizedMessage('accountDeactivated', finalLang)
      );

      error.statusCode = 403;
      return next(error);
    }

    // 6-digit OTP generate karo
    const otp = Math.floor(
      100000 + Math.random() * 900000
    ).toString();

    const otpExpires = new Date(
      Date.now() + 10 * 60 * 1000
    );

    user.resetPasswordOTP = otp;
    user.resetPasswordOTPExpires = otpExpires;
    user.isResetOTPVerified = false;
    user.resetPasswordToken = null;

    // Language agar body se update hui hai to save hogi
    await user.save();

    const emailResult = await sendEmail({
      to: cleanEmail,

      subject:
        finalLang === 'es'
          ? 'SpeddyProp - OTP de restablecimiento de contraseña'
          : 'SpeddyProp - Password Reset OTP',

      otp
    });

    res.status(200).json({
      success: true,

      message: getLocalizedMessage(
        'otpSentSuccess',
        finalLang
      ),

      data: {
        email: cleanEmail,

        expiresIn:
          finalLang === 'es'
            ? '10 minutos'
            : '10 minutes',
      }
    });
  } catch (err) {
    console.error(`Forgot password error: ${err.message}`);
    next(err);
  }
};

const verifyResetOTP = async (req, res, next) => {
  try {
    const { email, otp, language } = req.body;

    // Body se language optional hai
    if (!email || !otp) {
      const lang = resolveLanguage(req);

      const error = new Error(
        getLocalizedMessage('emailAndOtpRequired', lang)
      );

      error.statusCode = 400;
      return next(error);
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanOtp = String(otp).trim();

    // Email se user find karo
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      const lang = resolveLanguage(req);

      const error = new Error(
        getLocalizedMessage('noAccountWithEmail', lang)
      );

      error.statusCode = 404;
      return next(error);
    }

    // Body me language aaye to profile me update karo 
    if (typeof language === 'string' && language.trim() !== '') {
      const normalizedLanguage = language.toLowerCase().trim();

      if (['english', 'en'].includes(normalizedLanguage)) {
        user.preferredLanguage = 'english';
      } else if (
        ['spanish', 'es'].includes(normalizedLanguage)
      ) {
        user.preferredLanguage = 'spanish';
      }
    }

    // Body me language na ho to DB wali language use hogi 
    const finalLang = resolveLanguage(req, user);

    if (
      !user.resetPasswordOTP ||
      !user.resetPasswordOTPExpires
    ) {
      const error = new Error(
        getLocalizedMessage('noOtpRequestFound', finalLang)
      );

      error.statusCode = 400;
      return next(error);
    }

    if (new Date() > user.resetPasswordOTPExpires) {
      const error = new Error(
        getLocalizedMessage('otpExpiredMsg', finalLang)
      );

      error.statusCode = 400;
      return next(error);
    }

    // Production me saved OTP compare karo
    if (user.resetPasswordOTP !== cleanOtp) {
      const error = new Error(
        getLocalizedMessage('invalidOtpMsg', finalLang)
      );

      error.statusCode = 400;
      return next(error);
    }

    // Secure reset token generate karo
    const resetToken = jwt.sign(
      {
        id: user._id,
        email: user.email,
        purpose: 'password_reset'
      },
      getJwtSecret(),
      {
        expiresIn: '15m'
      }
    );

    user.isResetOTPVerified = true;
    user.resetPasswordToken = resetToken;

    // Body language aayi ho to save hogi nhi to nhi hogi
    await user.save();

    res.status(200).json({
      success: true,

      message: getLocalizedMessage(
        'otpVerifiedSuccess',
        finalLang
      ),

      data: {
        email: user.email,
        resetToken,

        preferredLanguage:
          user.preferredLanguage ||
          (finalLang === 'es' ? 'spanish' : 'english')
      }
    });
  } catch (err) {
    console.error(`Verify OTP error: ${err.message}`);
    next(err);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const {
      email,
      newPassword,
      confirmPassword,
      resetToken,
      language
    } = req.body;

    const cleanEmail = email
      ? email.toLowerCase().trim()
      : null;

    if (!newPassword || !confirmPassword) {
      // Agar user email nahi bhejta, header/query/body se language resolve hogi 
      const lang = resolveLanguage(req);

      const error = new Error(
        getLocalizedMessage('newAndConfirmRequired', lang)
      );

      error.statusCode = 400;
      return next(error);
    }

    if (newPassword !== confirmPassword) {
      const lang = resolveLanguage(req);

      const error = new Error(
        getLocalizedMessage('passwordsDoNotMatch', lang)
      );

      error.statusCode = 400;
      return next(error);
    }

    if (newPassword.length < 6) {
      const lang = resolveLanguage(req);

      const error = new Error(
        getLocalizedMessage('passwordMin', lang)
      );

      error.statusCode = 400;
      return next(error);
    }

    // Token body ya Authorization header se lo 
    const incomingToken =
      resetToken ||
      (req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : null);

    let user = null;

    // Token verify karo
    if (incomingToken) {
      try {
        const decoded = jwt.verify(
          incomingToken,
          getJwtSecret()
        );

        if (
          decoded &&
          decoded.id &&
          decoded.purpose === 'password_reset'
        ) {
          user = await User.findById(decoded.id);
        }
      } catch (tokenErr) {
        console.warn(
          `Reset token verification warning: ${tokenErr.message}`
        );
      }
    }

    // Token se user na mile to email se find karo
    if (!user && cleanEmail) {
      user = await User.findOne({ email: cleanEmail });
    }

    if (!user) {
      const lang = resolveLanguage(req);

      const error = new Error(
        getLocalizedMessage('userNotFoundReset', lang)
      );

      error.statusCode = 404;
      return next(error);
    }

    // Body me language aaye to update karo
    if (typeof language === 'string' && language.trim() !== '') {
      const normalizedLanguage = language.toLowerCase().trim();

      if (['english', 'en'].includes(normalizedLanguage)) {
        user.preferredLanguage = 'english';
      } else if (
        ['spanish', 'es'].includes(normalizedLanguage)
      ) {
        user.preferredLanguage = 'spanish';
      }
    }

    // Body language nahi hai to DB language use hogi 
    const finalLang = resolveLanguage(req, user);

    if (!user.isResetOTPVerified) {
      const error = new Error(
        getLocalizedMessage('otpVerificationRequired', finalLang)
      );

      error.statusCode = 400;
      return next(error);
    }

    if (
      user.resetPasswordOTPExpires &&
      new Date() > user.resetPasswordOTPExpires
    ) {
      const error = new Error(
        getLocalizedMessage(
          'passwordResetSessionExpired',
          finalLang
        )
      );

      error.statusCode = 400;
      return next(error);
    }

    // New password hash karo jab hmm 
    const salt = await bcrypt.genSalt(10);

    user.password = await bcrypt.hash(
      newPassword,
      salt
    );

    // Reset fields clear karo
    user.resetPasswordOTP = null;
    user.resetPasswordOTPExpires = null;
    user.isResetOTPVerified = false;
    user.resetPasswordToken = null;

    // Active sessions invalidate karo
    user.refreshToken = null;

    // Body language update hui ho to save hogi
    await user.save();

    res.status(200).json({
      success: true,

      message: getLocalizedMessage(
        'passwordResetSuccess',
        finalLang
      ),

      data: {
        email: user.email,

        preferredLanguage:
          user.preferredLanguage ||
          (finalLang === 'es' ? 'spanish' : 'english')
      }
    });
  } catch (err) {
    console.error(`Reset password error: ${err.message}`);
    next(err);
  }
};

// Helper to render responsive HTML for email verification
const renderVerificationResultHtml = ({ success, title, message, lang = 'en' }) => {
  const isEs = lang === 'es';

  return `<!DOCTYPE html>
<html lang="${isEs ? 'es' : 'en'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - KleverProp</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: linear-gradient(135deg, #f0f4f8 0%, #d9e2ec 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #ffffff;
      max-width: 520px;
      width: 100%;
      border-radius: 16px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      padding: 44px 32px;
      text-align: center;
    }
    .brand {
      font-size: 24px;
      font-weight: 800;
      color: #2563eb;
      margin-bottom: 24px;
      letter-spacing: -0.5px;
    }
    .icon-container {
      width: 76px;
      height: 76px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      background-color: ${success ? '#dcfce7' : '#fee2e2'};
      color: ${success ? '#16a34a' : '#dc2626'};
      font-size: 40px;
      font-weight: bold;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 12px;
    }
    p {
      font-size: 15px;
      color: #475569;
      line-height: 1.6;
      margin-bottom: 20px;
    }
    .footer-note {
      margin-top: 24px;
      font-size: 12px;
      color: #94a3b8;
      border-top: 1px solid #f1f5f9;
      padding-top: 16px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">KleverProp</div>
    <div class="icon-container">
      ${success ? '&#10003;' : '&#10005;'}
    </div>
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="footer-note">
      &copy; ${new Date().getFullYear()} KleverProp Real Estate.
    </div>
  </div>
</body>
</html>`;
};

const verifyEmail = async (req, res, next) => {
  try {
    const rawToken = req.query.token || req.params?.token || req.body?.token;
    const lang = resolveLanguage(req);

    const wantsJson =
      req.query.format === 'json' ||
      (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers.accept.includes('text/html'));

    if (!rawToken || typeof rawToken !== 'string') {
      const errorMsg = getLocalizedMessage('invalidOrExpiredVerificationToken', lang);
      if (wantsJson) {
        return res.status(400).json({ success: false, message: errorMsg });
      }
      return res.status(400).send(renderVerificationResultHtml({
        success: false,
        title: lang === 'es' ? 'Enlace Inválido' : 'Invalid Verification Link',
        message: errorMsg,
        lang,
      }));
    }

    const hashedToken = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');

    const user = await User.findOne({
      verificationToken: hashedToken,
      verificationTokenExpires: { $gt: Date.now() },
    });

    if (!user) {
      const errorMsg = getLocalizedMessage('invalidOrExpiredVerificationToken', lang);
      if (wantsJson) {
        return res.status(400).json({ success: false, message: errorMsg });
      }
      return res.status(400).send(renderVerificationResultHtml({
        success: false,
        title: lang === 'es' ? 'Enlace Inválido o Expirado' : 'Link Invalid or Expired',
        message: errorMsg,
        lang,
      }));
    }

    // Update email verification status
    user.isEmailVerified = true;
    user.verificationToken = null;
    user.verificationTokenExpires = null;

    // Agent ka status strictly 'pending' hi rahega jab tak admin dashboard se approve na kare
    if (user.role === 'agent') {
      user.status = 'pending';
    } else {
      user.status = 'approved';
    }
    await user.save();

    const userLang = resolveLanguage(req, user);
    const isAgent = user.role === 'agent';
    const successMsg = isAgent
      ? getLocalizedMessage('emailVerifiedPendingApproval', userLang)
      : getLocalizedMessage('emailVerificationSuccess', userLang);

    if (wantsJson) {
      return res.status(200).json({
        success: true,
        message: successMsg,
        data: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          isEmailVerified: user.isEmailVerified,
        },
      });
    }

    const htmlTitle = isAgent
      ? (userLang === 'es' ? '¡Correo Verificado - KYC en Revisión!' : 'Email Verified - KYC Under Review!')
      : (userLang === 'es' ? '¡Cuenta Aprobada y Verificada!' : 'Account Approved & Verified!');

    const htmlMessage = isAgent
      ? (userLang === 'es'
        ? `Hola <strong>${user.name}</strong>, tu correo electrónico (<strong>${user.email}</strong>) ha sido verificado con éxito. Tus documentos de KYC están siendo revisados por nuestro equipo de administración. Ya puedes iniciar sesión para explorar la plataforma.`
        : `Hello <strong>${user.name}</strong>, your email (<strong>${user.email}</strong>) has been successfully verified. Your KYC documents are currently under review by our admin team. You can now log in to explore the platform.`)
      : (userLang === 'es'
        ? `Hola <strong>${user.name}</strong>, tu correo electrónico (<strong>${user.email}</strong>) ha sido verificado con éxito y tu cuenta ha sido actualizada al estado <strong>Aprobado</strong>. Ya puedes iniciar sesión.`
        : `Hello <strong>${user.name}</strong>, your email (<strong>${user.email}</strong>) has been successfully verified and your account status is now <strong>Approved</strong>. You can now log in.`);

    return res.status(200).send(renderVerificationResultHtml({
      success: true,
      title: htmlTitle,
      message: htmlMessage,
      lang: userLang,
    }));
  } catch (err) {
    console.error(`Verify email error: ${err.message}`);
    next(err);
  }
};

const resendVerificationEmail = async (req, res, next) => {
  try {
    const { email } = req.body;
    const cleanEmail = (email || '').toLowerCase().trim();
    const lang = resolveLanguage(req);

    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      const error = new Error(getLocalizedMessage('userNotFound', lang));
      error.statusCode = 404;
      return next(error);
    }

    if (user.isEmailVerified) {
      return res.status(200).json({
        success: true,
        message: getLocalizedMessage('emailAlreadyVerified', lang),
      });
    }

    const rawVerificationToken = crypto.randomBytes(32).toString('hex');
    const hashedVerificationToken = crypto.createHash('sha256').update(rawVerificationToken).digest('hex');
    const verificationTokenExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes validity

    user.verificationToken = hashedVerificationToken;
    user.verificationTokenExpires = verificationTokenExpires;
    await user.save();

    const baseUrl = (process.env.BASE_URL || 'https://mobappssolutiondevelopment.com/kleverProp').replace(/\/+$/, '');
    const verificationUrl = `${baseUrl}/api/users/verify-email?token=${rawVerificationToken}`;

    const isSpanish = (user.preferredLanguage || '').toLowerCase() === 'spanish' || lang === 'es';
    const emailSubject = isSpanish
      ? 'Verifique y active su cuenta de asesor - KleverProp'
      : 'Verify and Activate Your Agent Account - KleverProp';

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #2563eb; margin: 0; font-size: 26px; font-weight: bold;">KleverProp</h1>
          <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Real Estate Platform</p>
        </div>
        <div style="border-top: 1px solid #f1f5f9; padding-top: 20px;">
          <h2 style="color: #1e293b; font-size: 20px; margin-bottom: 12px;">
            ${isSpanish ? `¡Hola, ${user.name}!` : `Hello, ${user.name}!`}
          </h2>
          <p style="font-size: 15px; color: #475569; line-height: 1.6;">
            ${isSpanish
        ? 'Has solicitado reenviar el enlace de verificación para tu cuenta de asesor. Para verificar tu correo electrónico antes de la revisión y aprobación de tus documentos de KYC por el administrador, haz clic en el siguiente botón:'
        : 'You requested a new verification link for your agent account. To verify your email address before our admin reviews and approves your KYC documents, please click the button below:'}
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${verificationUrl}" target="_blank" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 32px; font-size: 16px; font-weight: bold; border-radius: 6px;">
              ${isSpanish ? 'Verificar Correo Electrónico' : 'Verify Email Address'}
            </a>
          </div>
          <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
            <a href="${verificationUrl}" style="color: #2563eb; word-break: break-all;">${verificationUrl}</a>
          </p>
          <p style="font-size: 13px; color: #dc2626; margin-top: 20px; font-weight: bold;">
            ${isSpanish ? '⚠️ Este enlace de verificación es válido por 5 minutos.' : '⚠️ This verification link is valid for 5 minutes.'}
          </p>
        </div>
      </div>
    `;

    await sendEmail({
      to: user.email,
      subject: emailSubject,
      html: emailHtml,
      text: isSpanish
        ? `Hola ${user.name}, verifique su cuenta haciendo clic en: ${verificationUrl} (válido por 5 minutos)`
        : `Hello ${user.name}, please verify your account by clicking: ${verificationUrl} (valid for 5 minutes)`,
    });

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('verificationEmailSent', lang),
    });
  } catch (err) {
    console.error(`Resend verification error: ${err.message}`);
    next(err);
  }
};

const getActiveAgencies = async (req, res, next) => {
  try {
    const lang = resolveLanguage(req);
    const { search } = req.query;

    const query = { isActive: { $ne: false } };

    if (search) {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { name: searchRegex },
        { description: searchRegex },
      ];
    }

    const agencies = await Agency.find(query).sort({ name: 1 });

    return res.status(200).json({
      success: true,
      message: getLocalizedMessage('activeAgenciesRetrieved', lang) || 'Active agencies retrieved successfully',
      count: agencies.length,
      data: agencies,
    });
  } catch (err) {
    console.error(`Get active agencies error: ${err.message}`);
    next(err);
  }
};

const upgradeAgentPlan = async (req, res, next) => {
  try {
    const lang = resolveLanguage(req, req.user);

    if (!req.user) {
      const error = new Error(lang === 'es' ? 'No autorizado' : 'Unauthorized');
      error.statusCode = 401;
      return next(error);
    }

    const userId = req.user._id;

    // 1. Verify user is an agent
    const agent = await User.findById(userId).populate('agency').populate('tier');
    if (!agent || agent.role !== 'agent') {
      const error = new Error(
        lang === 'es'
          ? 'Solo los asesores pueden actualizar su plan de nivel'
          : 'Only registered agents can upgrade their tier plan'
      );
      error.statusCode = 403;
      return next(error);
    }

    // 2. Strict Eligibility Check:
    // Must be Independent (!agent.agency) OR outside agency quota (!agent.isCoveredByAgency)
    // if (agent.agency && agent.isCoveredByAgency === true) {
    //   const agencyDoc = agent.agency;
    //   const error = new Error(
    //     lang === 'es'
    //       ? `Tu cuenta ya está cubierta bajo el plan institucional de ${agencyDoc.name}. No necesitas actualizar individualmente.`
    //       : `Your account is already covered under the institutional plan of ${agencyDoc.name}. You cannot upgrade independently.`
    //   );
    //   error.statusCode = 400;
    //   return next(error);
    // }

    // 3. Resolve Target Tier
    const { tierId, tierLevel, billingCycle = 'monthly', paymentMethod = 'CARD' } = req.body;
    let targetTier = null;

    if (tierId && mongoose.Types.ObjectId.isValid(tierId)) {
      targetTier = await Tier.findById(tierId);
    } else if (tierLevel) {
      targetTier = await Tier.findOne({ tierLevel: Number(tierLevel) });
    } else {
      // Default upgrade target is Tier 2 (Pro Agent)
      targetTier = await Tier.findOne({ tierLevel: 2 });
    }

    if (!targetTier) {
      const error = new Error(
        lang === 'es' ? 'El plan de nivel seleccionado no existe' : 'Selected tier plan not found'
      );
      error.statusCode = 404;
      return next(error);
    }

    // Tier 1 (Basic) is allowed for downgrade / plan update
    // if (targetTier.tierLevel === 1) {
    //   const error = new Error(
    //     lang === 'es'
    //       ? 'Solo puedes actualizar a Tier 2 (Pro) o Tier 3 (Sponsor)'
    //       : 'Upgrade is only allowed to Tier 2 (Pro) or Tier 3 (Sponsor)'
    //   );
    //   error.statusCode = 400;
    //   return next(error);
    // Prevent duplicate upgrade to same tier
    if (agent.tier && agent.tier._id.toString() === targetTier._id.toString()) {
      const error = new Error(
        lang === 'es'
          ? `Ya cuentas con el plan ${targetTier.name} activo`
          : `You already have the ${targetTier.name} plan active`
      );
      error.statusCode = 400;
      return next(error);
    }

    // 4. Update Agent Tier and set independent/self-paid status
    agent.tier = targetTier._id;
    agent.isCoveredByAgency = false; // Self-managed subscription
    await agent.save();

    // 5. In-App Notification
    try {
      await Notification.create({
        recipient: agent._id,
        sender: agent._id,
        title: {
          en: `🎉 Plan Upgraded to ${targetTier.name}`,
          es: `🎉 Plan actualizado a ${targetTier.name}`,
        },
        message: {
          en: `Your profile has been upgraded to ${targetTier.name}. You now have full access to verified badges and direct native leads!`,
          es: `Tu perfil ha sido actualizado a ${targetTier.name}. ¡Ahora tienes acceso a insignias verificadas y clientes potenciales directos!`,
        },
        type: 'PLAN_UPGRADE',
        data: {
          tierId: targetTier._id,
          tierLevel: targetTier.tierLevel,
          tierName: targetTier.name,
        },
      });
    } catch (notifErr) {
      console.warn(`Could not create upgrade notification: ${notifErr.message}`);
    }

    const priceAmount = billingCycle.toLowerCase() === 'yearly'
      ? (targetTier.pricing?.yearlyPrice || 0)
      : (targetTier.pricing?.monthlyPrice || 0);

    return res.status(200).json({
      success: true,
      message: lang === 'es'
        ? `¡Plan actualizado con éxito a ${targetTier.name}!`
        : `Plan successfully upgraded to ${targetTier.name}!`,
      data: {
        agentId: agent._id,
        name: agent.name,
        email: agent.email,
        isIndependent: !agent.agency,
        isCoveredByAgency: false,
        agency: agent.agency
          ? {
            _id: agent.agency._id,
            name: agent.agency.name,
            agentSeatsLimit: agent.agency.agentSeatsLimit,
            coveredAgentsCount: agent.agency.coveredAgentsCount,
          }
          : null,
        tier: {
          _id: targetTier._id,
          tierLevel: targetTier.tierLevel,
          name: targetTier.name,
          pricing: {
            amount: priceAmount,
            currency: targetTier.pricing?.currency || 'USD',
            billingCycle: billingCycle.toLowerCase(),
          },
          uiAppearance: targetTier.uiAppearance,
        },
      },
    });
  } catch (err) {
    console.error(`Upgrade Agent Plan Error: ${err.message}`);
    next(err);
  }
};

const getAgentUpgradeEligibility = async (req, res, next) => {
  try {
    const lang = resolveLanguage(req, req.user);
    const userId = req.user._id;

    const agent = await User.findById(userId).populate('agency').populate('tier');
    if (!agent || agent.role !== 'agent') {
      const error = new Error(lang === 'es' ? 'Solo asesores' : 'Only agents can check plan eligibility');
      error.statusCode = 403;
      return next(error);
    }

    const isIndependent = !agent.agency;
    const isCoveredByAgency = Boolean(agent.agency && agent.isCoveredByAgency === true);
    const canUpgrade = isIndependent || !isCoveredByAgency;

    const availableTiers = await Tier.find({ tierLevel: { $in: [2, 3] } }).sort({ tierLevel: 1 });

    let reason = '';
    if (isIndependent) {
      reason = lang === 'es'
        ? 'Asesor independiente elegible para actualizar plan de suscripción'
        : 'Independent agent eligible for plan subscription upgrade';
    } else if (!isCoveredByAgency) {
      reason = lang === 'es'
        ? 'Límite de la agencia superado o membresía no cubierta; elegible para plan individual'
        : 'Agency seats limit reached or not covered; eligible for individual plan subscription';
    } else {
      reason = lang === 'es'
        ? `Actualmente cubierto bajo el plan institucional de ${agent.agency.name}`
        : `Currently covered under institutional plan of ${agent.agency.name}`;
    }
    return res.status(200).json({
      success: true,
      data: {
        agentId: agent._id,
        currentTier: agent.tier || null,
        isIndependent,
        isCoveredByAgency,
        canUpgrade,
        reason,
        availableTiers,
      },
    });
  } catch (err) {
    console.error(`Get Upgrade Eligibility Error: ${err.message}`);
    next(err);
  }
};

const getAllTiers = async (req, res, next) => {
  try {
    const lang = resolveLanguage(req);
    const tiers = await Tier.find({}).sort({ tierLevel: 1 });

    return res.status(200).json({
      success: true,
      message: lang === 'es' ? 'Planes de nivel obtenidos con éxito' : 'Tiers retrieved successfully',
      count: tiers.length,
      data: tiers,
    });
  } catch (err) {
    console.error(`Get all tiers error: ${err.message}`);
    next(err);
  }
};

module.exports = {
  registerUser,
  registerAgent,
  loginUser,
  logoutUser,
  getUserProfile,
  updateUserProfile,
  changePassword,
  changeLanguage,
  changeCurrency,
  getAllAgents,
  refreshAccessToken,
  forgotPassword,
  verifyResetOTP,
  resetPassword,
  verifyEmail,
  resendVerificationEmail,
  resubmitKYC,
  getActiveAgencies,
  getAgencies: getActiveAgencies,
  upgradeAgentPlan,
  getAgentUpgradeEligibility,
  getAllTiers,
};