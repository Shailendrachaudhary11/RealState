const express = require('express');
const router = express.Router();
const { chatSearch } = require('../controllers/searchController');
const { optionalAuth } = require('../middleware/auth');

/**
 * @openapi
 * /api/search/ai:
 *   post:
 *     summary: AI Natural Language Property Search
 *     description: Conversational multi-turn property search powered by Google Gemini AI with Dominican Republic real estate extraction
 *     tags: [AI Natural Language Search]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AISearchRequest'
 *     responses:
 *       200:
 *         description: Search response with extracted filters and top 3 recommended real properties
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Top properties matching your search" }
 *                 data:
 *                   type: object
 *                   properties:
 *                     chatId: { type: string, example: "6ae856f7c2f47cdfef242620" }
 *                     extractedFilters: { type: object }
 *                     totalFound: { type: integer, example: 3 }
 *                     topRecommendations: { type: array, items: { type: object } }
 */
router.post('/ai', optionalAuth, chatSearch);

/**
 * @openapi
 * /api/search/chat:
 *   post:
 *     summary: Conversational Real Estate Chat (AI Search)
 *     description: Alternative chat endpoint for continuous multi-turn dialogue state tracking
 *     tags: [AI Natural Language Search]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AISearchRequest'
 *     responses:
 *       200:
 *         description: Chat response with extracted filters and property recommendations
 */
router.post('/chat', optionalAuth, chatSearch);

module.exports = router;
