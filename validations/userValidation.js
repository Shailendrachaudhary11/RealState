const Joi = require('joi');

const strongPasswordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,}$/;

// Joi schema for validating user registration input
const registerSchema = Joi.object({
  name: Joi.string().min(2).max(50).required().messages({
    'string.empty': 'Name cannot be empty',
    'string.min': 'Name should be at least 2 characters long',
    'any.required': 'Name is required',
  }),
  email: Joi.string().email().required().messages({
    'string.empty': 'Email cannot be empty',
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required',
  }),
  password: Joi.string()
    .min(6)
    .pattern(strongPasswordPattern)
    .required()
    .messages({
      'string.empty': 'Password cannot be empty',
      'string.min': 'Password must be at least 6 characters long',
      'string.pattern.base': 'Password must contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character',
      'any.required': 'Password is required',
    }),
  phone: Joi.string().required().messages({
    'string.empty': 'Phone number cannot be empty',
    'any.required': 'Phone number is required',
  }),
  role: Joi.string().valid('buyer', 'agent', 'admin').default('buyer'),
  language: Joi.string().valid('english', 'spanish', 'en', 'es').insensitive().default('english'),
  preferredLanguage: Joi.string().valid('english', 'spanish', 'en', 'es').insensitive(),
  rawLang: Joi.string().valid('english', 'spanish', 'en', 'es').insensitive(),
  lang: Joi.string().valid('english', 'spanish', 'en', 'es').insensitive(),
  profileImage: Joi.string().allow(null, '').default(null),
});

// Joi schema for validating user login input
const loginSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.empty': 'Email cannot be empty',
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required',
  }),
  password: Joi.string().required().messages({
    'string.empty': 'Password cannot be empty',
    'any.required': 'Password is required',
  }),
  preferredLanguage: Joi.string().allow('', null).optional(),
  language: Joi.string().allow('', null).optional(),
  lang: Joi.string().allow('', null).optional(),
});

// Joi schema for validating user profile update input
const updateProfileSchema = Joi.object({
  name: Joi.string().min(2).max(50).messages({
    'string.min': 'Name should be at least 2 characters long',
  }),
  phone: Joi.string().allow(''),
  email: Joi.string().email().messages({
    'string.email': 'Please provide a valid email address',
  }),
  role: Joi.string().valid('buyer', 'agent', 'admin'),
  preferredLanguage: Joi.string().valid('english', 'spanish').insensitive(),
  profileImage: Joi.string().allow(null, ''),
  licenseNumber: Joi.string().trim().allow('', null).optional(),
  liceneseNumber: Joi.string().trim().allow('', null).optional(),
  document: Joi.string().trim().allow('', null).optional(),
  agency: Joi.string().trim().regex(/^[0-9a-fA-F]{24}$/).allow('', null).optional(),
  agencyId: Joi.string().trim().regex(/^[0-9a-fA-F]{24}$/).allow('', null).optional(),
});

// Joi schema for validating change language input
const changeLanguageSchema = Joi.object({
  preferredLanguage: Joi.string()
    .valid('english', 'spanish')
    .insensitive(),
  language: Joi.string()
    .valid('english', 'spanish')
    .insensitive(),
}).or('preferredLanguage', 'language').messages({
  'object.missing': 'Preferred language is required (preferredLanguage or language)',
  'any.only': 'Language must be either english or spanish',
});

// Joi schema for validating agent registration input
const registerAgentSchema = Joi.object({
  name: Joi.string().min(2).max(50).required().messages({
    'string.empty': 'Name cannot be empty',
    'string.min': 'Name should be at least 2 characters long',
    'any.required': 'Name is required',
  }),
  email: Joi.string().email().required().messages({
    'string.empty': 'Email cannot be empty',
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required',
  }),
  phone: Joi.string().required().messages({
    'string.empty': 'Phone number cannot be empty',
    'any.required': 'Phone number is required',
  }),
  agency: Joi.string()
    .trim()
    .regex(/^[0-9a-fA-F]{24}$/)
    .allow('', null)
    .optional()
    .messages({
      'string.pattern.base': 'Invalid Agency ID format',
    }),
  agencyId: Joi.string().trim().regex(/^[0-9a-fA-F]{24}$/).allow('', null).optional(),
  agency_id: Joi.string().trim().regex(/^[0-9a-fA-F]{24}$/).allow('', null).optional(),
  licenseNumber: Joi.string().trim().messages({
    'string.empty': 'License number cannot be empty',
    'any.required': 'License number is required',
  }),
  liceneseNumber: Joi.string().trim().messages({
    'string.empty': 'License number cannot be empty',
    'any.required': 'License number is required',
  }),
  document: Joi.string().trim().required().messages({
    'string.empty': 'Document cannot be empty',
    'any.required': 'Document is required',
  }),
  password: Joi.string()
    .min(6)
    .pattern(strongPasswordPattern)
    .required()
    .messages({
      'string.empty': 'Password cannot be empty',
      'string.min': 'Password must be at least 6 characters long',
      'string.pattern.base': 'Password must contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character',
      'any.required': 'Password is required',
    }),
  language: Joi.string().valid('english', 'spanish', 'en', 'es').insensitive().default('english'),
  preferredLanguage: Joi.string().valid('english', 'spanish', 'en', 'es').insensitive(),
  rawLang: Joi.string().valid('english', 'spanish', 'en', 'es').insensitive(),
  lang: Joi.string().valid('english', 'spanish', 'en', 'es').insensitive(),
  profileImage: Joi.string().allow(null, '').default(null),
  role: Joi.string().valid('agent').default('agent'),
}).or('licenseNumber', 'liceneseNumber').messages({
  'object.missing': 'License number is required',
});

// Joi schema for validating user update by admin
const adminUpdateUserSchema = Joi.object({
  name: Joi.string().min(2).max(50).messages({
    'string.min': 'Name should be at least 2 characters long',
  }),
  email: Joi.string().email().messages({
    'string.email': 'Please provide a valid email address',
  }),
  phone: Joi.string().allow(''),
  role: Joi.string().valid('buyer', 'agent', 'admin'),
  status: Joi.string().valid('pending', 'approved', 'rejected', 'suspended'),
  isActive: Joi.boolean(),
});

// Joi schema for validating agent status change by admin
const adminChangeAgentStatusSchema = Joi.object({
  status: Joi.string()
    .valid('pending', 'approved', 'rejected', 'suspended')
    .required()
    .messages({
      'any.only': 'Status must be one of: pending, approved, rejected, suspended',
      'any.required': 'Status is required',
      'string.empty': 'Status cannot be empty',
    }),
  reason: Joi.string().allow('', null).optional(),
});

// Joi schema for validating agent update by admin
const adminUpdateAgentSchema = Joi.object({
  name: Joi.string().min(2).max(50).messages({
    'string.min': 'Name should be at least 2 characters long',
  }),
  email: Joi.string().email().messages({
    'string.email': 'Please provide a valid email address',
  }),
  phone: Joi.string().allow(''),
  agency: Joi.string().trim().regex(/^[0-9a-fA-F]{24}$/).allow('', null).optional(),
  agencyId: Joi.string().trim().regex(/^[0-9a-fA-F]{24}$/).allow('', null).optional(),
  licenseNumber: Joi.string().trim().allow(''),
  liceneseNumber: Joi.string().trim().allow(''),
  document: Joi.string().trim().allow('', null),
  profileImage: Joi.string().allow(null, ''),
  status: Joi.string().valid('pending', 'approved', 'rejected', 'suspended'),
  isActive: Joi.boolean(),
});

// Joi schema for validating refresh token request
const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required().messages({
    'string.empty': 'Refresh token cannot be empty',
    'any.required': 'Refresh token is required',
  }),
});

// Joi schema for forgot password request (send OTP)
const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.empty': 'Email cannot be empty',
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required',
  }),
  preferredLanguage: Joi.string().allow('', null).optional(),
  language: Joi.string().allow('', null).optional(),
  lang: Joi.string().allow('', null).optional(),
});

// Joi schema for verifying OTP
const verifyOTPSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.empty': 'Email cannot be empty',
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required',
  }),
  otp: Joi.string().length(6).required().messages({
    'string.empty': 'OTP cannot be empty',
    'string.length': 'OTP must be exactly 6 digits',
    'any.required': 'OTP is required',
  }),
});

// Joi schema for resetting password
const resetPasswordSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.empty': 'Email cannot be empty',
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required',
  }),
  newPassword: Joi.string()
    .min(6)
    .pattern(strongPasswordPattern)
    .required()
    .messages({
      'string.empty': 'New password cannot be empty',
      'string.min': 'New password must be at least 6 characters long',
      'string.pattern.base': 'New password must contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character',
      'any.required': 'New password is required',
    }),
  confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required().messages({
    'any.only': 'Confirm password must match new password',
    'string.empty': 'Confirm password cannot be empty',
    'any.required': 'Confirm password is required',
  }),
  resetToken: Joi.string().optional().allow('', null),
});

// Joi schema for changing password
const changePasswordSchema = Joi.object({
  oldPassword: Joi.string().optional().allow('', null),
  old_password: Joi.string().optional().allow('', null),
  newPassword: Joi.string()
    .min(6)
    .pattern(strongPasswordPattern)
    .required()
    .messages({
      'string.empty': 'New password cannot be empty',
      'string.min': 'New password must be at least 6 characters long',
      'string.pattern.base': 'New password must contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character',
      'any.required': 'New password is required',
    }),
  confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required().messages({
    'any.only': 'Confirm password must match new password',
    'string.empty': 'Confirm password cannot be empty',
    'any.required': 'Confirm password is required',
  }),
}).or('oldPassword', 'old_password').messages({
  'object.missing': 'Old password is required',
}).unknown(true);

const resendVerificationSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.empty': 'Email cannot be empty',
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required',
  }),
});

const createAgencySchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .required()
    .messages({
      "string.empty": "Agency name is required",
      "string.min": "Agency name must be at least 2 characters",
      "any.required": "Agency name is required",
    }),

  description: Joi.string()
    .trim()
    .max(500)
    .allow("", null)
    .optional(),

  isActive: Joi.boolean()
    .optional(),

  isVerified: Joi.boolean()
    .optional(),
});

const updateAgencySchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .messages({
      "string.empty": "Agency name cannot be empty",
      "string.min": "Agency name must be at least 2 characters",
    }),

  description: Joi.string()
    .trim()
    .max(500)
    .allow("", null)
    .optional(),

  isActive: Joi.boolean()
    .optional(),

  isVerified: Joi.boolean()
    .optional(),

  website: Joi.string()
    .allow("", null)
    .optional(),

  tier: Joi.string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .allow("", null)
    .optional()
    .messages({
      "string.pattern.base": "Invalid Tier ID format",
    }),

  agentSeatsLimit: Joi.number()
    .integer()
    .min(0)
    .optional(),

  coveredAgentsCount: Joi.number()
    .integer()
    .min(0)
    .optional(),
});

const updateGeneralSettingSchema = Joi.object({
  appName: Joi.string().trim().max(100).optional().messages({
    'string.max': 'App name cannot exceed 100 characters',
  }),
  defaultCurrency: Joi.string().valid('USD', 'DOP').optional().messages({
    'any.only': 'Default currency must be either USD or DOP',
  }),
  supportEmail: Joi.string().email().trim().lowercase().optional().messages({
    'string.email': 'Please provide a valid support email address',
  }),
  supportNumber: Joi.string().trim().optional(),
});

const upgradeAgentTierSchema = Joi.object({
  tierId: Joi.string().hex().length(24).optional().messages({
    'string.hex': 'tierId must be a valid MongoDB ObjectId hex string',
    'string.length': 'tierId must be 24 characters long',
  }),
  tierLevel: Joi.number().integer().valid(2, 3).optional().messages({
    'any.only': 'tierLevel must be either 2 (Pro) or 3 (Founding Sponsor)',
  }),
  billingCycle: Joi.string().valid('monthly', 'yearly', 'MONTHLY', 'YEARLY').default('monthly'),
  paymentMethod: Joi.string().trim().optional(),
}).or('tierId', 'tierLevel');

module.exports = {
  registerSchema,
  registerAgentSchema,
  loginSchema,
  updateProfileSchema,
  changeLanguageSchema,
  adminUpdateUserSchema,
  adminChangeAgentStatusSchema,
  adminUpdateAgentSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  verifyOTPSchema,
  resetPasswordSchema,
  changePasswordSchema,
  resendVerificationSchema,
  createAgencySchema,
  updateAgencySchema,
  updateGeneralSettingSchema,
  upgradeAgentTierSchema,
};