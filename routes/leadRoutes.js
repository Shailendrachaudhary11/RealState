const express = require('express');
const router = express.Router();
const { sendLead, getMyLeads, getLeadById, getAgentLeads, updateAgentLeadStatus } = require('../controllers/leadController');
const { protect: authMiddleware, requireApprovedAgent } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { sendLeadSchema, updateLeadStatusSchema } = require('../validations/leadValidation');

/**
 * @openapi
 * /api/leads/send-lead:
 *   post:
 *     summary: Submit a new property lead/inquiry
 *     description: Authenticated user submits an inquiry for a property or directly to an agent. Requires either property/propertyId along with chatId or description.
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
 *         description: Lead submitted successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post('/send-lead', authMiddleware, validate(sendLeadSchema), sendLead);

/**
 * @openapi
 * /api/leads/my-leads:
 *   get:
 *     summary: Get leads submitted by the authenticated user
 *     tags: [Leads & Inquiries]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of submitted leads
 *       401:
 *         description: Unauthorized
 */
router.get('/my-leads', authMiddleware, getMyLeads);

/**
 * @openapi
 * /api/leads/agent-leads:
 *   get:
 *     summary: Get leads assigned to the authenticated agent
 *     tags: [Leads & Inquiries]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of leads assigned to agent
 *       401:
 *         description: Unauthorized
 */
router.get('/agent-leads', authMiddleware, getAgentLeads);

/**
 * @openapi
 * /api/leads/getAgentLeads:
 *   get:
 *     summary: Get leads assigned to the authenticated agent (Alias)
 *     tags: [Leads & Inquiries]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of leads assigned to agent
 */
router.get('/getAgentLeads', authMiddleware, getAgentLeads);

/**
 * @openapi
 * /api/leads/{id}/status:
 *   put:
 *     summary: Update lead status (Agent only)
 *     tags: [Leads & Inquiries]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB Lead ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateLeadStatusRequest'
 *     responses:
 *       200:
 *         description: Lead status updated successfully
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden (approved agent required)
 */
router.put('/:id/status', authMiddleware, requireApprovedAgent, validate(updateLeadStatusSchema), updateAgentLeadStatus);

/**
 * @openapi
 * /api/leads/{id}:
 *   get:
 *     summary: Get single lead by ID
 *     tags: [Leads & Inquiries]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB Lead ID
 *     responses:
 *       200:
 *         description: Lead details
 *       404:
 *         description: Lead not found
 */
router.get('/:id', authMiddleware, getLeadById);

module.exports = router;
