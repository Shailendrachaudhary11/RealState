const express = require('express');
const router = express.Router();
const {
  getUserActivityReport,
  searchProperty,
  getAgentActivityReport,
  getLeadReport,
  getAiSearchReport,
  getSavedPropertiesReport,
} = require('../controllers/reportController');
const { protect, admin } = require('../middleware/auth');

// Protect all report routes (Admin Only)
router.use(protect);
router.use(admin);

/**
 * @openapi
 * /api/admin/reports/user-activity:
 *   get:
 *     summary: User Activity Report (Admin)
 *     description: Retrieve platform activity reports, login history, and engagement metrics for users.
 *     tags: [Admin - Reports & Analytics]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter records starting from date (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter records up to date (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: User activity metrics retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (Admin access required)
 */
router.get('/user-activity', getUserActivityReport);

/**
 * @openapi
 * /api/admin/reports/agent-activity:
 *   get:
 *     summary: Agent Activity Report (Admin)
 *     description: Metrics on active agents, listings published, response rates, and lead handling.
 *     tags: [Admin - Reports & Analytics]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Agent activity report retrieved successfully
 */
router.get('/agent-activity', getAgentActivityReport);

/**
 * @openapi
 * /api/admin/reports/search-property:
 *   get:
 *     summary: Property Searches Report (Admin)
 *     description: Analytics on popular search keywords, high-demand zones (e.g. Piantini, Bella Vista), and price filters.
 *     tags: [Admin - Reports & Analytics]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Property search analytics retrieved successfully
 */
router.get('/search-property', searchProperty);

/**
 * @openapi
 * /api/admin/reports/leads:
 *   get:
 *     summary: Leads Analytics Report (Admin)
 *     description: Detailed report on incoming leads, conversion statuses (pending, completed, closed), and response times.
 *     tags: [Admin - Reports & Analytics]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Leads analytics report retrieved successfully
 */
router.get('/leads', getLeadReport);

/**
 * @openapi
 * /api/admin/reports/ai-search:
 *   get:
 *     summary: AI Natural Language Search Report (Admin)
 *     description: Analytics on Gemini AI natural language search queries, languages used, and intent detection accuracy.
 *     tags: [Admin - Reports & Analytics]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: AI search report retrieved successfully
 */
router.get('/ai-search', getAiSearchReport);

/**
 * @openapi
 * /api/admin/reports/saved-properties:
 *   get:
 *     summary: Saved Properties & Favorites Report (Admin)
 *     description: Insights on the most favorited and saved properties across the platform.
 *     tags: [Admin - Reports & Analytics]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Saved properties analytics retrieved successfully
 */
router.get('/saved-properties', getSavedPropertiesReport);

module.exports = router;
