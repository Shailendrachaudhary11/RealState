const express = require('express');
const router = express.Router();
const {
  addProperty,
  getAllPropertiesAdmin,
  getPropertyByIdAdmin,
  updatePropertyStatus,
  updateProperty,
  deleteProperty,
  importScrapedProperties,
  syncRemaxPropertiesAdmin,
  getRemaxSyncStatusAdmin,
  cancelRemaxSyncAdmin,
} = require('../controllers/propertyController');
const { protect, admin } = require('../middleware/auth');
const upload = require('../middleware/upload');
const auditLog = require('../middleware/auditLog');

const {
  getAllAmenities,
  addAmenity,
  deleteAmenity,
} = require('../controllers/amenityController');

// Protect all admin property routes
router.use(protect);
router.use(admin);

// /**
//  * @openapi
//  * /api/admin/amenities:
//  *   get:
//  *     summary: Get all amenities (Admin)
//  *     tags: [Admin - Amenities]
//  *     security:
//  *       - BearerAuth: []
//  *     parameters:
//  *       - in: query
//  *         name: lang
//  *         schema:
//  *           type: string
//  *           enum: [en, es]
//  *         description: Language translation ('en' or 'es')
//  *     responses:
//  *       200:
//  *         description: List of amenities
//  *   post:
//  *     summary: Add a new amenity (Admin)
//  *     tags: [Admin - Amenities]
//  *     security:
//  *       - BearerAuth: []
//  *     requestBody:
//  *       required: true
//  *       content:
//  *         application/json:
//  *           schema:
//  *             type: object
//  *             required: [name]
//  *             properties:
//  *               name:
//  *                 type: string
//  *                 example: Swimming Pool
//  *               name_es:
//  *                 type: string
//  *                 example: Piscina
//  *               icon:
//  *                 type: string
//  *                 example: pool
//  *     responses:
//  *       201:
//  *         description: Amenity added successfully
//  */
// router.get('/amenities', getAllAmenities);
// router.post('/amenities', auditLog('Amenity', 'create'), addAmenity);

// /**
//  * @openapi
//  * /api/admin/amenities/{id}:
//  *   delete:
//  *     summary: Delete an amenity by ID (Admin)
//  *     tags: [Admin - Amenities]
//  *     security:
//  *       - BearerAuth: []
//  *     parameters:
//  *       - in: path
//  *         name: id
//  *         required: true
//  *         schema:
//  *           type: string
//  *         description: Amenity ID
//  *     responses:
//  *       200:
//  *         description: Amenity deleted successfully
//  */
// router.delete('/amenities/:id', auditLog('Amenity', 'delete'), deleteAmenity);

/**
 * @openapi
 * /api/admin/properties:
 *   get:
 *     summary: Get all properties (Admin)
 *     description: Retrieve paginated property listings with full admin management filters and verification statuses.
 *     tags: [Admin - Properties]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, approved, rejected, inactive] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Paginated properties list retrieved successfully
 */
router.get('/properties', getAllPropertiesAdmin);


/**
 * @openapi
 * /api/admin/properties/import-scraped:
 *   post:
 *     summary: Import properties in bulk via Excel / CSV / JSON
 *     tags: [Admin - Properties]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Excel (.xlsx), CSV (.csv), or JSON file with property listings
 *     responses:
 *       200:
 *         description: Bulk properties imported successfully
 */
router.post(
  '/properties/import-scraped',
  auditLog('Property', 'create'),
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'excel', maxCount: 1 },
    { name: 'csv', maxCount: 1 },
  ]),
  importScrapedProperties
);

/**
 * @openapi
 * /api/admin/properties/add:
 *   post:
 *     summary: Add new property manually (Admin)
 *     tags: [Admin - Properties]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [title, price, listingType, propertyType]
 *             properties:
 *               title: { type: string, example: Modern 3-Bedroom Penthouse in Piantini }
 *               description: { type: string, example: Luxurious apartment with panoramic city views }
 *               price: { type: number, example: 350000 }
 *               currency: { type: string, default: USD, example: USD }
 *               listingType: { type: string, enum: [RENT, BUY], example: BUY }
 *               propertyType: { type: string, enum: [APARTMENT, HOUSE, PLOT, COMMERCIAL], example: APARTMENT }
 *               bedrooms: { type: number, example: 3 }
 *               bathrooms: { type: number, example: 3 }
 *               area: { type: number, example: 220 }
 *               location: { type: string, example: Piantini, Santo Domingo }
 *               city: { type: string, example: Santo Domingo }
 *               images:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Property created successfully
 */
router.post('/properties/add', auditLog('Property', 'create'), upload.array('images', 10), addProperty);

/**
 * @openapi
 * /api/admin/properties/{id}:
 *   get:
 *     summary: Get property details by ID (Admin)
 *     tags: [Admin - Properties]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB Property ID
 *     responses:
 *       200:
 *         description: Property details
 *       404:
 *         description: Property not found
 *   put:
 *     summary: Update property details (Admin)
 *     tags: [Admin - Properties]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               price: { type: number }
 *               images:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Property updated successfully
 *   delete:
 *     summary: Delete a property (Admin)
 *     tags: [Admin - Properties]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Property deleted successfully
 */
router.get('/properties/:id', getPropertyByIdAdmin);
router.put('/properties/:id', auditLog('Property', 'edit'), upload.array('images', 10), updateProperty);

/**
 * @openapi
 * /api/admin/properties/{id}/status:
 *   put:
 *     summary: Update property approval status (Admin)
 *     tags: [Admin - Properties]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
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
 *                 enum: [pending, approved, rejected, inactive]
 *                 example: approved
 *               rejectionReason:
 *                 type: string
 *                 example: Incomplete documentation
 *     responses:
 *       200:
 *         description: Property status updated successfully
 */
router.put('/properties/:id/status', auditLog('Property', 'edit'), updatePropertyStatus);
router.delete('/properties/:id', auditLog('Property', 'delete'), deleteProperty);

module.exports = router; 