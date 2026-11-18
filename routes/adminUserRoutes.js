const express = require('express');
const router = express.Router();
const { getAllUsers, getUserById, updateUser, toggleUserStatus, deleteUser, getUsersReport, addAgency, updateAgency, deleteAgency, toggleAgencyStatus, getAllAgenciesAdmin, getGeneralSettings, updateGeneralSettings } = require('../controllers/adminUserController');
const { getDashboardCards, getSearchAnalytics, getLogs } = require('../controllers/adminDashboardController');
const { getAllAgentsAdmin, getAgentByIdAdmin, updateAgentAdmin, changeAgentStatusAdmin, deleteAgentAdmin } = require('../controllers/adminAgentController');
const { addTier, getAllTiers, getTierById, updateTierById, deleteTierById } = require('../controllers/tierController');

const { protect, admin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { adminUpdateUserSchema, adminChangeAgentStatusSchema, adminUpdateAgentSchema, createAgencySchema, updateAgencySchema, updateGeneralSettingSchema } = require('../validations/userValidation');

const upload = require('../middleware/upload');
const auditLog = require('../middleware/auditLog');

router.use(protect);
router.use(admin);

// Middleware for agent file uploads
const agentUpload = upload.fields([
  { name: 'document', maxCount: 1 },
  { name: 'profileImage', maxCount: 1 },
]);

// Normalization middleware before agent edit validation
const prepareAgentUpdate = (req, res, next) => {
  const incomingAgency = req.body.agency || req.body.agencyId || req.body.agency_id;
  if (incomingAgency) {
    req.body.agency = incomingAgency;
    req.body.agencyId = incomingAgency;
  }
  if (!req.body.licenseNumber && req.body.license_number) {
    req.body.licenseNumber = req.body.license_number;
  }
  if (!req.body.licenseNumber && req.body.liceneseNumber) {
    req.body.licenseNumber = req.body.liceneseNumber;
  }
  next();
};

/**
 * @openapi
 * /api/admin/dashboard:
 *   get:
 *     summary: Admin Dashboard Overview Metrics
 *     description: Retrieve system KPI statistics, total users, active listings, verified agencies, and lead metrics.
 *     tags: [Admin - Dashboard & Logs]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard statistics
 */
router.get('/dashboard', getDashboardCards);

/**
 * @openapi
 * /api/admin/search-analytics:
 *   get:
 *     summary: Search Analytics
 *     description: Overall search trends, popular Dominican cities (Santo Domingo, Punta Cana, Santiago), and demand graphs.
 *     tags: [Admin - Dashboard & Logs]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Search analytics data
 */
router.get('/search-analytics', getSearchAnalytics);

/**
 * @openapi
 * /api/admin/logs:
 *   get:
 *     summary: Audit & Activity Logs
 *     description: View administrative action audit logs for security, tracing, and compliance.
 *     tags: [Admin - Dashboard & Logs]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: List of audit logs
 */
router.get('/logs', getLogs);

// ================= USER MANAGEMENT ROUTES (ADMIN) ================= 

/**
 * @openapi
 * /api/admin/reports/users:
 *   get:
 *     summary: Users Summary Report (Admin)
 *     tags: [Admin - User Management]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User report summary
 */
router.get('/reports/users', getUsersReport);

/**
 * @openapi
 * /api/admin/users:
 *   get:
 *     summary: List all registered users (Admin)
 *     tags: [Admin - User Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [buyer, agent, admin] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, approved, rejected, suspended] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of registered users
 */
router.get('/users', getAllUsers);

/**
 * @openapi
 * /api/admin/users/{id}:
 *   get:
 *     summary: Get user by ID (Admin)
 *     tags: [Admin - User Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: User profile details
 *   put:
 *     summary: Update user profile (Admin)
 *     tags: [Admin - User Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               email: { type: string }
 *               phone: { type: string }
 *               role: { type: string, enum: [buyer, agent, admin] }
 *               status: { type: string, enum: [pending, approved, rejected, suspended] }
 *               profileImage: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: User updated successfully
 *   delete:
 *     summary: Delete user account (Admin)
 *     tags: [Admin - User Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: User deleted successfully
 */
router.get('/users/:id', getUserById);
router.put('/users/:id', auditLog('User', 'edit'), upload.single('profileImage'), validate(adminUpdateUserSchema), updateUser);
router.delete('/users/:id', auditLog('User', 'delete'), deleteUser);

/**
 * @openapi
 * /api/admin/users/{id}/toggle-status:
 *   put:
 *     summary: Toggle user active / blocked status
 *     tags: [Admin - User Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: User active status toggled
 */
router.put('/users/:id/toggle-status', auditLog('User', 'edit'), toggleUserStatus);

// ================= AGENT MANAGEMENT ROUTES (ADMIN) =================

/**
 * @openapi
 * /api/admin/agents:
 *   get:
 *     summary: List all real estate agents (Admin)
 *     tags: [Admin - Agent Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, approved, rejected, suspended] }
 *       - in: query
 *         name: agencyId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of agents
 */
router.get('/agents', getAllAgentsAdmin);

/**
 * @openapi
 * /api/admin/agents/{id}:
 *   get:
 *     summary: Get agent details & KYC documents (Admin)
 *     tags: [Admin - Agent Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Agent details
 *   delete:
 *     summary: Delete agent profile (Admin)
 *     tags: [Admin - Agent Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Agent profile deleted
 */
router.get('/agents/:id', getAgentByIdAdmin);
router.delete('/agents/:id', auditLog('Agent', 'delete'), deleteAgentAdmin);

/**
 * @openapi
 * /api/admin/agents/edit/{id}:
 *   put:
 *     summary: Edit agent details and KYC (Admin)
 *     tags: [Admin - Agent Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               phone: { type: string }
 *               licenseNumber: { type: string }
 *               agencyId: { type: string }
 *               document: { type: string, format: binary }
 *               profileImage: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Agent updated successfully
 */
router.put('/agents/edit/:id', auditLog('Agent', 'edit'), agentUpload, prepareAgentUpdate, validate(adminUpdateAgentSchema), updateAgentAdmin);

/**
 * @openapi
 * /api/admin/agents/{id}/status:
 *   put:
 *     summary: Approve, reject, or suspend agent (Admin)
 *     tags: [Admin - Agent Management]
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
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, approved, rejected, suspended]
 *                 example: approved
 *               reason:
 *                 type: string
 *                 example: KYC documents verified
 *     responses:
 *       200:
 *         description: Agent status changed successfully
 */
router.put('/agents/:id/status', auditLog('Agent', 'edit'), validate(adminChangeAgentStatusSchema), changeAgentStatusAdmin);

// ================= AGENCY MANAGEMENT (ADMIN) =================

/**
 * @openapi
 * /api/admin/agency:
 *   get:
 *     summary: List all agencies (Admin)
 *     tags: [Admin - Agency Management]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of agencies
 */
router.get('/agency', getAllAgenciesAdmin);

/**
 * @openapi
 * /api/admin/addAgency:
 *   post:
 *     summary: Add new real estate agency (Admin)
 *     tags: [Admin - Agency Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: REMAX RD }
 *               description: { type: string, example: Leading agency in the Dominican Republic }
 *               logo: { type: string, format: binary }
 *               website: { type: string }
 *               tier: { type: string }
 *     responses:
 *       201:
 *         description: Agency created successfully
 */
router.post('/addAgency', auditLog('Agency', 'add'), upload.single('logo'), validate(createAgencySchema), addAgency);

/**
 * @openapi
 * /api/admin/editAgency/{id}:
 *   put:
 *     summary: Update agency details (Admin)
 *     tags: [Admin - Agency Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               logo: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Agency updated successfully
 */
router.put('/editAgency/:id', auditLog('Agency', 'edit'), upload.single('logo'), validate(updateAgencySchema), updateAgency);

/**
 * @openapi
 * /api/admin/deleteAgency/{id}:
 *   delete:
 *     summary: Delete agency (Admin)
 *     tags: [Admin - Agency Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Agency deleted successfully
 */
router.delete('/deleteAgency/:id', auditLog('Agency', 'delete'), deleteAgency);

/**
 * @openapi
 * /api/admin/toggleAgencyStatus/{id}:
 *   put:
 *     summary: Toggle agency active status (Admin)
 *     tags: [Admin - Agency Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Agency status toggled
 */
router.put('/toggleAgencyStatus/:id', auditLog('Agency', 'edit'), toggleAgencyStatus);

// ================= GENERAL APPLICATION SETTINGS (ADMIN) =================

/**
 * @openapi
 * /api/admin/settings/general:
 *   get:
 *     summary: Get platform general settings (Admin)
 *     tags: [Admin - Platform Settings]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: General settings details
 *   put:
 *     summary: Update platform general settings (Admin)
 *     tags: [Admin - Platform Settings]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GeneralSettingRequest'
 *     responses:
 *       200:
 *         description: General settings updated
 */
router.get('/settings/general', getGeneralSettings);
router.put('/settings/general', auditLog('GeneralSetting', 'edit'), validate(updateGeneralSettingSchema), updateGeneralSettings);

// ================= TIER MANAGEMENT (ADMIN) =================

/**
 * @openapi
 * /api/admin/tiers/add:
 *   post:
 *     summary: Create new subscription tier plan (Admin)
 *     tags: [Admin - Tier Plans]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TierRequest'
 *     responses:
 *       201:
 *         description: Tier created successfully
 */
router.post('/tiers/add', auditLog('Tier', 'add'), addTier);

/**
 * @openapi
 * /api/admin/tiers/get-all:
 *   get:
 *     summary: Get all subscription tier plans (Admin)
 *     tags: [Admin - Tier Plans]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of tier plans
 */
router.get('/tiers/get-all', getAllTiers);

/**
 * @openapi
 * /api/admin/tiers/{id}:
 *   get:
 *     summary: Get tier by ID (Admin)
 *     tags: [Admin - Tier Plans]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Tier details
 */
router.get('/tiers/:id', getTierById);

/**
 * @openapi
 * /api/admin/tiers/edit/{id}:
 *   put:
 *     summary: Update tier plan (Admin)
 *     tags: [Admin - Tier Plans]
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
 *             $ref: '#/components/schemas/TierRequest'
 *     responses:
 *       200:
 *         description: Tier updated successfully
 */
router.put('/tiers/edit/:id', auditLog('Tier', 'edit'), updateTierById);

/**
 * @openapi
 * /api/admin/tiers/delete/{id}:
 *   delete:
 *     summary: Delete tier plan (Admin)
 *     tags: [Admin - Tier Plans]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Tier deleted successfully
 */
router.delete('/tiers/delete/:id', auditLog('Tier', 'delete'), deleteTierById);

module.exports = router;
