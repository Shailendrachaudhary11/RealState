const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const fs = require('fs');
const path = require('path');
const https = require('https');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');
const Joi = require('joi');
const xlsx = require('xlsx');
const Property = require('../models/Property');
const Agency = require('../models/Agency');
const Amenity = require('../models/Amenity');
const languageMappings = require('../config/languageMappings');
const FavoriteProperty = require('../models/FavoriteProperty');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const SearchLog = require('../models/SearchLog');
const Tier = require('../models/Tier');
const Review = require('../models/Review');
const { resolveLanguage, formatPropertyData, getLocalizedMessage } = require('../utils/languageHelper');
const { resolvePropertyEngagement } = require('../utils/propertyEngagementHelper');
const {
  normalizeListingType,
  normalizePropertyType,
  buildLocationConditions,
  buildPropertyQuery,
  sortPropertiesByTier,
  getDefaultTier1,
} = require('../utils/propertySearchHelper');
const { clearPropertyCaches } = require('../utils/cacheInvalidation');
const { generateStructuredJson, generateText } = require('../services/aiService');

const {
  // syncRemaxProperties,
  startAsyncSyncRemax,
  getSyncStatus,
  cancelSync,
} = require('../services/remaxSyncService');

const saveHooks = Property.schema.s.hooks._pres.get('save') || [];
Property.schema.s.hooks._pres.set(
  'save',
  saveHooks.filter((hook) => {
    const code = hook.fn.toString();
    return !(code.includes('this.location') && code.includes('.trim()'));
  })
);

// Helper function to delete uploaded files in case of validation/save failures
const deleteUploadedFiles = (files) => {
  if (files && files.length > 0) {
    files.forEach((file) => {
      try {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } catch (err) {
        console.error(`Failed to delete temporary file ${file.path}: ${err.message}`);
      }
    });
  }
};

// Joi validation schema for Property
const propertyValidationSchema = Joi.object({
  title: Joi.object({
    en: Joi.string().allow('', null).optional(),
    es: Joi.string().allow('', null).optional(),
  }).optional(),

  description: Joi.object({
    en: Joi.string().allow('', null).optional(),
    es: Joi.string().allow('', null).optional(),
  }).optional(),

  location: Joi.object({
    address: Joi.string().allow('', null).optional(),
    area: Joi.string().allow('', null).optional(),
    city: Joi.string().default('Santo Domingo').optional(),
    state: Joi.string().allow('', null).optional(),
    country: Joi.string().default('Dominican Republic'),
    pincode: Joi.string().allow('', null).optional(),
  }).optional(),

  propertyType: Joi.string()
    .valid('APARTMENT', 'HOUSE', 'LAND', 'OFFICE', 'COMMERCIAL')
    .default('HOUSE')
    .optional(),

  listingType: Joi.string()
    .valid('RENT', 'BUY')
    .default('BUY')
    .optional(),

  price: Joi.object({
    dop: Joi.number().default(0).optional(),
    usd: Joi.number().default(0).optional(),
  }).optional(),

  bedrooms: Joi.number().integer().min(0).allow(null).empty('').default(null).optional(),
  bathrooms: Joi.number().integer().min(0).allow(null).empty('').default(null).optional(),

  size: Joi.number().default(0).optional(),
  sizeUnit: Joi.string()
    .valid('sq ft', 'sq yards', 'sq meters')
    .default('sq meters')
    .optional(),

  maintenanceFee: Joi.object({
    amount: Joi.number().default(0).optional(),
    currency: Joi.string().default('DOP').optional(),
  }).optional(),

  images: Joi.array().items(Joi.string()).default([]),

  source: Joi.string().default('REMAX').optional(),
  sourceUrl: Joi.string().allow('', null).optional(),
  agency: Joi.string().allow(null, '').optional(),
  agent: Joi.string().allow(null, '').optional(),
  status: Joi.string().valid('Active', 'Inactive').default('Active').optional(),

  agentDetails: Joi.object({
    name: Joi.string().allow('', null).optional(),
    phone: Joi.string().allow('', null).optional(),
    email: Joi.string().email().allow('', null).optional(),
    profileImage: Joi.string().allow('', null).optional(),
    office: Joi.string().allow('', null).optional(),
    whatsapp: Joi.string().allow('', null).optional(),
  }).optional(),
});

const addProperty = async (req, res, next) => {
  try {
    // 1. Client-friendly preprocessing: Normalize flat / JSON string inputs to nested schema objects

    // Normalize Title
    let titleObj = { en: '', es: '' };
    if (typeof req.body.title === 'string') {
      try {
        const parsed = JSON.parse(req.body.title);
        if (typeof parsed === 'object' && parsed !== null) {
          titleObj = {
            en: parsed.en || '',
            es: parsed.es || '',
          };
        } else {
          titleObj.en = req.body.title;
        }
      } catch {
        titleObj.en = req.body.title;
      }
    } else if (typeof req.body.title === 'object' && req.body.title !== null) {
      titleObj = {
        en: req.body.title.en || '',
        es: req.body.title.es || '',
      };
    }
    if (req.body.enTitle) titleObj.en = req.body.enTitle;
    if (req.body.esTitle) titleObj.es = req.body.esTitle;
    if (req.body['title.en']) titleObj.en = req.body['title.en'];
    if (req.body['title.es']) titleObj.es = req.body['title.es'];
    req.body.title = {
      en: String(titleObj.en || '').trim(),
      es: String(titleObj.es || '').trim(),
    };

    // Normalize Description
    let descObj = { en: '', es: '' };
    if (typeof req.body.description === 'string') {
      try {
        const parsed = JSON.parse(req.body.description);
        if (typeof parsed === 'object' && parsed !== null) {
          descObj = {
            en: parsed.en || '',
            es: parsed.es || '',
          };
        } else {
          descObj.en = req.body.description;
        }
      } catch {
        descObj.en = req.body.description;
      }
    } else if (typeof req.body.description === 'object' && req.body.description !== null) {
      descObj = {
        en: req.body.description.en || '',
        es: req.body.description.es || '',
      };
    }
    if (req.body.enDescription) descObj.en = req.body.enDescription;
    if (req.body.esDescription) descObj.es = req.body.esDescription;
    if (req.body['description.en']) descObj.en = req.body['description.en'];
    if (req.body['description.es']) descObj.es = req.body['description.es'];
    req.body.description = {
      en: String(descObj.en || '').trim(),
      es: String(descObj.es || '').trim(),
    };

    // Normalize Location
    let locObj = {};
    if (typeof req.body.location === 'string') {
      try {
        const parsed = JSON.parse(req.body.location);
        if (typeof parsed === 'object' && parsed !== null) {
          locObj = parsed;
        }
      } catch { }
    } else if (typeof req.body.location === 'object' && req.body.location !== null) {
      locObj = { ...req.body.location };
    }
    if (req.body.address && !locObj.address) locObj.address = req.body.address;
    if (req.body.area && !locObj.area) locObj.area = req.body.area;
    if (req.body.city && !locObj.city) locObj.city = req.body.city;
    if (req.body.state && !locObj.state) locObj.state = req.body.state;
    if (req.body.country && !locObj.country) locObj.country = req.body.country;
    if (req.body.pincode && !locObj.pincode) locObj.pincode = req.body.pincode;

    if (req.body['location.address']) locObj.address = req.body['location.address'];
    if (req.body['location.area']) locObj.area = req.body['location.area'];
    if (req.body['location.city']) locObj.city = req.body['location.city'];
    if (req.body['location.state']) locObj.state = req.body['location.state'];
    if (req.body['location.country']) locObj.country = req.body['location.country'];
    if (req.body['location.pincode']) locObj.pincode = req.body['location.pincode'];

    if (req.body.latitude || req.body.longitude || req.body['location.coordinates.latitude'] || req.body['location.coordinates.longitude']) {
      if (!locObj.coordinates) {
        locObj.coordinates = {};
      }
      const lat = req.body.latitude || req.body['location.coordinates.latitude'] || (locObj.coordinates && locObj.coordinates.latitude);
      const lng = req.body.longitude || req.body['location.coordinates.longitude'] || (locObj.coordinates && locObj.coordinates.longitude);
      if (lat !== undefined && lat !== null && lat !== '') {
        locObj.coordinates.latitude = Number(lat);
      }
      if (lng !== undefined && lng !== null && lng !== '') {
        locObj.coordinates.longitude = Number(lng);
      }
    }
    req.body.location = locObj;

    // Normalize Agent Details (handling agentDetails, ownerContact, agentName/ownerName, etc.)
    let agentObj = {};
    const rawAgent = req.body.agentDetails || req.body.ownerContact;
    if (typeof rawAgent === 'string') {
      try {
        const parsed = JSON.parse(rawAgent);
        if (typeof parsed === 'object' && parsed !== null) {
          agentObj = parsed;
        }
      } catch { }
    } else if (typeof rawAgent === 'object' && rawAgent !== null) {
      agentObj = { ...rawAgent };
    }

    if (req.body.agentName) agentObj.name = req.body.agentName;
    if (req.body.ownerName && !agentObj.name) agentObj.name = req.body.ownerName;
    if (req.body['agentDetails.name']) agentObj.name = req.body['agentDetails.name'];
    if (req.body['ownerContact.name'] && !agentObj.name) agentObj.name = req.body['ownerContact.name'];

    if (req.body.agentPhone) agentObj.phone = req.body.agentPhone;
    if (req.body.ownerPhone && !agentObj.phone) agentObj.phone = req.body.ownerPhone;
    if (req.body['agentDetails.phone']) agentObj.phone = req.body['agentDetails.phone'];
    if (req.body['ownerContact.phone'] && !agentObj.phone) agentObj.phone = req.body['ownerContact.phone'];

    if (req.body.agentEmail) agentObj.email = req.body.agentEmail;
    if (req.body.ownerEmail && !agentObj.email) agentObj.email = req.body.ownerEmail;
    if (req.body['agentDetails.email']) agentObj.email = req.body['agentDetails.email'];
    if (req.body['ownerContact.email'] && !agentObj.email) agentObj.email = req.body['ownerContact.email'];

    req.body.agentDetails = agentObj;

    // Normalize Source
    if (!req.body.source) {
      req.body.source = 'Admin';
    }

    // Normalize Status
    if (req.body.status) {
      const s = String(req.body.status).trim();
      req.body.status = (s.toLowerCase() === 'inactive') ? 'Inactive' : 'Active';
    } else {
      req.body.status = 'Active';
    }

    // Normalize Price (dop, usd, eur)
    let priceObj = {};
    if (typeof req.body.price === 'string') {
      try {
        const parsed = JSON.parse(req.body.price);
        if (typeof parsed === 'object' && parsed !== null) {
          priceObj = { ...parsed };
        }
      } catch { }
    } else if (typeof req.body.price === 'object' && req.body.price !== null) {
      priceObj = { ...req.body.price };
    }

    if (req.body['price.dop'] !== undefined) priceObj.dop = req.body['price.dop'];
    if (req.body['price.usd'] !== undefined) priceObj.usd = req.body['price.usd'];
    if (req.body['price.eur'] !== undefined) priceObj.eur = req.body['price.eur'];
    if (req.body['price[dop]'] !== undefined) priceObj.dop = req.body['price[dop]'];
    if (req.body['price[usd]'] !== undefined) priceObj.usd = req.body['price[usd]'];
    if (req.body['price[eur]'] !== undefined) priceObj.eur = req.body['price[eur]'];
    if (req.body.dop !== undefined) priceObj.dop = req.body.dop;
    if (req.body.usd !== undefined) priceObj.usd = req.body.usd;
    if (req.body.eur !== undefined) priceObj.eur = req.body.eur;
    if (req.body.DOP !== undefined) priceObj.dop = req.body.DOP;
    if (req.body.USD !== undefined) priceObj.usd = req.body.USD;
    if (req.body.EUR !== undefined) priceObj.eur = req.body.EUR;

    if (priceObj.dop !== undefined && priceObj.dop !== null && priceObj.dop !== '') {
      priceObj.dop = Number(priceObj.dop);
    }
    if (priceObj.usd !== undefined && priceObj.usd !== null && priceObj.usd !== '') {
      priceObj.usd = Number(priceObj.usd);
    }
    if (priceObj.eur !== undefined && priceObj.eur !== null && priceObj.eur !== '') {
      priceObj.eur = Number(priceObj.eur);
    }
    req.body.price = priceObj;

    // Normalize Construction Status
    if (req.body.constructionStatus) {
      const cs = String(req.body.constructionStatus).trim().toLowerCase();
      if (cs.includes('off') || cs.includes('plan') || cs.includes('construction')) {
        req.body.constructionStatus = 'Off-plan';
      } else if (cs.includes('brand') || cs.includes('new') || cs.includes('estrenar')) {
        req.body.constructionStatus = 'Brand New';
      } else if (cs.includes('re') || cs.includes('sale') || cs.includes('used') || cs.includes('usado')) {
        req.body.constructionStatus = 'Resale';
      }
    }

    // Normalize isShortTermRentalAllowed
    if (req.body.isShortTermRentalAllowed !== undefined) {
      if (typeof req.body.isShortTermRentalAllowed === 'string') {
        req.body.isShortTermRentalAllowed = req.body.isShortTermRentalAllowed.toLowerCase().trim() === 'true' || req.body.isShortTermRentalAllowed.trim() === '1';
      } else {
        req.body.isShortTermRentalAllowed = Boolean(req.body.isShortTermRentalAllowed);
      }
    }

    // Handle bedrooms & bathrooms empty strings
    if (req.body.bedrooms === '' || req.body.bedrooms === undefined) {
      req.body.bedrooms = req.body.bedrooms === '' ? null : req.body.bedrooms;
    }
    if (req.body.bathrooms === '' || req.body.bathrooms === undefined) {
      req.body.bathrooms = req.body.bathrooms === '' ? null : req.body.bathrooms;
    }

    // Normalize Amenities (support JSON strings, arrays, or comma-separated lists)
    let amenities = [];
    if (req.body.amenities) {
      if (Array.isArray(req.body.amenities)) {
        amenities = req.body.amenities;
      } else if (typeof req.body.amenities === 'string') {
        const trimmed = req.body.amenities.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          try {
            amenities = JSON.parse(trimmed);
          } catch {
            amenities = trimmed.split(',').map((item) => item.trim()).filter(Boolean);
          }
        } else {
          amenities = trimmed.split(',').map((item) => item.trim()).filter(Boolean);
        }
      }
    }
    req.body.amenities = amenities;

    // Normalize Images (Merge body-submitted URL strings/arrays with multer files)
    let bodyImages = [];
    if (req.body.images) {
      if (Array.isArray(req.body.images)) {
        bodyImages = req.body.images;
      } else if (typeof req.body.images === 'string') {
        const trimmed = req.body.images.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          try {
            bodyImages = JSON.parse(trimmed);
          } catch {
            bodyImages = trimmed.split(',').map((item) => item.trim()).filter(Boolean);
          }
        } else {
          bodyImages = trimmed.split(',').map((item) => item.trim()).filter(Boolean);
        }
      }
    }

    let uploadedImages = [];
    if (req.files && req.files.length > 0) {
      uploadedImages = req.files.map((file) => `/uploads/${file.filename}`);
    }
    req.body.images = [...bodyImages, ...uploadedImages];

    // 2. Perform validation internally using the Joi schema
    const { error, value } = propertyValidationSchema.validate(req.body, {
      abortEarly: false, // Include all errors instead of stopping on first
      stripUnknown: true, // Clean up unused attributes
    });

    if (error) {
      // Delete any files uploaded in this request on validation error
      deleteUploadedFiles(req.files);

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.details.map((detail) => detail.message),
      });
    }

    // 3. Save the validated property to MongoDB
    const property = new Property(value);
    await property.save();

    // Invalidate Redis property cache
    clearPropertyCaches(property._id);

    // 4. Return success response
    res.status(201).json({
      success: true,
      message: 'Property added successfully',
      data: {
        property,
      }
    });
  } catch (err) {
    // Delete any files uploaded in this request on execution error
    deleteUploadedFiles(req.files);
    console.error(`Add Property Error: ${err.message}`);
    next(err);
  }
};

const getLatestProperties = async (req, res, next) => {
  try {
    const { listingType } = req.query;

    let filter = { status: 'Active' };

    if (listingType) filter.listingType = listingType;

    // 1. Identify target language from user preferredLanguage or fallback
    const lang = resolveLanguage(req);
    const userId = req.user ? req.user._id : null;

    // Build a Set of user's favorited property IDs for O(1) lookups
    const favoriteSet = new Set();
    if (userId) {
      const userFavorites = await FavoriteProperty.find({ user: userId }).select('property');
      userFavorites.forEach((fav) => {
        if (fav.property) {
          favoriteSet.add(fav.property.toString());
        }
      });
    }

    // 2. Fetch latest 5 properties (only Active properties)
    const properties = await Property.find(filter)
      .populate('agency', 'name logo website isFoundingSponsor')
      .populate('agent', 'name phone email profileImage')
      .sort({ createdAt: -1 })
      .limit(5);

    // 3. Transform properties data to return flattened translated strings
    const formattedProperties = properties.map((doc) =>
      formatPropertyData(doc, lang, favoriteSet.has(doc._id.toString()))
    );

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('propertiesRetrieved', lang),
      data: {
        language: lang === 'es' ? 'Spanish' : 'English',
        count: formattedProperties.length,
        properties: formattedProperties,
      }
    });
  } catch (err) {
    console.error(`Get Latest Properties Error: ${err.message}`);
    next(err);
  }
};

const getProperties = async (req, res, next) => {
  try {
    const payload = { ...(req.query || {}), ...(req.body || {}) };
    const {
      listingType,
      propertyType,
      price,
      minPrice,
      maxPrice,
      currency,
      location,
      search,
      query: searchQuery,
      keyword,
      bedrooms,
      bathrooms,
      minSize,
      maxSize,
      amenities,
      page = 1,
      limit,
      sortBy = 'newest'
    } = payload;

    // Auto-correct if maxPrice or minPrice was passed as propertyType (e.g. maxPrice: "apartment")
    let finalPropType = propertyType;
    let finalMaxPrice = maxPrice;
    let finalMinPrice = minPrice;

    if (!finalPropType && finalMaxPrice && typeof finalMaxPrice === 'string' && isNaN(Number(finalMaxPrice))) {
      const detected = normalizePropertyType(finalMaxPrice);
      if (detected) {
        finalPropType = detected;
        finalMaxPrice = null;
      }
    }
    if (!finalPropType && finalMinPrice && typeof finalMinPrice === 'string' && isNaN(Number(finalMinPrice))) {
      const detected = normalizePropertyType(finalMinPrice);
      if (detected) {
        finalPropType = detected;
        finalMinPrice = null;
      }
    }

    const filters = {
      listingType,
      propertyType: finalPropType,
      price,
      minPrice: finalMinPrice,
      maxPrice: finalMaxPrice,
      currency,
      location: location || '',
      search: search || searchQuery || keyword || '',
      bedrooms,
      bathrooms,
      minSize,
      maxSize,
      amenities,
    };

    const query = buildPropertyQuery(filters);

    const lang = resolveLanguage(req);
    const userId = req.user ? req.user._id : null;

    const favoriteSet = new Set();
    if (userId) {
      const userFavorites = await FavoriteProperty.find({ user: userId }).select('property').lean();
      userFavorites.forEach(fav => {
        if (fav.property) {
          favoriteSet.add(fav.property.toString());
        }
      });
    }

    const defaultTier1 = await getDefaultTier1();

    // Fetch active properties matching the query with lean & projection for fast performance with 1,000+ records
    const properties = await Property.find(query)
      .select('title description location propertyType listingType price bedrooms bathrooms size sizeUnit furnishedStatus images agency agent agentDetails amenities status featured createdAt')
      .populate({
        path: 'agency',
        select: 'name logo website isFoundingSponsor tier brandColorHex corporateCallCenterPhone corporateWhatsapp masterPortalUrl corporateEmail',
        populate: { path: 'tier' }
      })
      .populate({
        path: 'agent',
        select: 'name phone email profileImage tier whatsapp licenseNumber isCoveredByAgency',
        populate: { path: 'tier' }
      })
      .populate('amenities', 'name')
      .lean();

    // Enrich with commercial Tier, uiStyle, and ctaAction
    const enrichedProperties = properties.map(doc => {
      const prop = formatPropertyData(doc, lang, favoriteSet.has(doc._id.toString()));
      const engagement = resolvePropertyEngagement(doc, lang, defaultTier1);
      prop.tier = engagement.tier;
      prop.uiStyle = engagement.uiStyle;
      prop.ctaAction = engagement.ctaAction;
      if (prop.agency && typeof prop.agency === 'object') {
        prop.agency.tier = engagement.tier;
        prop.agency.brandColorHex = doc.agency?.brandColorHex || null;
      }
      return prop;
    });

    // 3-Tier Commercial Ranking: Tier 3 (Founding Sponsor) -> Tier 2 (Pro) -> Tier 1 (Basic / Organic)
    sortPropertiesByTier(enrichedProperties, sortBy, currency);

    const totalProperties = enrichedProperties.length;

    // Pagination: if limit is provided, paginate; if not provided or 0, return all matching properties
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = (limit !== undefined && limit !== null && limit !== '') ? parseInt(limit, 10) : 0;

    let paginatedProperties = enrichedProperties;
    if (limitNum > 0) {
      const skip = (pageNum - 1) * limitNum;
      paginatedProperties = enrichedProperties.slice(skip, skip + limitNum);
    }

    if (pageNum === 1 && (location || finalPropType || listingType || price || finalMinPrice || finalMaxPrice || search || searchQuery)) {
      SearchLog.create({
        query: location ? location.trim() : (finalPropType ? String(finalPropType) : 'Filter Search'),
        location: location ? location.trim().toLowerCase() : '',
        filters: {
          bedrooms: (bedrooms !== undefined && bedrooms !== '') ? Number(bedrooms) : null,
          minPrice: finalMinPrice || null,
          maxPrice: finalMaxPrice || null,
          propertyType: Array.isArray(finalPropType) ? finalPropType[0] : (finalPropType || null),
        },
        resultsCount: totalProperties,
        userId: userId || null,
        searchType: 'manual',
      }).catch(err => console.error('Search log error:', err.message));
    }

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('propertiesRetrieved', lang),
      data: {
        language: lang === 'es' ? 'Spanish' : 'English',
        pagination: {
          total: totalProperties,
          page: pageNum,
          limit: limitNum > 0 ? limitNum : totalProperties,
          pages: limitNum > 0 ? Math.ceil(totalProperties / limitNum) : 1
        },
        count: paginatedProperties.length,
        properties: paginatedProperties,
      }
    });

  } catch (err) {
    console.error(`Get Properties Error: ${err.message}`);
    next(err);
  }
};

// const getProperties = async (req, res, next) => {
//   try {
//     const {
//       listingType,
//       location,
//       minPrice,
//       maxPrice,
//       propertyType,
//       constructionStatuses,
//       bedrooms,
//       bathrooms,
//       furnishedStatus,
//       amenities,
//       minSize,
//       maxSize,
//       page = 1,
//       limit = 10,
//       sortBy = 'newest'
//     } = req.body;

//     const query = { status: 'Active' };

//     // 1. Filter: Buy/Rent (listingType)
//     if (listingType) {
//       const formattedListingType = listingType.toUpperCase();
//       if (['RENT', 'BUY'].includes(formattedListingType)) {
//         query.listingType = formattedListingType;
//       }
//     }

//     // 2. Filter: Location (case-insensitive substring match on address, area, city, state)
//     if (location) {
//       const cleanLoc = location.trim();
//       query.$or = [
//         { 'location.address': { $regex: cleanLoc, $options: 'i' } },
//         { 'location.area': { $regex: cleanLoc, $options: 'i' } },
//         { 'location.city': { $regex: cleanLoc, $options: 'i' } },
//         { 'location.state': { $regex: cleanLoc, $options: 'i' } }
//       ];
//     }

//     // 3. Filter: Minimum and maximum price
//     if (minPrice !== undefined || maxPrice !== undefined) {
//       query.price = {};
//       if (minPrice !== undefined && minPrice !== '') {
//         query.price.$gte = Number(minPrice);
//       }
//       if (maxPrice !== undefined && maxPrice !== '') {
//         query.price.$lte = Number(maxPrice);
//       }
//       if (Object.keys(query.price).length === 0) {
//         delete query.price;
//       }
//     }

//     // 4. Filter: Property type
//     if (propertyType) {
//       let types = [];
//       if (Array.isArray(propertyType)) {
//         types = propertyType.map(t => String(t).trim().toUpperCase()).filter(Boolean);
//       } else if (typeof propertyType === 'string') {
//         types = propertyType
//           .split(',')
//           .map(t => t.trim().toUpperCase())
//           .filter(Boolean);
//       }
//       if (types.length > 0) {
//         query.propertyType = { $in: types };
//       }
//     }

//     // 5. Filter: Bedrooms
//     if (bedrooms !== undefined && bedrooms !== '') {
//       query.bedrooms = Number(bedrooms);
//     }

//     // 6. Filter: Bathrooms
//     if (bathrooms !== undefined && bathrooms !== '') {
//       query.bathrooms = Number(bathrooms);
//     }

//     // 7. Filter: Furnished
//     if (furnishedStatus) {
//       let statuses = [];
//       if (Array.isArray(furnishedStatus)) {
//         statuses = furnishedStatus.map(s => String(s).trim().toUpperCase()).filter(Boolean);
//       } else if (typeof furnishedStatus === 'string') {
//         statuses = furnishedStatus
//           .split(',')
//           .map(s => s.trim().toUpperCase())
//           .filter(Boolean);
//       }
//       if (statuses.length > 0) {
//         query.furnishedStatus = { $in: statuses };
//       }
//     }

//     // 8. Filter: Amenities (by name or ObjectId)
//     if (amenities) {
//       const mongoose = require('mongoose');
//       let amenityTerms = [];
//       if (Array.isArray(amenities)) {
//         amenityTerms = amenities.map(a => String(a).trim()).filter(Boolean);
//       } else if (typeof amenities === 'string') {
//         amenityTerms = amenities.split(',').map(a => a.trim()).filter(Boolean);
//       }

//       const amenityIds = [];
//       const nameQueries = [];

//       for (const term of amenityTerms) {
//         if (mongoose.Types.ObjectId.isValid(term)) {
//           amenityIds.push(term);
//         } else {
//           nameQueries.push(term);
//         }
//       }

//       if (nameQueries.length > 0) {
//         const orConditions = nameQueries.flatMap(term => [
//           { 'name.en': { $regex: term, $options: 'i' } },
//           { 'name.es': { $regex: term, $options: 'i' } }
//         ]);

//         const matchingAmenities = await Amenity.find({ $or: orConditions });
//         matchingAmenities.forEach(a => amenityIds.push(a._id));
//       }

//       if (amenityIds.length > 0) {
//         query.amenities = { $all: amenityIds };
//       } else if (amenityTerms.length > 0) {
//         // If they searched for amenities but none were found in DB, return 0 results cleanly
//         query.amenities = { $in: [] };
//       }
//     }

//     // 9. Filter: Area size (size)
//     if (minSize !== undefined || maxSize !== undefined) {
//       query.size = {};
//       if (minSize !== undefined && minSize !== '') {
//         query.size.$gte = Number(minSize);
//       }
//       if (maxSize !== undefined && maxSize !== '') {
//         query.size.$lte = Number(maxSize);
//       }
//       if (Object.keys(query.size).length === 0) {
//         delete query.size;
//       }
//     }

//     // Sorting options
//     let sort = {};
//     if (sortBy === 'price_asc') {
//       sort.price = 1;
//     } else if (sortBy === 'price_desc') {
//       sort.price = -1;
//     } else if (sortBy === 'oldest') {
//       sort.createdAt = 1;
//     } else {
//       sort.createdAt = -1; // default 'newest'
//     }

//     // Language identification from user's preferredLanguage or fallback
//     const lang = resolveLanguage(req);
//     const userId = req.user ? req.user._id : null;

//     const favoriteSet = new Set();
//     if (userId) {
//       const userFavorites = await FavoriteProperty.find({ user: userId }).select('property');
//       userFavorites.forEach(fav => {
//         if (fav.property) {
//           favoriteSet.add(fav.property.toString());
//         }
//       });
//     }

//     // Pagination
//     const pageNum = parseInt(page, 10) || 1;
//     const limitNum = parseInt(limit, 10) || 10;
//     const skip = (pageNum - 1) * limitNum;

//     // Fetch matching properties with total count for pagination
//     const totalProperties = await Property.countDocuments(query);
//     const properties = await Property.find(query)
//       .populate('amenities')
//       .sort(sort)
//       .skip(skip)
//       .limit(limitNum);

//     // Format & translate response fields
//     const formattedProperties = properties.map(doc =>
//       formatPropertyData(doc, lang, favoriteSet.has(doc._id.toString()))
//     );

//     const hasSearchFilter = location || bedrooms || minPrice || maxPrice || propertyType || listingType;

//     if (pageNum === 1 && hasSearchFilter) {
//       SearchLog.create({
//         query: location ? location.trim() : (propertyType ? String(propertyType) : 'Filter Search'),
//         location: location ? location.trim().toLowerCase() : '',
//         filters: {
//           bedrooms: (bedrooms !== undefined && bedrooms !== '') ? Number(bedrooms) : null,
//           minPrice: (minPrice !== undefined && minPrice !== '') ? Number(minPrice) : null,
//           maxPrice: (maxPrice !== undefined && maxPrice !== '') ? Number(maxPrice) : null,
//           propertyType: Array.isArray(propertyType) ? propertyType[0] : (propertyType || null),
//         },
//         resultsCount: totalProperties,
//         userId: userId || null,
//         searchType: 'manual',
//       }).catch(err => console.error('Search log error:', err.message));
//     }

//     res.status(200).json({
//       success: true,
//       message: getLocalizedMessage('propertiesRetrieved', lang),
//       data: {
//         language: lang === 'es' ? 'Spanish' : 'English',
//         pagination: {
//           total: totalProperties,
//           page: pageNum,
//           limit: limitNum,
//           pages: Math.ceil(totalProperties / limitNum)
//         },
//         count: formattedProperties.length,
//         properties: formattedProperties,
//       }
//     });

//   } catch (err) {
//     console.error(`Get Properties Error: ${err.message}`);
//     next(err);
//   }
// };

const getPropertyById = async (req, res, next) => {
  try {
    const propertyId = req.params.id;
    const lang = resolveLanguage(req);

    if (!mongoose.Types.ObjectId.isValid(propertyId)) {
      const error = new Error(
        lang === 'es'
          ? 'Formato de ID de propiedad no válido'
          : 'Invalid Property ID format'
      );
      error.statusCode = 400;
      return next(error);
    }

    // amenities optional hain, isliye property amenities ke bina bhi aa jayegi
    const propertyDoc = await Property.findOne({
      _id: propertyId,
      status: 'Active'
    })
      .populate({
        path: 'agency',
        select: 'name logo website isFoundingSponsor tier brandColorHex corporateCallCenterPhone corporateWhatsapp masterPortalUrl corporateEmail',
        populate: { path: 'tier' }
      })
      .populate({
        path: 'agent',
        select: 'name phone email profileImage tier whatsapp licenseNumber isCoveredByAgency',
        populate: { path: 'tier' }
      })
      .populate('amenities', 'name');

    if (!propertyDoc) {
      const error = new Error(getLocalizedMessage('propertyNotFound', lang));
      error.statusCode = 404;
      return next(error);
    }

    // Amenities absent/null ho to response me empty array mile
    if (!Array.isArray(propertyDoc.amenities)) {
      propertyDoc.amenities = [];
    }

    // Null/deleted amenity references remove karne ke liye
    propertyDoc.amenities = propertyDoc.amenities.filter(Boolean);

    const userId = req.user ? req.user._id : null;

    if (userId) {
      const user = await User.findById(userId);

      if (user) {
        if (!user.recentlyViewed) {
          user.recentlyViewed = [];
        }

        user.recentlyViewed = user.recentlyViewed.filter(
          (id) => id && id.toString() !== propertyId
        );

        user.recentlyViewed.unshift(propertyId);

        if (user.recentlyViewed.length > 20) {
          user.recentlyViewed = user.recentlyViewed.slice(0, 20);
        }

        await user.save();
      }
    }

    let isFav = false;

    if (userId) {
      const favoriteExists = await FavoriteProperty.findOne({
        user: userId,
        property: propertyId
      });

      isFav = !!favoriteExists;
    }

    const defaultTier1 = await Tier.findOne({ tierLevel: 1 });
    const prop = formatPropertyData(propertyDoc, lang, isFav);

    // Agar property ka agent h to agent ka tier plan, agar agent null h to agency ka tier plan
    let finalTier = null;
    if (propertyDoc.agent && propertyDoc.agent.tier) {
      if (propertyDoc.agent.tier.tierLevel) {
        finalTier = propertyDoc.agent.tier;
      } else {
        finalTier = await Tier.findById(propertyDoc.agent.tier);
      }
    } else if (propertyDoc.agency && propertyDoc.agency.tier) {
      if (propertyDoc.agency.tier.tierLevel) {
        finalTier = propertyDoc.agency.tier;
      } else {
        finalTier = await Tier.findById(propertyDoc.agency.tier);
      }
    }

    if (!finalTier) {
      finalTier = defaultTier1;
    }

    prop.tier = finalTier;
    // prop.uiStyle = engagement.uiStyle;
    // prop.ctaAction = engagement.ctaAction;
    if (prop.agency && typeof prop.agency === 'object') {
      delete prop.agency.tier;
      prop.agency.brandColorHex = propertyDoc.agency?.brandColorHex || null;
    }

    // Reputation & Claim calculation based on agent presence and tier
    if (!propertyDoc.agent) {
      prop.reputation = {
        isClaimed: false,
        isLocked: true,
        isBlurred: true,
        totalReviews: 0,
        averageRating: null,
        badge: 'UNCLAIMED_PROFILE',
        claimAction: {
          canClaim: true,
          title: lang === 'es' ? 'Perfil no reclamado' : 'Unclaimed Agent Profile',
          message:
            lang === 'es'
              ? 'Este asesor aún no ha activado su perfil en KleverProp. ¿Eres este asesor? Reclama este perfil para recibir clientes y gestionar opiniones.'
              : 'This agent has not activated their profile on KleverProp yet. Are you this agent? Claim this profile to receive leads and manage reviews.',
          cta: lang === 'es' ? 'Reclamar Perfil' : 'Claim Profile',
        },
      };
    } else {
      const agentTierLevel = (propertyDoc.agent.tier && propertyDoc.agent.tier.tierLevel) || finalTier.tierLevel || 1;
      const isTier1 = (agentTierLevel === 1);

      const reviewStats = await Review.aggregate([
        { $match: { agent: propertyDoc.agent._id, status: 'approved' } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            avgRating: { $avg: '$rating' },
          },
        },
      ]);

      const totalReviews = reviewStats[0]?.count || 0;
      const rawAvg = reviewStats[0]?.avgRating ? Number(reviewStats[0].avgRating.toFixed(1)) : 0;

      prop.reputation = {
        isClaimed: true,
        isLocked: isTier1,
        isBlurred: isTier1,
        totalReviews,
        averageRating: isTier1 ? null : rawAvg,
        displayedRating: isTier1 ? '•••••' : rawAvg,
        badge: isTier1 ? 'LOCKED_REPUTATION' : 'VERIFIED_REPUTATION',
        claimAction: isTier1
          ? {
            canClaim: false,
            title: lang === 'es' ? 'Opiniones Protegidas' : 'Protected Reputation',
            message:
              lang === 'es'
                ? 'Actualiza a Pro para desbloquear opiniones verificadas de clientes.'
                : 'Upgrade to Pro to unlock verified client reviews.',
            cta: lang === 'es' ? 'Actualizar a Pro' : 'Upgrade to Pro',
          }
          : null,
      };
    }

    const resolvedAgentId = propertyDoc.agent
      ? (propertyDoc.agent._id ? propertyDoc.agent._id.toString() : propertyDoc.agent.toString())
      : null;

    // Remove agent and agentId from property object as agentId is provided at the data root level
    delete prop.agent;
    delete prop.agentId;

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('propertyDetailsRetrieved', lang),
      data: {
        language: lang === 'es' ? 'Spanish' : 'English',
        agentId: resolvedAgentId,
        property: prop
      }
    });
  } catch (err) {
    console.error(`Get Property By ID Error: ${err.message}`);
    next(err);
  }
};

const getRecentlyViewed = async (req, res, next) => {
  try {
    const lang = resolveLanguage(req);
    const userId = req.user?._id || req.user?.id;

    // 1. Fetch user and populate recentlyViewed (only Active properties) with agency and agent
    const user = await User.findById(userId).populate({
      path: 'recentlyViewed',
      match: { status: 'Active' },
      populate: [
        {
          path: 'agency',
          select: 'name logo website isFoundingSponsor tier agentSeatsLimit coveredAgentsCount',
          populate: {
            path: 'tier'
          }
        },
        {
          path: 'agent',
          select: 'name phone email profileImage'
        }
      ]
    });

    if (!user) {
      const error = new Error(lang === 'es' ? 'Usuario no encontrado' : 'User not found');
      error.statusCode = 404;
      return next(error);
    }

    // 2. Check favorites for those properties or unFavorite 
    const favoriteSet = new Set();
    const userFavorites = await FavoriteProperty.find({ user: userId }).select('property');
    userFavorites.forEach(fav => {
      if (fav.property) {
        favoriteSet.add(fav.property.toString());
      }
    });

    // Filter out null/undefined elements in case properties were deleted from the DB
    let validProperties = (user.recentlyViewed || []).filter(Boolean);

    // Optional query pagination / limit
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const totalCount = validProperties.length;

    if (req.query.page || req.query.limit) {
      const startIndex = (page - 1) * limit;
      validProperties = validProperties.slice(startIndex, startIndex + limit);
    }

    // 3. Format/translate each property in recentlyViewed
    const defaultTier1 = await Tier.findOne({ tierLevel: 1 });
    const formattedProperties = validProperties.map(doc => {
      const prop = formatPropertyData(doc, lang, favoriteSet.has(doc._id.toString()));
      if (prop) {
        const agencyTier = (doc.agency && doc.agency.tier && typeof doc.agency.tier === 'object') ? doc.agency.tier : null;
        const finalTier = agencyTier || defaultTier1;
        prop.tier = finalTier;
        if (prop.agency && typeof prop.agency === 'object') {
          prop.agency.tier = finalTier;
        }
      }
      return prop;
    });

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('recentlyViewedRetrieved', lang),
      data: {
        language: lang === 'es' ? 'Spanish' : 'English',
        pagination: {
          total: totalCount,
          page,
          limit,
          pages: Math.ceil(totalCount / limit) || 1,
        },
        count: formattedProperties.length,
        properties: formattedProperties,
      }
    });

  } catch (err) {
    console.error(`Get Recently Viewed Error: ${err.message}`);
    next(err);
  }
};

const clearRecentlyViewed = async (req, res, next) => {
  try {
    const lang = resolveLanguage(req);
    const userId = req.user?._id || req.user?.id;
    const user = await User.findById(userId);
    if (!user) {
      const error = new Error(lang === 'es' ? 'Usuario no encontrado' : 'User not found');
      error.statusCode = 404;
      return next(error);
    }

    user.recentlyViewed = [];
    await user.save();

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('recentlyViewedCleared', lang),
      data: null
    });

  } catch (err) {
    console.error(`Clear Recently Viewed Error: ${err.message}`);
    next(err);
  }
};

const deleteRecentlyViewedById = async (req, res, next) => {
  try {
    const lang = resolveLanguage(req);
    const { id } = req.params;
    const userId = req.user?.id || req.user?._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error(getLocalizedMessage('invalidPropertyId', lang));
      error.statusCode = 400;
      return next(error);
    }

    const user = await User.findById(userId);
    if (!user) {
      const error = new Error(lang === 'es' ? 'Usuario no encontrado' : 'User not found');
      error.statusCode = 404;
      return next(error);
    }

    const itemExists = (user.recentlyViewed || []).some(
      (viewedId) => viewedId && viewedId.toString() === id.toString()
    );

    if (!itemExists) {
      const error = new Error(getLocalizedMessage('recentlyViewedNotFound', lang));
      error.statusCode = 404;
      return next(error);
    }

    user.recentlyViewed = (user.recentlyViewed || []).filter(
      (viewedId) => viewedId && viewedId.toString() !== id.toString()
    );
    await user.save();

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('recentlyViewedItemDeleted', lang),
      data: {
        id,
      },
    });
  } catch (err) {
    console.error(`Delete Recently Viewed By ID Error: ${err.message}`);
    next(err);
  }
};

// =========================================================================
// 100% PURE AI PROPERTY COMPARISON (NO MANUAL RULES)
// Powered by Centralized Unified AI Service (Gemini Candidates + OpenAI Fallback)
// =========================================================================
const generateAIPropertyComparison = async (properties, lang = 'en') => {
  if (!Array.isArray(properties) || properties.length < 2) return null;
  const isEs = (lang === 'es');

  // Format rich property context for pure LLM analysis
  const propSummaries = properties.map((p, idx) => {
    const loc = [p.location?.address, p.location?.area, p.location?.city].filter(Boolean).join(', ') || 'Dominican Republic';
    const priceUsd = p.price?.usd ? `$${p.price.usd.toLocaleString()}` : (p.price?.dop ? `RD$${p.price.dop.toLocaleString()}` : 'Price on request');
    const sizeStr = p.size ? `${p.size} m²` : 'Not specified';
    const beds = p.bedrooms != null ? `${p.bedrooms} Bedrooms` : 'N/A';
    const baths = p.bathrooms != null ? `${p.bathrooms} Bathrooms` : 'N/A';
    const amenities = Array.isArray(p.amenities) && p.amenities.length > 0
      ? p.amenities.map(a => a?.name || a).slice(0, 8).join(', ')
      : 'None listed';
    const agencyName = p.agency?.name || 'Verified Partner';
    const desc = (typeof p.description === 'object' ? (p.description[lang] || p.description.en || p.description.es) : p.description) || '';

    return `### Property Option ${idx + 1} (ID: "${p._id}"):
- Title: "${p.title}"
- Property Type: ${p.propertyType || 'Residential'} (${p.listingType})
- Location: ${loc}
- Price: ${priceUsd}
- Size / Area: ${sizeStr}
- Layout: ${beds}, ${baths}
- Key Amenities: ${amenities}
- Agency / Seller: ${agencyName}
- Description Excerpt: "${desc.slice(0, 250)}"`;
  }).join('\n\n');

  const prompt = `You are a licensed, expert real estate investment consultant for KleverProp in the Dominican Republic.
A client has selected the following ${properties.length} properties to compare and needs your professional, unbiased, in-depth evaluation.
Language Requirement: You MUST generate your entire response in ${isEs ? 'SPANISH' : 'ENGLISH'}.

${propSummaries}

TASK:
1. "summary": Write an intelligent, 3-4 sentence comparative analysis contrasting their locations, lifestyle fit, value proposition, and long-term investment potential.
2. "propertyHighlights": For EACH property above, provide:
   - "propertyId": Exact property ID string.
   - "title": Property title.
   - "standoutFeature": One compelling sentence highlighting its most unique advantage (e.g. prime connectivity, expansive terrace, high rental yield potential).
   - "pros": Array of 2-3 genuine, specific advantages based on its data.
   - "cons": Array of 1-2 honest drawbacks, trade-offs, or buyer considerations.
3. "verdict": Real estate buying recommendation:
   - "bestOverall": An object with "propertyId", "title", and detailed "reason" explaining why it is the superior all-round choice for living or investing.
   - "bestValue": An object with "propertyId", "title", and detailed "reason" explaining why it offers the best financial return, space-to-price ratio, or affordability.

Return ONLY a valid JSON object matching this schema:
{
  "summary": "...",
  "propertyHighlights": [
    {
      "propertyId": "...",
      "title": "...",
      "standoutFeature": "...",
      "pros": ["...", "..."],
      "cons": ["..."]
    }
  ],
  "verdict": {
    "bestOverall": {
      "propertyId": "...",
      "title": "...",
      "reason": "..."
    },
    "bestValue": {
      "propertyId": "...",
      "title": "...",
      "reason": "..."
    }
  }
}`;

  const res = await generateStructuredJson({
    prompt,
    systemInstruction: `You are an expert real estate consultant. Return valid JSON only in ${isEs ? 'SPANISH' : 'ENGLISH'}.`,
    maxTokens: 950,
    temperature: 0.2,
    timeoutMs: 12000
  });

  return { data: res.data, error: res.error };
};

const compareProperties = async (req, res, next) => {
  try {
    let ids = [];

    if (req.body.propertyIds) {
      ids = req.body.propertyIds;
    } else if (req.query.propertyIds) {
      ids = req.query.propertyIds;
    } else if (req.query.ids) {
      ids = req.query.ids;
    }

    if (typeof ids === 'string') {
      ids = ids
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    }

    if (!Array.isArray(ids) || ids.length < 2) {
      const error = new Error(
        'Please provide at least 2 property IDs to compare'
      );
      error.statusCode = 400;
      return next(error);
    }

    if (ids.length > 5) {
      const error = new Error(
        'You can compare a maximum of 5 properties at a time'
      );
      error.statusCode = 400;
      return next(error);
    }

    const mongoose = require('mongoose');

    for (const id of ids) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        const error = new Error(`Invalid property ID format: ${id}`);
        error.statusCode = 400;
        return next(error);
      }
    }

    const defaultTier1 = await Tier.findOne({ tierLevel: 1 });

    // Active properties fetch karo.
    // Amenities na hone par bhi property return hogi.
    const properties = await Property.find({
      _id: { $in: ids },
      status: 'Active'
    })
      .populate({
        path: 'agency',
        select: 'name logo website isFoundingSponsor tier agentSeatsLimit coveredAgentsCount',
        populate: { path: 'tier' }
      })
      .populate('agent', 'name phone email profileImage')
      .populate('amenities', 'name');

    // IDs ke requested order me properties rakho
    const orderedProperties = ids
      .map((id) =>
        properties.find((property) => property._id.toString() === id)
      )
      .filter(Boolean);

    // Amenities field missing/null ho to empty array set hoga.
    // Deleted amenities ke null references bhi remove ho jayenge.
    orderedProperties.forEach((property) => {
      if (!Array.isArray(property.amenities)) {
        property.amenities = [];
      }

      property.amenities = property.amenities.filter(Boolean);
    });

    const lang = resolveLanguage(req);

    const userId = req.user ? req.user._id : null;

    const favoriteSet = new Set();

    if (userId) {
      const userFavorites = await FavoriteProperty.find({
        user: userId
      }).select('property');

      userFavorites.forEach((fav) => {
        if (fav.property) {
          favoriteSet.add(fav.property.toString());
        }
      });
    }

    const formattedProperties = orderedProperties.map((doc) => {
      const prop = formatPropertyData(
        doc,
        lang,
        favoriteSet.has(doc._id.toString())
      );
      if (prop) {
        const agencyTier = (doc.agency && doc.agency.tier && typeof doc.agency.tier === 'object') ? doc.agency.tier : null;
        const finalTier = agencyTier || defaultTier1;
        prop.tier = finalTier;
        if (prop.agency && typeof prop.agency === 'object') {
          prop.agency.tier = finalTier;
        }
      }
      return prop;
    });

    // Generate AI Comparative Summary, Pros/Cons, and Best Choice Verdict
    const aiResult = await generateAIPropertyComparison(formattedProperties, lang);

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('comparePropertiesRetrieved', lang),
      data: {
        language: lang === 'es' ? 'Spanish' : 'English',
        aiComparison: aiResult?.data || null,
        ...(aiResult?.error ? { aiDiagnostics: aiResult.error } : {}),
        properties: formattedProperties
      }
    });
  } catch (err) {
    console.error(`Compare Properties Error: ${err.message}`);
    next(err);
  }
};

const getFilterOptions = async (req, res, next) => {
  try {
    // Identify target language from user's preferredLanguage or fallback
    const lang = resolveLanguage(req);

    // 3. Map config options using language
    const formattedListingTypes = Object.keys(languageMappings.listingType).map(key => ({
      value: key,
      label: languageMappings.listingType[key][lang] || key
    }));

    const formattedPropertyTypes = Object.keys(languageMappings.propertyType).map(key => ({
      value: key,
      label: languageMappings.propertyType[key][lang] || key
    }));

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('filterOptionsRetrieved', lang),
      data: {
        language: lang === 'es' ? 'Spanish' : 'English',
        listingTypes: formattedListingTypes,
        propertyTypes: formattedPropertyTypes
      }
    });

  } catch (err) {
    console.error(`Get Filter Options Error: ${err.message}`);
    next(err);
  }
};

// ==================== ADMIN PROPERTY CONTROLLERS ====================

const getAllPropertiesAdmin = async (req, res, next) => {
  try {
    const {
      search,
      status,
      listingType,
      propertyType,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const query = {};

    // 1. Status Filter (Admin can filter by Active, Inactive, or see all)
    if (status && status !== 'all') {
      const formattedStatus = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
      if (['Active', 'Inactive'].includes(formattedStatus)) {
        query.status = formattedStatus;
      }
    }

    // 2. Listing Type Filter
    if (listingType) {
      const formattedListingType = listingType.toUpperCase();
      if (['RENT', 'BUY'].includes(formattedListingType)) {
        query.listingType = formattedListingType;
      }
    }

    // 3. Property Type Filter
    if (propertyType) {
      const formattedPropType = propertyType.toUpperCase();
      if (['APARTMENT', 'HOUSE', 'PLOT', 'COMMERCIAL'].includes(formattedPropType)) {
        query.propertyType = formattedPropType;
      }
    }

    // 4. Search filter across titles, location, and agent details
    if (search && search.trim() !== '') {
      const cleanSearch = search.trim();
      query.$or = [
        { 'title.en': { $regex: cleanSearch, $options: 'i' } },
        { 'title.es': { $regex: cleanSearch, $options: 'i' } },
        { 'location.city': { $regex: cleanSearch, $options: 'i' } },
        { 'location.area': { $regex: cleanSearch, $options: 'i' } },
        { 'location.address': { $regex: cleanSearch, $options: 'i' } },
        { 'agentDetails.name': { $regex: cleanSearch, $options: 'i' } },
        { 'agentDetails.phone': { $regex: cleanSearch, $options: 'i' } },
      ];
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const skip = (pageNum - 1) * limitNum;

    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const totalProperties = await Property.countDocuments(query);
    const properties = await Property.find(query)
      .populate('agency', 'name logo website isFoundingSponsor')
      .populate('agent', 'name phone email profileImage')
      .sort(sortObj)
      .skip(skip)
      .limit(limitNum);

    res.status(200).json({
      success: true,
      message: 'Admin properties retrieved successfully',
      data: {
        total: totalProperties,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(totalProperties / limitNum),
        count: properties.length,
        properties,
      },
    });
  } catch (err) {
    console.error(`Admin Get All Properties Error: ${err.message}`);
    next(err);
  }
};

const getPropertyByIdAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error('Invalid Property ID format');
      error.statusCode = 400;
      return next(error);
    }

    const property = await Property.findById(id)
      .populate('agency', 'name logo website isFoundingSponsor')
      .populate('agent', 'name phone email profileImage');
    if (!property) {
      const error = new Error('Property not found');
      error.statusCode = 404;
      return next(error);
    }

    res.status(200).json({
      success: true,
      message: 'Property details retrieved successfully',
      data: {
        property,
      },
    });
  } catch (err) {
    console.error(`Admin Get Property By ID Error: ${err.message}`);
    next(err);
  }
};

const updatePropertyStatus = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error('Invalid Property ID format');
      error.statusCode = 400;
      return next(error);
    }

    const property = await Property.findById(id);
    if (!property) {
      const error = new Error('Property not found');
      error.statusCode = 404;
      return next(error);
    }

    // If status provided in body, set it; otherwise toggle
    if (req.body.status) {
      const s = String(req.body.status).trim();
      const formattedStatus = (s.toLowerCase() === 'inactive') ? 'Inactive' : 'Active';
      property.status = formattedStatus;
    } else {
      property.status = property.status === 'Active' ? 'Inactive' : 'Active';
    }

    await property.save();

    // Invalidate Redis property cache
    clearPropertyCaches(property._id);

    res.status(200).json({
      success: true,
      message: `Property status updated to ${property.status} successfully`,
      data: {
        id: property._id,
        status: property.status,
        property,
      },
    });
  } catch (err) {
    console.error(`Update Property Status Error: ${err.message}`);
    next(err);
  }
};

const updateProperty = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      deleteUploadedFiles(req.files);
      const error = new Error('Invalid Property ID format');
      error.statusCode = 400;
      return next(error);
    }

    const property = await Property.findById(id);
    if (!property) {
      deleteUploadedFiles(req.files);
      const error = new Error('Property not found');
      error.statusCode = 404;
      return next(error);
    }

    // 1. Normalize Title (if provided)
    if (req.body.title || req.body.enTitle || req.body.esTitle || req.body['title.en'] || req.body['title.es']) {
      let titleObj = { ...(property.title ? property.title.toObject() : {}) };
      if (typeof req.body.title === 'string') {
        try {
          const parsed = JSON.parse(req.body.title);
          if (typeof parsed === 'object' && parsed !== null) {
            titleObj = { ...titleObj, ...parsed };
          } else {
            titleObj.en = req.body.title;
          }
        } catch {
          titleObj.en = req.body.title;
        }
      } else if (typeof req.body.title === 'object' && req.body.title !== null) {
        titleObj = { ...titleObj, ...req.body.title };
      }
      if (req.body.enTitle) titleObj.en = req.body.enTitle;
      if (req.body.esTitle) titleObj.es = req.body.esTitle;
      if (req.body['title.en']) titleObj.en = req.body['title.en'];
      if (req.body['title.es']) titleObj.es = req.body['title.es'];
      req.body.title = {
        en: String(titleObj.en || '').trim(),
        es: String(titleObj.es || '').trim(),
      };
    }

    // 2. Normalize Description (if provided)
    if (req.body.description || req.body.enDescription || req.body.esDescription || req.body['description.en'] || req.body['description.es']) {
      let descObj = { ...(property.description ? property.description.toObject() : {}) };
      if (typeof req.body.description === 'string') {
        try {
          const parsed = JSON.parse(req.body.description);
          if (typeof parsed === 'object' && parsed !== null) {
            descObj = { ...descObj, ...parsed };
          } else {
            descObj.en = req.body.description;
          }
        } catch {
          descObj.en = req.body.description;
        }
      } else if (typeof req.body.description === 'object' && req.body.description !== null) {
        descObj = { ...descObj, ...req.body.description };
      }
      if (req.body.enDescription) descObj.en = req.body.enDescription;
      if (req.body.esDescription) descObj.es = req.body.esDescription;
      if (req.body['description.en']) descObj.en = req.body['description.en'];
      if (req.body['description.es']) descObj.es = req.body['description.es'];
      req.body.description = {
        en: String(descObj.en || '').trim(),
        es: String(descObj.es || '').trim(),
      };
    }

    // 3. Normalize Location (if provided)
    if (req.body.location || req.body.address || req.body.city || req.body.area || req.body.state || req.body.country || req.body.pincode || req.body['location.city']) {
      let locObj = { ...(property.location ? property.location.toObject() : {}) };
      if (typeof req.body.location === 'string') {
        try {
          const parsed = JSON.parse(req.body.location);
          if (typeof parsed === 'object' && parsed !== null) {
            locObj = { ...locObj, ...parsed };
          }
        } catch { }
      } else if (typeof req.body.location === 'object' && req.body.location !== null) {
        locObj = { ...locObj, ...req.body.location };
      }
      if (req.body.address) locObj.address = req.body.address;
      if (req.body.area) locObj.area = req.body.area;
      if (req.body.city) locObj.city = req.body.city;
      if (req.body.state) locObj.state = req.body.state;
      if (req.body.country) locObj.country = req.body.country;
      if (req.body.pincode) locObj.pincode = req.body.pincode;

      if (req.body['location.address']) locObj.address = req.body['location.address'];
      if (req.body['location.area']) locObj.area = req.body['location.area'];
      if (req.body['location.city']) locObj.city = req.body['location.city'];
      if (req.body['location.state']) locObj.state = req.body['location.state'];
      if (req.body['location.country']) locObj.country = req.body['location.country'];
      if (req.body['location.pincode']) locObj.pincode = req.body['location.pincode'];

      if (req.body.latitude || req.body.longitude || req.body['location.coordinates.latitude'] || req.body['location.coordinates.longitude']) {
        if (!locObj.coordinates) locObj.coordinates = {};
        const lat = req.body.latitude || req.body['location.coordinates.latitude'] || locObj.coordinates.latitude;
        const lng = req.body.longitude || req.body['location.coordinates.longitude'] || locObj.coordinates.longitude;
        if (lat !== undefined && lat !== null && lat !== '') locObj.coordinates.latitude = Number(lat);
        if (lng !== undefined && lng !== null && lng !== '') locObj.coordinates.longitude = Number(lng);
      }
      req.body.location = locObj;
    }

    // 4. Normalize Agent Details (if provided)
    if (req.body.agentDetails || req.body.agentName || req.body.agentPhone || req.body.agentEmail || req.body.ownerContact) {
      let agentObj = { ...(property.agentDetails ? property.agentDetails.toObject() : {}) };
      const rawAgent = req.body.agentDetails || req.body.ownerContact;
      if (typeof rawAgent === 'string') {
        try {
          const parsed = JSON.parse(rawAgent);
          if (typeof parsed === 'object' && parsed !== null) {
            agentObj = { ...agentObj, ...parsed };
          }
        } catch { }
      } else if (typeof rawAgent === 'object' && rawAgent !== null) {
        agentObj = { ...agentObj, ...rawAgent };
      }
      if (req.body.agentName) agentObj.name = req.body.agentName;
      if (req.body.agentPhone) agentObj.phone = req.body.agentPhone;
      if (req.body.agentEmail) agentObj.email = req.body.agentEmail;
      if (req.body['agentDetails.name']) agentObj.name = req.body['agentDetails.name'];
      if (req.body['agentDetails.phone']) agentObj.phone = req.body['agentDetails.phone'];
      if (req.body['agentDetails.email']) agentObj.email = req.body['agentDetails.email'];
      req.body.agentDetails = agentObj;
    }

    // 5. Normalize Status (if provided)
    if (req.body.status !== undefined) {
      const s = String(req.body.status).trim();
      req.body.status = (s.toLowerCase() === 'inactive') ? 'Inactive' : 'Active';
    }

    // Normalize Price (if provided)
    if (
      req.body.price !== undefined ||
      req.body['price.dop'] !== undefined ||
      req.body['price.usd'] !== undefined ||
      req.body['price.eur'] !== undefined ||
      req.body['price[dop]'] !== undefined ||
      req.body['price[usd]'] !== undefined ||
      req.body['price[eur]'] !== undefined ||
      req.body.dop !== undefined ||
      req.body.usd !== undefined ||
      req.body.eur !== undefined ||
      req.body.DOP !== undefined ||
      req.body.USD !== undefined ||
      req.body.EUR !== undefined
    ) {
      let priceObj = { ...(property.price ? (typeof property.price.toObject === 'function' ? property.price.toObject() : property.price) : {}) };
      if (typeof req.body.price === 'string') {
        try {
          const parsed = JSON.parse(req.body.price);
          if (typeof parsed === 'object' && parsed !== null) {
            priceObj = { ...priceObj, ...parsed };
          }
        } catch { }
      } else if (typeof req.body.price === 'object' && req.body.price !== null) {
        priceObj = { ...priceObj, ...req.body.price };
      }

      if (req.body['price.dop'] !== undefined) priceObj.dop = req.body['price.dop'];
      if (req.body['price.usd'] !== undefined) priceObj.usd = req.body['price.usd'];
      if (req.body['price.eur'] !== undefined) priceObj.eur = req.body['price.eur'];
      if (req.body['price[dop]'] !== undefined) priceObj.dop = req.body['price[dop]'];
      if (req.body['price[usd]'] !== undefined) priceObj.usd = req.body['price[usd]'];
      if (req.body['price[eur]'] !== undefined) priceObj.eur = req.body['price[eur]'];
      if (req.body.dop !== undefined) priceObj.dop = req.body.dop;
      if (req.body.usd !== undefined) priceObj.usd = req.body.usd;
      if (req.body.eur !== undefined) priceObj.eur = req.body.eur;
      if (req.body.DOP !== undefined) priceObj.dop = req.body.DOP;
      if (req.body.USD !== undefined) priceObj.usd = req.body.USD;
      if (req.body.EUR !== undefined) priceObj.eur = req.body.EUR;

      if (priceObj.dop !== undefined && priceObj.dop !== null && priceObj.dop !== '') {
        priceObj.dop = Number(priceObj.dop);
      }
      if (priceObj.usd !== undefined && priceObj.usd !== null && priceObj.usd !== '') {
        priceObj.usd = Number(priceObj.usd);
      }
      if (priceObj.eur !== undefined && priceObj.eur !== null && priceObj.eur !== '') {
        priceObj.eur = Number(priceObj.eur);
      }

      req.body.price = priceObj;
    }

    // Normalize Construction Status (if provided)
    if (req.body.constructionStatus !== undefined) {
      const cs = String(req.body.constructionStatus).trim().toLowerCase();
      if (cs.includes('off') || cs.includes('plan') || cs.includes('construction')) {
        req.body.constructionStatus = 'Off-plan';
      } else if (cs.includes('brand') || cs.includes('new') || cs.includes('estrenar')) {
        req.body.constructionStatus = 'Brand New';
      } else if (cs.includes('re') || cs.includes('sale') || cs.includes('used') || cs.includes('usado')) {
        req.body.constructionStatus = 'Resale';
      }
    }

    // Normalize isShortTermRentalAllowed (if provided)
    if (req.body.isShortTermRentalAllowed !== undefined) {
      if (typeof req.body.isShortTermRentalAllowed === 'string') {
        req.body.isShortTermRentalAllowed = req.body.isShortTermRentalAllowed.toLowerCase().trim() === 'true' || req.body.isShortTermRentalAllowed.trim() === '1';
      } else {
        req.body.isShortTermRentalAllowed = Boolean(req.body.isShortTermRentalAllowed);
      }
    }

    // 6. Normalize Bedrooms & Bathrooms
    if (req.body.bedrooms !== undefined) {
      req.body.bedrooms = (req.body.bedrooms === '' || req.body.bedrooms === null) ? null : Number(req.body.bedrooms);
    }
    if (req.body.bathrooms !== undefined) {
      req.body.bathrooms = (req.body.bathrooms === '' || req.body.bathrooms === null) ? null : Number(req.body.bathrooms);
    }

    // 7. Normalize Amenities (if provided)
    if (req.body.amenities !== undefined) {
      let amenities = [];
      if (Array.isArray(req.body.amenities)) {
        amenities = req.body.amenities;
      } else if (typeof req.body.amenities === 'string') {
        const trimmed = req.body.amenities.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          try {
            amenities = JSON.parse(trimmed);
          } catch {
            amenities = trimmed.split(',').map(item => item.trim()).filter(Boolean);
          }
        } else {
          amenities = trimmed.split(',').map(item => item.trim()).filter(Boolean);
        }
      }
      req.body.amenities = amenities;
    }

    // 8. Normalize Images (handle existing images + new uploads)
    let currentImages = property.images || [];
    if (req.body.existingImages !== undefined) {
      if (Array.isArray(req.body.existingImages)) {
        currentImages = req.body.existingImages;
      } else if (typeof req.body.existingImages === 'string') {
        try {
          currentImages = JSON.parse(req.body.existingImages);
        } catch {
          currentImages = req.body.existingImages.split(',').map(s => s.trim()).filter(Boolean);
        }
      }
    }

    // Uploaded images from multer
    let uploadedImages = [];
    if (req.files && req.files.length > 0) {
      uploadedImages = req.files.map(file => `/uploads/${file.filename}`);
    }
    req.body.images = [...currentImages, ...uploadedImages];

    // Update allowed fields
    const allowedFields = [
      'title', 'description', 'location', 'propertyType', 'listingType',
      'price', 'bedrooms', 'bathrooms', 'size', 'sizeUnit',
      'furnishedStatus', 'amenities', 'images', 'source', 'agentDetails', 'status',
      'constructionStatus', 'isShortTermRentalAllowed'
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        property[field] = req.body[field];
      }
    });

    const updatedProperty = await property.save();

    // Invalidate Redis property cache
    clearPropertyCaches(id);

    res.status(200).json({
      success: true,
      message: 'Property updated successfully',
      data: {
        property: updatedProperty,
      },
    });
  } catch (err) {
    deleteUploadedFiles(req.files);
    console.error(`Update Property Error: ${err.message}`);
    next(err);
  }
};

const deleteProperty = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error('Invalid Property ID format');
      error.statusCode = 400;
      return next(error);
    }

    const property = await Property.findById(id);
    if (!property) {
      const error = new Error('Property not found');
      error.statusCode = 404;
      return next(error);
    }

    // Delete image files from disk
    if (property.images && property.images.length > 0) {
      property.images.forEach(imgPath => {
        if (imgPath && imgPath.startsWith('/uploads/')) {
          const filePath = path.join(__dirname, '..', imgPath);
          if (fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath);
            } catch (unlinkErr) {
              console.error(`Failed to delete property image file: ${unlinkErr.message}`);
            }
          }
        }
      });
    }

    // Cleanup favorites associated with this property
    await FavoriteProperty.deleteMany({ property: id });

    // Cleanup recentlyViewed references in User model
    await User.updateMany(
      { recentlyViewed: id },
      { $pull: { recentlyViewed: id } }
    );

    // Delete property document
    await Property.findByIdAndDelete(id);

    // Invalidate Redis property cache
    clearPropertyCaches(id);

    res.status(200).json({
      success: true,
      message: 'Property deleted successfully',
      data: {
        id,
      },
    });
  } catch (err) {
    console.error(`Delete Property Error: ${err.message}`);
    next(err);
  }
};

// Helper to detect Dominican Republic location from text & URL
const detectDRLocation = (text, url) => {
  const combined = `${text || ''} ${url || ''}`.toLowerCase();

  if (combined.includes('punta cana') || combined.includes('vista cana') || combined.includes('bavaro') || combined.includes('bávaro')) {
    let area = 'Punta Cana';
    if (combined.includes('brisas de punta cana')) area = 'Brisas de Punta Cana';
    else if (combined.includes('vista cana')) area = 'Vista Cana';
    else if (combined.includes('white sands')) area = 'White Sands';
    return { city: 'Punta Cana', area, state: 'La Altagracia' };
  }
  if (combined.includes('metro country club') || combined.includes('juan dolio')) {
    return { city: 'Juan Dolio', area: 'Metro Country Club', state: 'San Pedro de Macorís' };
  }
  if (combined.includes('playa nueva romana') || combined.includes('la romana')) {
    return { city: 'La Romana', area: 'Playa Nueva Romana', state: 'La Romana' };
  }
  if (combined.includes('san cristóbal') || combined.includes('san cristobal')) {
    return { city: 'San Cristóbal', area: 'Edén', state: 'San Cristóbal' };
  }
  if (combined.includes('bonao')) {
    return { city: 'Bonao', area: 'Bonao', state: 'Monseñor Nouel' };
  }
  if (combined.includes('los álamos') || combined.includes('los alamos') || combined.includes('santiago')) {
    return { city: 'Santiago', area: 'Los Álamos', state: 'Santiago' };
  }
  if (combined.includes('torre alta') || combined.includes('puerto plata')) {
    return { city: 'Puerto Plata', area: 'Torre Alta', state: 'Puerto Plata' };
  }
  if (combined.includes('arroyo hondo')) {
    return { city: 'Santo Domingo', area: 'Altos de Arroyo Hondo', state: 'Distrito Nacional' };
  }
  if (combined.includes('mirador del oeste') || combined.includes('mirador oeste')) {
    return { city: 'Santo Domingo', area: 'Mirador del Oeste', state: 'Santo Domingo Oeste' };
  }
  if (combined.includes('alameda oeste') || combined.includes('alameda')) {
    return { city: 'Santo Domingo', area: 'Alameda Oeste', state: 'Santo Domingo Oeste' };
  }
  if (combined.includes('costa caribe')) {
    return { city: 'Santo Domingo', area: 'Costa Caribe', state: 'Distrito Nacional' };
  }
  if (combined.includes('rosmil')) {
    return { city: 'Santo Domingo', area: 'Rosmil', state: 'Distrito Nacional' };
  }
  if (combined.includes('isabel villas')) {
    return { city: 'Santo Domingo', area: 'Isabel Villas', state: 'Distrito Nacional' };
  }
  if (combined.includes('puerta de hierro')) {
    return { city: 'Santo Domingo', area: 'Puerta de Hierro', state: 'Distrito Nacional' };
  }
  if (combined.includes('los rios') || combined.includes('los ríos')) {
    return { city: 'Santo Domingo', area: 'Los Ríos', state: 'Distrito Nacional' };
  }
  if (combined.includes('santo domingo este')) {
    return { city: 'Santo Domingo Este', area: 'Santo Domingo Este', state: 'Santo Domingo' };
  }
  if (combined.includes('piantini')) {
    return { city: 'Santo Domingo', area: 'Piantini', state: 'Distrito Nacional' };
  }
  if (combined.includes('naco')) {
    return { city: 'Santo Domingo', area: 'Naco', state: 'Distrito Nacional' };
  }
  if (combined.includes('bella vista')) {
    return { city: 'Santo Domingo', area: 'Bella Vista', state: 'Distrito Nacional' };
  }

  return { city: 'Santo Domingo', area: 'Distrito Nacional', state: 'Distrito Nacional' };
};

// Helper to detect Property Type from text & URL
const detectDRPropertyType = (text, url) => {
  const combined = `${text || ''} ${url || ''}`.toLowerCase();
  if (combined.includes('apartamento') || combined.includes('apartment') || combined.includes('piso') || combined.includes('condo') || combined.includes('penthouse')) {
    return 'APARTMENT';
  }
  if (combined.includes('solar') || combined.includes('terreno') || combined.includes('land') || combined.includes('lote')) {
    return 'LAND';
  }
  if (combined.includes('oficina') || combined.includes('office')) {
    return 'OFFICE';
  }
  if (combined.includes('local') || combined.includes('comercial') || combined.includes('commercial')) {
    return 'COMMERCIAL';
  }
  return 'HOUSE';
};

// Helper to detect Listing Type (RENT or BUY) from text & URL
const detectDRListingType = (text, url) => {
  const combined = `${text || ''} ${url || ''}`.toLowerCase();
  if (combined.includes('alquiler') || combined.includes('rent') || combined.includes('rentar')) {
    return 'RENT';
  }
  return 'BUY';
};

// Local fast fallback translation for common Dominican Republic real estate terms
const fallbackTranslate = (text) => {
  if (!text) return { en: '', es: '' };
  const str = String(text).trim();
  const lower = str.toLowerCase();

  let en = str;
  let es = str;

  // Commercial premises
  if (lower.includes('commercial premises for rent') || lower.includes('commercial premise for rent')) {
    es = str.replace(/commercial premises? for rent/gi, 'Local Comercial en Alquiler')
      .replace(/\bin\b/gi, 'en');
  } else if (lower.includes('commercial premises for sale') || lower.includes('commercial premise for sale')) {
    es = str.replace(/commercial premises? for sale/gi, 'Local Comercial en Venta')
      .replace(/\bin\b/gi, 'en');
  } else if (lower.includes('local comercial en alquiler')) {
    en = str.replace(/local comercial en alquiler/gi, 'Commercial Premises for Rent')
      .replace(/\ben\b/gi, 'in');
  } else if (lower.includes('local comercial en venta')) {
    en = str.replace(/local comercial en venta/gi, 'Commercial Premises for Sale')
      .replace(/\ben\b/gi, 'in');
  } else if (lower.includes('house for sale')) {
    es = str.replace(/house for sale/gi, 'Casa en Venta').replace(/\bin\b/gi, 'en');
  } else if (lower.includes('casa en venta')) {
    en = str.replace(/casa en venta/gi, 'House for Sale').replace(/\ben\b/gi, 'in');
  } else if (lower.includes('apartment for sale')) {
    es = str.replace(/apartment for sale/gi, 'Apartamento en Venta').replace(/\bin\b/gi, 'en');
  } else if (lower.includes('apartamento en venta')) {
    en = str.replace(/apartamento en venta/gi, 'Apartment for Sale').replace(/\ben\b/gi, 'in');
  } else if (lower.includes('villa for sale')) {
    es = str.replace(/villa for sale/gi, 'Villa en Venta').replace(/\bin\b/gi, 'en');
  } else if (lower.includes('villa en venta')) {
    en = str.replace(/villa en venta/gi, 'Villa for Sale').replace(/\ben\b/gi, 'in');
  }

  // Common replacements
  es = es.replace(/\bin gazcue\b/gi, 'en Gazcue')
    .replace(/\bin piantini\b/gi, 'en Piantini')
    .replace(/\bin naco\b/gi, 'en Naco')
    .replace(/\bin punta cana\b/gi, 'en Punta Cana')
    .replace(/\bin bella vista\b/gi, 'en Bella Vista');

  return { en, es };
};

// Batch AI translation helper using Centralized Unified AI Service
const translateListingTexts = async (texts) => {
  if (!Array.isArray(texts) || texts.length === 0) {
    return texts.map(t => fallbackTranslate(t));
  }

  const prompt = `You are an expert bilingual (English/Spanish) Dominican Republic real estate translator.
Translate each real estate listing headline/description below so that each item has both an English ("en") and Spanish ("es") version.
If the input is in Spanish, keep it as "es" and provide an accurate natural English translation in "en".
If the input is in English, keep it as "en" and provide an accurate natural Spanish real estate translation in "es" (for example: "COMMERCIAL PREMISES FOR RENT IN GAZCUE" -> "LOCAL COMERCIAL EN ALQUILER EN GAZCUE").

Input array:
${JSON.stringify(texts)}

Respond with a JSON array of objects in the EXACT same order:
[
  { "en": "English title", "es": "Spanish title" }
]`;

  try {
    const aiRes = await generateStructuredJson({
      prompt,
      systemInstruction: 'You are an expert bilingual Dominican Republic real estate translator. Return a valid JSON array only.',
      maxTokens: 2000,
      temperature: 0.1,
      timeoutMs: 15000
    });

    if (Array.isArray(aiRes.data) && aiRes.data.length === texts.length) {
      return aiRes.data.map((item, idx) => ({
        en: (item.en || texts[idx]).trim(),
        es: (item.es || texts[idx]).trim(),
      }));
    }
  } catch (err) {
    console.warn(`AI batch translation error: ${err.message}`);
  }

  console.warn('AI translation failed or format mismatch, using fallback dictionary.');
  return texts.map(t => fallbackTranslate(t));
};

const importScrapedProperties = async (req, res, next) => {
  try {
    let rawItems = [];

    // 1. Check if an Excel or CSV file was uploaded via multipart/form-data
    const uploadedFile = (req.files && (req.files.file?.[0] || req.files.excel?.[0] || req.files.csv?.[0])) || req.file;

    if (uploadedFile && uploadedFile.path) {
      try {
        const workbook = xlsx.readFile(uploadedFile.path);
        const sheetName = workbook.SheetNames[0];
        if (sheetName && workbook.Sheets[sheetName]) {
          rawItems = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
        }
      } catch (parseErr) {
        console.error(`Failed to parse uploaded Excel/CSV file: ${parseErr.message}`);
        return res.status(400).json({
          success: false,
          message: `Failed to parse Excel/CSV file: ${parseErr.message}`,
        });
      } finally {
        // Clean up temporary uploaded file from disk
        try {
          if (fs.existsSync(uploadedFile.path)) {
            fs.unlinkSync(uploadedFile.path);
          }
        } catch (delErr) {
          console.warn(`Could not delete temp uploaded file: ${delErr.message}`);
        }
      }
    } else if (Array.isArray(req.body)) {
      rawItems = req.body;
    } else if (Array.isArray(req.body.properties)) {
      rawItems = req.body.properties;
    } else if (typeof req.body.data === 'string') {
      try {
        rawItems = JSON.parse(req.body.data);
      } catch (e) { }
    }

    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No properties provided to import. Please upload an Excel/CSV file (using form-data key "file" or "excel") or provide a JSON array of properties.',
      });
    }

    // 2. Pre-extract all descriptions to batch translate with Gemini AI in 1 call!
    const allDescriptions = rawItems.map(item => {
      return String(item['card__description'] || item.title || item.description || 'Property in Dominican Republic').trim();
    });

    console.log(`Auto-translating ${allDescriptions.length} listing descriptions with Gemini AI...`);
    const translatedList = await translateListingTexts(allDescriptions);

    const results = {
      total: rawItems.length,
      inserted: 0,
      updated: 0,
      agenciesCreated: 0,
      agentsMatched: 0,
      errors: [],
      properties: [],
    };

    // Cache of agencies by name to avoid duplicate DB queries
    const agencyCache = new Map();

    const defaultTier1 = await Tier.findOne({ tierLevel: 1 });

    for (let index = 0; index < rawItems.length; index++) {
      const item = rawItems[index];

      try {
        const sourceUrl = (item['carousel__href href'] || item.sourceUrl || item.url || '').trim();
        const rawDesc = allDescriptions[index];
        const translated = translatedList[index] || fallbackTranslate(rawDesc);

        // 1. Resolve Agency (Find or Create)
        let officeName = (item['contact-person__info--office'] || item.agencyName || 'RE/MAX República Dominicana').trim();
        if (!officeName) officeName = 'RE/MAX República Dominicana';

        const assignedTierId = defaultTier1._id;

        let agencyDoc = agencyCache.get(officeName.toLowerCase());
        if (!agencyDoc) {
          agencyDoc = await Agency.findOne({ name: { $regex: new RegExp(`^${officeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } });
          if (!agencyDoc) {
            const isRemax = officeName.toLowerCase().includes('remax') || officeName.toLowerCase().includes('re/max');
            agencyDoc = await Agency.create({
              name: officeName,
              logo: isRemax
                ? 'https://d2wmn85efv2gey.cloudfront.net/assets/logo/remax-logo.svg'
                : null,
              tier: assignedTierId,
              isFoundingSponsor: isRemax,
              isVerified: true,
              description: `${officeName} - Verified Real Estate Agency in Dominican Republic`,
              website: isRemax ? 'https://www.remaxrd.com' : null,
            });
            results.agenciesCreated++;
          }
          agencyCache.set(officeName.toLowerCase(), agencyDoc);
        }

        // 2. Resolve Agent (Match with registered user or leave null for later auto-link) 
        let agentEmail = item['contact-buttons__email href'] || item.agentEmail || '';
        if (agentEmail.startsWith('mailto:')) {
          agentEmail = agentEmail.replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
        }

        let agentPhone = item['contact-buttons__phone href'] || item.agentPhone || '';
        if (agentPhone.startsWith('tel:')) {
          agentPhone = agentPhone.replace(/^tel:/i, '').trim();
        }

        const agentName = (item['contact-person__info--name'] || item.agentName || 'RE/MAX Agent').trim();
        const agentPhoto = item['swiper-lazy src'] || item.agentPhoto || item.profileImage || null;

        let matchedAgentId = null;
        const cleanPhoneDigits = agentPhone.replace(/[^0-9]/g, '').slice(-8);

        const agentMatchConditions = [];
        if (agentEmail) {
          agentMatchConditions.push({ email: agentEmail });
        }
        if (cleanPhoneDigits && cleanPhoneDigits.length >= 7) {
          agentMatchConditions.push({ phone: { $regex: cleanPhoneDigits } });
        }

        if (agentMatchConditions.length > 0) {
          const registeredAgent = await User.findOne({
            role: 'agent',
            $or: agentMatchConditions,
          });
          if (registeredAgent) {
            matchedAgentId = registeredAgent._id;
            results.agentsMatched++;
          }
        }

        // 3. Price & Currency Calculation
        const rawPriceVal = item['card__price'] !== undefined ? item['card__price'] : item.price;
        const priceNum = parseFloat(String(rawPriceVal || '0').replace(/[^0-9.]/g, '')) || 0;
        const currency = String(item['card__price 2'] || item.currency || 'USD').toUpperCase().trim();

        let usdPrice = 0;
        let dopPrice = 0;
        let eurPrice = 0;

        if (currency === 'DOP') {
          dopPrice = priceNum;
          usdPrice = Math.round(priceNum / 58);
          eurPrice = Math.round(usdPrice * 0.92);
        } else {
          // Defaults to USD
          usdPrice = priceNum;
          dopPrice = Math.round(priceNum * 58);
          eurPrice = Math.round(priceNum * 0.92);
        }

        // 4. Location details (City, Sector, Country)
        const locInfo = detectDRLocation(rawDesc, sourceUrl);

        // 5. Property Specs (Bedrooms, Bathrooms, Area, Type, Listing Type)
        const bedroomsVal = parseInt(item['card__feature--item 8'] !== undefined ? item['card__feature--item 8'] : item.bedrooms, 10);
        const bathroomsVal = parseInt(item['card__feature--item 10'] !== undefined ? item['card__feature--item 10'] : item.bathrooms, 10);

        const rawSize = item['card__feature--item 4'] || item['card__feature--item 2'] || item.size || '150';
        const sizeNum = Math.max(1, parseFloat(String(rawSize).replace(/[^0-9.]/g, '')) || 150);

        const propType = detectDRPropertyType(rawDesc, sourceUrl);
        const listType = detectDRListingType(rawDesc, sourceUrl);

        // 6. Collect Images
        const images = [];
        if (item['carousel__slide src']) images.push(item['carousel__slide src']);
        if (item['carousel__slide src 2']) images.push(item['carousel__slide src 2']);
        if (Array.isArray(item.images)) {
          item.images.forEach(img => {
            if (img && !images.includes(img)) images.push(img);
          });
        }

        // 7. Maintenance Fee
        const rawExpense = item['card__expenses'] || '';
        const expenseNum = parseFloat(String(rawExpense).replace(/[^0-9.]/g, '')) || 0;
        const expenseCurrency = String(item['card__expenses 2'] || 'DOP').trim().toUpperCase() || 'DOP';

        // 8. Short term rental flag (Airbnb)
        const isAirbnb = rawDesc.toLowerCase().includes('airbnb') || (item.isShortTermRentalAllowed === true);

        // 9. Build standard property payload
        const propertyPayload = {
          title: {
            en: item.titleEn || translated.en || rawDesc,
            es: item.titleEs || translated.es || rawDesc,
          },
          description: {
            en: item.descriptionEn || translated.en || rawDesc,
            es: item.descriptionEs || translated.es || rawDesc,
          },
          location: {
            address: locInfo.area,
            area: locInfo.area,
            city: locInfo.city,
            state: locInfo.state,
            country: 'Dominican Republic',
          },
          propertyType: propType,
          listingType: listType,
          price: {
            usd: usdPrice,
            dop: dopPrice,
          },
          bedrooms: isNaN(bedroomsVal) ? null : bedroomsVal,
          bathrooms: isNaN(bathroomsVal) ? null : bathroomsVal,
          size: sizeNum,
          sizeUnit: 'sq meters',
          maintenanceFee: {
            amount: expenseNum,
            currency: expenseCurrency,
          },
          images,
          source: item.source || 'REMAX',
          sourceUrl: sourceUrl || null,
          agency: agencyDoc ? agencyDoc._id : null,
          agent: matchedAgentId,
          agentDetails: {
            name: agentName,
            phone: agentPhone,
            email: agentEmail,
            profileImage: agentPhoto,
            office: officeName,
            whatsapp: item['contact-buttons__whatsapp href'] || item.whatsapp || null,
          },
          status: 'Active',
        };

        // 10. Upsert by sourceUrl if available, else insert
        let savedProperty;
        if (sourceUrl) {
          const existing = await Property.findOne({ sourceUrl });
          if (existing) {
            savedProperty = await Property.findByIdAndUpdate(
              existing._id,
              { $set: propertyPayload },
              { new: true, runValidators: false }
            );
            results.updated++;
          } else {
            savedProperty = await Property.create(propertyPayload);
            results.inserted++;
          }
        } else {
          savedProperty = await Property.create(propertyPayload);
          results.inserted++;
        }

        results.properties.push({
          id: savedProperty._id,
          title: savedProperty.title.es,
          price: savedProperty.price,
          city: savedProperty.location.city,
          agency: agencyDoc ? agencyDoc.name : null,
          agentLinked: Boolean(matchedAgentId),
        });

      } catch (itemErr) {
        console.error(`Error importing listing #${index + 1}: ${itemErr.message}`);
        results.errors.push({
          index: index + 1,
          error: itemErr.message,
          data: item['card__description'] || item['carousel__href href'],
        });
      }
    }

    res.status(200).json({
      success: true,
      message: `Scraped properties processed successfully: ${results.inserted} inserted, ${results.updated} updated.`,
      data: results,
    });

  } catch (err) {
    console.error(`Import Scraped Properties Fatal Error: ${err.message}`);
    next(err);
  }
};

const syncRemaxPropertiesAdmin = async (req, res, next) => {
  try {
    const syncAll = req.body.syncAll === true || req.query.syncAll === 'true';
    const pages = parseInt(req.body.pages || req.query.pages || '1', 10);
    const pageSize = parseInt(req.body.pageSize || req.query.pageSize || '50', 10);
    const fetchDetails = req.body.fetchDetails !== false && req.query.fetchDetails !== 'false';

    console.log(`[Admin Trigger] Background REMAX Sync requested (syncAll: ${syncAll}, pages: ${pages}, pageSize: ${pageSize})...`);

    const launchResult = startAsyncSyncRemax({
      pages,
      pageSize,
      fetchDetails,
      syncAll,
    });

    if (launchResult.alreadyRunning) {
      return res.status(200).json({
        success: true,
        message: launchResult.message,
        data: launchResult.status,
      });
    }

    return res.status(202).json({
      success: true,
      message: 'REMAX background synchronization started successfully. Track live progress anytime at GET /api/admin/properties/sync-status.',
      data: launchResult,
    });
  } catch (err) {
    console.error(`REMAX Admin Sync Error: ${err.message}`);
    next(err);
  }
};

const getRemaxSyncStatusAdmin = async (req, res, next) => {
  try {
    const status = getSyncStatus();
    return res.status(200).json({
      success: true,
      data: status,
    });
  } catch (err) {
    next(err);
  }
};

const cancelRemaxSyncAdmin = async (req, res, next) => {
  try {
    const result = cancelSync();
    return res.status(200).json({
      success: true,
      message: result.message,
      data: getSyncStatus(),
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  addProperty,
  getLatestProperties,
  getProperties,
  getPropertyById,
  getRecentlyViewed,
  clearRecentlyViewed,
  deleteRecentlyViewedById,
  removeRecentlyViewedById: deleteRecentlyViewedById,
  compareProperties,
  getFilterOptions,
  getAllPropertiesAdmin,
  getPropertyByIdAdmin,
  updatePropertyStatus,
  updateProperty,
  deleteProperty,
  importScrapedProperties,
  syncRemaxPropertiesAdmin,
  getRemaxSyncStatusAdmin,
  cancelRemaxSyncAdmin,
};