const express = require('express');
const router = express.Router();
const { sendLead, getMyLeads, getLeadById, getAgentLeads, updateAgentLeadStatus, deleteLead } = require('../controllers/leadController');
const { registerUser, registerAgent, upgradeAgentPlan, loginUser, logoutUser, getUserProfile, updateUserProfile, resubmitKYC, changePassword, changeLanguage, changeCurrency, getAllAgents, refreshAccessToken, forgotPassword, verifyResetOTP, resetPassword, verifyEmail, resendVerificationEmail, getActiveAgencies, getAllTiers, } = require('../controllers/userController');
const validate = require('../middleware/validate');
const { registerSchema, registerAgentSchema, loginSchema, updateProfileSchema, changeLanguageSchema, refreshTokenSchema, forgotPasswordSchema, verifyOTPSchema, resetPasswordSchema, changePasswordSchema, resendVerificationSchema, } = require('../validations/userValidation');
const upload = require('../middleware/upload');
const { protect: authMiddleware, optionalAuth, requireApprovedAgent } = require('../middleware/auth');
const auditLog = require('../middleware/auditLog');
const { toggleFavorite, getFavorites } = require('../controllers/favoriteController');
const { sendLeadSchema, updateLeadStatusSchema } = require('../validations/leadValidation');
const savedSearchController = require('../controllers/savedSearchController') || {};
const addSavedSearch = typeof savedSearchController.addSavedSearch === 'function' ? savedSearchController.addSavedSearch : (req, res) => res.status(501).json({ success: false, message: 'Saved search feature not loaded' });
const getSavedSearches = typeof savedSearchController.getSavedSearches === 'function' ? savedSearchController.getSavedSearches : (req, res) => res.status(501).json({ success: false, message: 'Saved search feature not loaded' });
const deleteSavedSearch = typeof savedSearchController.deleteSavedSearch === 'function' ? savedSearchController.deleteSavedSearch : (req, res) => res.status(501).json({ success: false, message: 'Saved search feature not loaded' });
const savedSearchValidation = require('../validations/savedSearchValidation') || {};
const savedSearchSchema = savedSearchValidation.savedSearchSchema || null;
const
    {
        chatSearch,
        getRecentlyAISearch,
        deleteAISearchHistory,
        deleteAISearchHistoryById,
        getChatSessions,
        getChatSessionById,
        deleteChatSession,
        clearAllChatSessions
    } = require('../controllers/searchController');
const { getAllAmenities } = require('../controllers/amenityController');
const { generateMarketingContent } = require('../controllers/marketingController');
const { createAgentReview, getAgentReviews, getMyAgentReviews, claimAgentProfile } = require('../controllers/reviewController');
const { createReviewSchema } = require('../validations/reviewValidation');
// Notification Routes (User & Agent side, authenticated)
const { getMyNotifications, getNewNotifications, markNotificationAsRead, markAllNotificationsAsRead, deleteNotification, deleteAllNotifications } = require('../controllers/notificationController');

const { getLatestProperties, getProperties, getPropertyById, getRecentlyViewed, clearRecentlyViewed, deleteRecentlyViewedById, compareProperties, getFilterOptions } = require('../controllers/propertyController');
const redisCache = require('../middleware/redisCache');

// Helper to normalize agent upload files and aliases before Joi validation
const prepareAgentRegistration = (req, res, next) => {
    if (req.files) {
        if (req.files.document && req.files.document[0]) {
            req.body.document = req.body.document || `/uploads/${req.files.document[0].filename}`;
        }
        if (req.files.profileImage && req.files.profileImage[0]) {
            req.body.profileImage = req.body.profileImage || `/uploads/${req.files.profileImage[0].filename}`;
        }
    } else if (req.file) {
        if (req.file.fieldname === 'document') {
            req.body.document = req.body.document || `/uploads/${req.file.filename}`;
        } else if (req.file.fieldname === 'profileImage') {
            req.body.profileImage = req.body.profileImage || `/uploads/${req.file.filename}`;
        }
    }

    // Alias field mappings for flexibility 
    const incomingAgency = req.body.agency || req.body.agencyId || req.body.agency_id;
    if (incomingAgency && incomingAgency !== 'null' && incomingAgency !== 'undefined' && String(incomingAgency).trim() !== '') {
        req.body.agency = String(incomingAgency).trim();
        req.body.agencyId = String(incomingAgency).trim();
    } else {
        delete req.body.agency;
        delete req.body.agencyId;
        delete req.body.agency_id;
    }

    if (!req.body.licenseNumber && req.body.license_number) {
        req.body.licenseNumber = req.body.license_number;
    }
    if (!req.body.licenseNumber && req.body.liceneseNumber) {
        req.body.licenseNumber = req.body.liceneseNumber;
    }
    if (!req.body.liceneseNumber && req.body.licenseNumber) {
        req.body.liceneseNumber = req.body.licenseNumber;
    }

    // Language alias mapping
    const incomingLang = req.body.language || req.body.rawLang || req.body.lang || req.body.preferredLanguage;
    if (incomingLang) {
        req.body.language = incomingLang;
    }

    next();
};

const agentUpload = upload.fields([
    { name: 'document', maxCount: 1 },
    { name: 'profileImage', maxCount: 1 },
]);

// ================= AUTH & ACCOUNT ROUTES =================

/**
 * @openapi
 * /api/users/register-user:
 *   post:
 *     summary: Register a new buyer/user
 *     tags: [Auth & Account]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [name, email, password, phone]
 *             properties:
 *               name: { type: string, example: John Doe }
 *               email: { type: string, example: buyer@example.com }
 *               password: { type: string, example: Secure@123 }
 *               phone: { type: string, example: '+18095551234' }
 *               role: { type: string, default: buyer, example: buyer }
 *               language: { type: string, enum: [english, spanish, en, es], default: english }
 *               profileImage: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error
 */
router.post('/register-user', auditLog('User', 'create'), upload.single('profileImage'), validate(registerSchema), registerUser);

/**
 * @openapi
 * /api/users/register-agent:
 *   post:
 *     summary: Register a new real estate agent with KYC document
 *     tags: [Auth & Account]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [name, email, password, phone, licenseNumber, document]
 *             properties:
 *               name: { type: string, example: Carlos Rodriguez }
 *               email: { type: string, example: agent@kleverprop.com }
 *               password: { type: string, example: Secure@123 }
 *               phone: { type: string, example: '+18095559876' }
 *               licenseNumber: { type: string, example: LIC-RD-2024-9988 }
 *               agencyId: { type: string, example: 66e1b6a1e345b6f728901234 }
 *               language: { type: string, enum: [english, spanish, en, es], default: spanish }
 *               document: { type: string, format: binary, description: ID or Broker License document }
 *               profileImage: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Agent registered and queued for verification
 *       400:
 *         description: Validation error
 */
router.post('/register-agent', auditLog('User', 'create'), agentUpload, prepareAgentRegistration, validate(registerAgentSchema), registerAgent);

/**
 * @openapi
 * /api/users/upgrade-agent-plan:
 *   post:
 *     summary: Upgrade agent subscription tier
 *     tags: [Auth & Account]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tierId]
 *             properties:
 *               tierId: { type: string, example: 66e1b6a1e345b6f728904321 }
 *     responses:
 *       200:
 *         description: Subscription tier upgraded
 */
router.post('/upgrade-agent-plan', authMiddleware, auditLog('User', 'edit'), upgradeAgentPlan);

/**
 * @openapi
 * /api/users/verify-email:
 *   get:
 *     summary: Verify email address
 *     tags: [Auth & Account]
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Email verified successfully
 */
router.get('/verify-email', verifyEmail);

/**
 * @openapi
 * /api/users/resend-verification:
 *   post:
 *     summary: Resend email verification link
 *     tags: [Auth & Account]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, example: user@example.com }
 *     responses:
 *       200:
 *         description: Verification link resent
 */
router.post('/resend-verification', validate(resendVerificationSchema), resendVerificationEmail);

/**
 * @openapi
 * /api/users/login:
 *   post:
 *     summary: Login user / agent / admin
 *     tags: [Auth & Account]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login successful, returns JWT tokens and profile
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', validate(loginSchema), loginUser);

// ================= FORGOT PASSWORD ROUTES (OTP WORKFLOW) =================

/**
 * @openapi
 * /api/users/forgot-password/send-otp:
 *   post:
 *     summary: Request password reset OTP
 *     tags: [Auth & Account]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ForgotPasswordSendOTPRequest'
 *     responses:
 *       200:
 *         description: 6-digit OTP sent to registered email
 */
router.post('/forgot-password/send-otp', validate(forgotPasswordSchema), forgotPassword);

/**
 * @openapi
 * /api/users/forgot-password/verify-otp:
 *   post:
 *     summary: Verify password reset OTP
 *     tags: [Auth & Account]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ForgotPasswordVerifyOTPRequest'
 *     responses:
 *       200:
 *         description: OTP verified successfully
 *       400:
 *         description: Invalid or expired OTP
 */
router.post('/forgot-password/verify-otp', validate(verifyOTPSchema), verifyResetOTP);

/**
 * @openapi
 * /api/users/forgot-password/reset:
 *   post:
 *     summary: Reset password with verified OTP
 *     tags: [Auth & Account]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ForgotPasswordResetRequest'
 *     responses:
 *       200:
 *         description: Password reset successfully
 */
router.post('/forgot-password/reset', auditLog('User', 'edit'), validate(resetPasswordSchema), resetPassword);

/**
 * @openapi
 * /api/users/logout:
 *   post:
 *     summary: Logout and revoke refresh token
 *     tags: [Auth & Account]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
router.post('/logout', authMiddleware, logoutUser);

/**
 * @openapi
 * /api/users/refresh-token:
 *   post:
 *     summary: Refresh access token using refresh token
 *     tags: [Auth & Account]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RefreshTokenRequest'
 *     responses:
 *       200:
 *         description: New access token issued
 *       401:
 *         description: Invalid or expired refresh token
 */
router.post('/refresh-token', validate(refreshTokenSchema), refreshAccessToken);

// ================= USER PROFILE & SETTINGS =================

/**
 * @openapi
 * /api/users/profile:
 *   get:
 *     summary: Get logged-in user profile
 *     tags: [User Profile & Settings]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User profile details
 *   put:
 *     summary: Update profile details
 *     tags: [User Profile & Settings]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               phone: { type: string }
 *               preferredLanguage: { type: string, enum: [english, spanish] }
 *               profileImage: { type: string, format: binary }
 *               document: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Profile updated successfully
 */
router.get('/profile', authMiddleware, getUserProfile);
router.put('/profile', authMiddleware, auditLog('User', 'edit'), upload.fields([{
    name: "profileImage",
    maxCount: 1,
},
{
    name: "document",
    maxCount: 1,
},
]), validate(updateProfileSchema), updateUserProfile);

/**
 * @openapi
 * /api/users/resubmit-kyc:
 *   put:
 *     summary: Resubmit KYC document for verification (Agent)
 *     tags: [User Profile & Settings]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               licenseNumber: { type: string }
 *               document: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: KYC document resubmitted successfully
 */
router.put('/resubmit-kyc', authMiddleware, auditLog('User', 'edit'), upload.fields([
    { name: 'document', maxCount: 1 },
]), resubmitKYC);

/**
 * @openapi
 * /api/users/change-password:
 *   put:
 *     summary: Change account password
 *     tags: [User Profile & Settings]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChangePasswordRequest'
 *     responses:
 *       200:
 *         description: Password changed successfully
 */
router.put('/change-password', authMiddleware, auditLog('User', 'edit'), validate(changePasswordSchema), changePassword);

/**
 * @openapi
 * /api/users/change-language:
 *   put:
 *     summary: Change user preferred language
 *     tags: [User Profile & Settings]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [language]
 *             properties:
 *               language: { type: string, enum: [english, spanish, en, es], example: es }
 *     responses:
 *       200:
 *         description: Language preference updated
 */
router.put('/change-language', authMiddleware, auditLog('User', 'edit'), validate(changeLanguageSchema), changeLanguage);

/**
 * @openapi
 * /api/users/change-currency:
 *   put:
 *     summary: Change preferred display currency
 *     tags: [User Profile & Settings]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currency]
 *             properties:
 *               currency: { type: string, enum: [USD, DOP], example: USD }
 *     responses:
 *       200:
 *         description: Currency preference updated
 */
router.put('/change-currency', authMiddleware, auditLog('User', 'edit'), changeCurrency);

// ================= PROPERTIES (PUBLIC & SEARCH) =================

/**
 * @openapi
 * /api/users/properties/filter:
 *   post:
 *     summary: Filter and search properties (POST body)
 *     tags: [Properties (Public)]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               listingType: { type: string, enum: [RENT, BUY] }
 *               propertyType: { type: string }
 *               location: { type: string }
 *               minPrice: { type: number }
 *               maxPrice: { type: number }
 *               bedrooms: { type: number }
 *               bathrooms: { type: number }
 *     responses:
 *       200:
 *         description: Filtered properties list
 */
router.post('/properties/filter', optionalAuth, getProperties);

/**
 * @openapi
 * /api/users/properties:
 *   get:
 *     summary: Browse and filter properties (Query params)
 *     tags: [Properties (Public)]
 *     parameters:
 *       - in: query
 *         name: listingType
 *         schema: { type: string, enum: [RENT, BUY] }
 *       - in: query
 *         name: propertyType
 *         schema: { type: string }
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *       - in: query
 *         name: minPrice
 *         schema: { type: number }
 *       - in: query
 *         name: maxPrice
 *         schema: { type: number }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Properties list retrieved successfully
 */
/**
 * @openapi
 * /api/users/properties/latest:
 *   get:
 *     summary: Get latest 5 featured properties
 *     tags: [Properties (Public)]
 *     parameters:
 *       - in: query
 *         name: listingType
 *         schema: { type: string, enum: [RENT, BUY] }
 *     responses:
 *       200:
 *         description: Latest featured properties list
 */
router.get('/properties/latest', redisCache(300), optionalAuth, getLatestProperties);

/**
 * @openapi
 * /api/users/properties:
 *   get:
 *     summary: Browse and filter properties (Query params)
 *     tags: [Properties (Public)]
 *     parameters:
 *       - in: query
 *         name: listingType
 *         schema: { type: string, enum: [RENT, BUY] }
 *       - in: query
 *         name: propertyType
 *         schema: { type: string }
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *       - in: query
 *         name: minPrice
 *         schema: { type: number }
 *       - in: query
 *         name: maxPrice
 *         schema: { type: number }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Properties list retrieved successfully
 */
router.get('/properties', redisCache(180), optionalAuth, getProperties);

/**
 * @openapi
 * /api/users/properties/filter-options:
 *   get:
 *     summary: Get available filter options (cities, types, price ranges)
 *     tags: [Properties (Public)]
 *     responses:
 *       200:
 *         description: Dynamic filter options for search UI
 */
router.get('/properties/filter-options', redisCache(3600), optionalAuth, getFilterOptions);

/**
 * @openapi
 * /api/users/properties/compare:
 *   post:
 *     summary: Compare 2-4 properties side-by-side
 *     tags: [Properties (Public)]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [propertyIds]
 *             properties:
 *               propertyIds:
 *                 type: array
 *                 items: { type: string }
 *                 example: ['66e1b6a1e345b6f728901234', '66e1b6a1e345b6f728905678']
 *     responses:
 *       200:
 *         description: Comparison matrix of chosen properties
 */
router.post('/properties/compare', optionalAuth, compareProperties);

/**
 * @openapi
 * /api/users/properties/{id}:
 *   get:
 *     summary: Get property details by ID
 *     tags: [Properties (Public)]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Property full details
 *       404:
 *         description: Property not found
 */
router.get('/properties/:id', redisCache(600), optionalAuth, getPropertyById);

// ================= RECENTLY VIEWED =================

/**
 * @openapi
 * /api/users/recently-viewed:
 *   get:
 *     summary: Get user recently viewed properties
 *     tags: [Recently Viewed]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of recently viewed properties
 *   delete:
 *     summary: Clear all recently viewed properties
 *     tags: [Recently Viewed]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Recently viewed history cleared
 */
router.get('/recently-viewed', authMiddleware, getRecentlyViewed);
router.delete('/recently-viewed', authMiddleware, auditLog('Property', 'delete'), clearRecentlyViewed);

/**
 * @openapi
 * /api/users/recently-viewed/{id}:
 *   delete:
 *     summary: Remove single property from recently viewed history
 *     tags: [Recently Viewed]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Item removed from recently viewed
 */
router.delete('/recently-viewed/:id', authMiddleware, auditLog('Property', 'delete'), deleteRecentlyViewedById);

// ================= FAVORITES =================

/**
 * @openapi
 * /api/users/favorites/toggle:
 *   post:
 *     summary: Add or remove property from favorites / wishlist
 *     tags: [Favorites]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [propertyId]
 *             properties:
 *               propertyId: { type: string, example: 66e1b6a1e345b6f728901234 }
 *     responses:
 *       200:
 *         description: Favorite toggled successfully
 */
router.post('/favorites/toggle', authMiddleware, toggleFavorite);

/**
 * @openapi
 * /api/users/favorites:
 *   get:
 *     summary: Get user favorite properties list
 *     tags: [Favorites]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of favorite properties
 */
router.get('/favorites', authMiddleware, getFavorites);

// // ================= SAVED SEARCHES =================

// /**
//  * @openapi
//  * /api/users/saved-search:
//  *   post:
//  *     summary: Save search criteria for alert notifications
//  *     tags: [Saved Searches]
//  *     security:
//  *       - BearerAuth: []
//  *     requestBody:
//  *       required: true
//  *       content:
//  *         application/json:
//  *           schema:
//  *             $ref: '#/components/schemas/SavedSearchRequest'
//  *     responses:
//  *       201:
//  *         description: Search criteria saved successfully
//  *   get:
//  *     summary: Get list of user saved searches
//  *     tags: [Saved Searches]
//  *     security:
//  *       - BearerAuth: []
//  *     responses:
//  *       200:
//  *         description: List of saved searches
//  */
// router.post('/saved-search', authMiddleware, auditLog('SavedSearch', 'create'), savedSearchSchema ? validate(savedSearchSchema) : (req, res, next) => next(), addSavedSearch);
// router.get('/saved-search', authMiddleware, getSavedSearches);

// /**
//  * @openapi
//  * /api/users/saved-search/{id}:
//  *   delete:
//  *     summary: Delete saved search by ID
//  *     tags: [Saved Searches]
//  *     security:
//  *       - BearerAuth: []
//  *     parameters:
//  *       - in: path
//  *         name: id
//  *         required: true
//  *         schema: { type: string }
//  *     responses:
//  *       200:
//  *         description: Saved search deleted
//  */
// router.delete('/saved-search/:id', authMiddleware, auditLog('SavedSearch', 'delete'), deleteSavedSearch);

// ================= AGENCIES, TIERS & AGENTS (PUBLIC) =================

/**
 * @openapi
 * /api/users/agencies:
 *   get:
 *     summary: Get all active agencies (Public)
 *     tags: [Agencies & Tiers (Public)]
 *     responses:
 *       200:
 *         description: List of active agencies
 */
router.get('/agencies', redisCache(43200), getActiveAgencies);

/**
 * @openapi
 * /api/users/tiers:
 *   get:
 *     summary: Get all commercial tier plans (Public)
 *     tags: [Agencies & Tiers (Public)]
 *     responses:
 *       200:
 *         description: List of available subscription tiers
 */
router.get('/tiers', redisCache(43200), getAllTiers);

/**
 * @openapi
 * /api/users/agents:
 *   get:
 *     summary: Get directory of approved agents
 *     tags: [Agencies & Tiers (Public)]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: agencyId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of approved agents
 */
router.get('/agents', authMiddleware, getAllAgents);

// ================= AGENT REVIEWS & CLAIMS =================

/**
 * @openapi
 * /api/users/agents/reviews:
 *   post:
 *     summary: Submit a review and rating for an agent
 *     tags: [Agent Reviews & Claims]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateReviewRequest'
 *     responses:
 *       201:
 *         description: Review submitted successfully
 *   get:
 *     summary: Get reviews for an agent
 *     tags: [Agent Reviews & Claims]
 *     parameters:
 *       - in: query
 *         name: agentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of reviews for the agent
 */
router.post('/agents/reviews', authMiddleware, auditLog('Review', 'create'), validate(createReviewSchema), createAgentReview);
router.get('/agents/reviews', optionalAuth, getAgentReviews);

/**
 * @openapi
 * /api/users/agent/my-reviews:
 *   get:
 *     summary: Get reviews received by the logged-in agent
 *     tags: [Agent Reviews & Claims]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of reviews received by agent
 */
router.get('/agent/my-reviews', authMiddleware, requireApprovedAgent, getMyAgentReviews);

/**
 * @openapi
 * /api/users/agent/claim-profile:
 *   post:
 *     summary: Claim existing agent profile from scraped/REMAX data
 *     tags: [Agent Reviews & Claims]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [agentProfileId]
 *             properties:
 *               agentProfileId: { type: string, example: 66e1b6a1e345b6f728907890 }
 *     responses:
 *       200:
 *         description: Profile claim request submitted
 */
router.post('/agent/claim-profile', authMiddleware, requireApprovedAgent, auditLog('Agent', 'edit'), claimAgentProfile);

// ================= LEADS & INQUIRIES =================

/**
 * @openapi
 * /api/users/send-lead:
 *   post:
 *     summary: Send lead inquiry for a property
 *     tags: [Leads & Inquiries]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SendLeadRequest'
 *     responses:
 *       201:
 *         description: Lead sent successfully
 */
router.post('/send-lead', authMiddleware, auditLog('Lead', 'create'), validate(sendLeadSchema), sendLead);

/**
 * @openapi
 * /api/users/my-leads:
 *   get:
 *     summary: Get inquiries submitted by logged-in user
 *     tags: [Leads & Inquiries]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of user leads
 */
router.get('/my-leads', authMiddleware, getMyLeads);

/**
 * @openapi
 * /api/users/lead/delete/{leadId}:
 *   delete:
 *     summary: Delete a lead by ID
 *     tags: [Leads & Inquiries]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: leadId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Lead deleted successfully
 */
router.delete('/lead/delete/:leadId', authMiddleware, deleteLead);

/**
 * @openapi
 * /api/users/agent/leads:
 *   get:
 *     summary: Get leads assigned to the logged-in agent
 *     tags: [Leads & Inquiries]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of incoming leads for agent
 */
router.get('/agent/leads', authMiddleware, getAgentLeads);

/**
 * @openapi
 * /api/users/agent/leads/{id}/status:
 *   put:
 *     summary: Update lead status (Agent)
 *     tags: [Leads & Inquiries]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateLeadStatusRequest'
 *     responses:
 *       200:
 *         description: Lead status updated
 */
router.put('/agent/leads/:id/status', authMiddleware, requireApprovedAgent, auditLog('Lead', 'edit'), validate(updateLeadStatusSchema), updateAgentLeadStatus);

/**
 * @openapi
 * /api/users/leads/{id}:
 *   get:
 *     summary: Get lead details by ID
 *     tags: [Leads & Inquiries]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Lead details
 */
router.get('/leads/:id', authMiddleware, getLeadById);

// ================= NOTIFICATIONS =================

/**
 * @openapi
 * /api/users/notifications:
 *   get:
 *     summary: Get all in-app notifications
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of notifications
 */
router.get('/notifications', authMiddleware, getMyNotifications);

/**
 * @openapi
 * /api/users/notifications/new:
 *   get:
 *     summary: Get unread notifications count
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Count of unread notifications
 */
router.get('/notifications/new', authMiddleware, getNewNotifications);

/**
 * @openapi
 * /api/users/notifications/read-all:
 *   put:
 *     summary: Mark all notifications as read
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 */
router.put('/notifications/read-all', authMiddleware, markAllNotificationsAsRead);

/**
 * @openapi
 * /api/users/notifications/{id}/read:
 *   put:
 *     summary: Mark single notification as read
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Notification marked as read
 */
router.put('/notifications/:id/read', authMiddleware, markNotificationAsRead);

/**
 * @openapi
 * /api/users/notifications/delete-all:
 *   delete:
 *     summary: Delete all notifications
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications deleted
 */
router.delete('/notifications/delete-all', authMiddleware, deleteAllNotifications);

/**
 * @openapi
 * /api/users/notifications/{id}:
 *   delete:
 *     summary: Delete single notification by ID
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Notification deleted
 */
router.delete('/notifications/:id', authMiddleware, deleteNotification);


// /**
//  * @openapi
//  * /api/users/amenities:
//  *   get:
//  *     summary: Get all amenities (Multi-language support ?lang=en / ?lang=es)
//  *     tags: [Properties (Public)]
//  *     security:
//  *       - BearerAuth: []
/**
 * @openapi
 * /api/users/amenities:
 *   get:
 *     summary: Get all amenities (Public)
 *     tags: [Properties (Public)]
 *     parameters:
 *       - in: query
 *         name: lang
 *         schema: { type: string, enum: [en, es], default: en }
 *     responses:
 *       200:
 *         description: List of amenities
 */
router.get('/amenities', redisCache(86400), getAllAmenities);

// ================= AI CHAT & SEARCH HISTORY =================

/**
 * @openapi
 * /api/users/chat:
 *   post:
 *     summary: Conversational AI search & chat session
 *     tags: [AI Chat & History]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AISearchRequest'
 *     responses:
 *       200:
 *         description: AI conversational response and top matched listings
 */
router.post('/chat', authMiddleware, chatSearch);

/**
 * @openapi
 * /api/users/chats:
 *   get:
 *     summary: Get user's AI chat sessions
 *     tags: [AI Chat & History]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of chat sessions
 *   delete:
 *     summary: Clear all AI chat sessions
 *     tags: [AI Chat & History]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: All chat sessions deleted
 */
router.get('/chats', authMiddleware, getChatSessions);
router.delete('/chats', authMiddleware, auditLog('ChatSession', 'delete'), clearAllChatSessions);

/**
 * @openapi
 * /api/users/chat/{chatId}:
 *   get:
 *     summary: Get messages for a specific chat session
 *     tags: [AI Chat & History]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: chatId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Chat session history messages
 *   delete:
 *     summary: Delete a specific chat session
 *     tags: [AI Chat & History]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: chatId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Chat session deleted
 */
router.get('/chat/:chatId', authMiddleware, getChatSessionById);
router.delete('/chat/:chatId', authMiddleware, auditLog('ChatSession', 'delete'), deleteChatSession);

/**
 * @openapi
 * /api/users/recently-ai-search:
 *   get:
 *     summary: Get recent AI search queries
 *     tags: [AI Chat & History]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of recently searched queries
 */
router.get('/recently-ai-search', authMiddleware, getRecentlyAISearch);

/**
 * @openapi
 * /api/users/ai-search-history:
 *   delete:
 *     summary: Clear all AI search history
 *     tags: [AI Chat & History]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: AI search history cleared
 */
router.delete('/ai-search-history', authMiddleware, auditLog('AISearch', 'delete'), deleteAISearchHistory);

/**
 * @openapi
 * /api/users/ai-search-history/{id}:
 *   delete:
 *     summary: Delete specific AI search item by ID
 *     tags: [AI Chat & History]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Search history item deleted
 */
router.delete('/ai-search-history/:id', authMiddleware, auditLog('AISearch', 'delete'), deleteAISearchHistoryById);

// ================= AI REALTOR COPILOT =================

/**
 * @openapi
 * /api/users/properties/{id}/marketing-content:
 *   post:
 *     summary: Generate social media and marketing copy for property (Agent Copilot)
 *     description: Generates tailored Dominican Republic marketing copy for Instagram, WhatsApp, and Email newsletters using Gemini AI.
 *     tags: [AI Realtor Copilot]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Property ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               channel: { type: string, enum: [instagram, whatsapp, email, all], default: all, example: instagram }
 *               language: { type: string, enum: [es, en], default: es, example: es }
 *     responses:
 *       200:
 *         description: Marketing copy generated successfully
 */
router.post('/properties/:id/marketing-content', authMiddleware, requireApprovedAgent, generateMarketingContent);

module.exports = router;
