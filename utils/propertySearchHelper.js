const Tier = require('../models/Tier');

/**
 * Normalizes listing type from diverse inputs (BUY, RENT, English & Spanish)
 */
const normalizeListingType = (val) => {
  if (!val) return null;
  const str = String(val).trim().toUpperCase();
  if (['BUY', 'COMPRA', 'VENTA', 'SALE'].includes(str)) return 'BUY';
  if (['RENT', 'ALQUILER', 'RENTA'].includes(str)) return 'RENT';
  return null;
};

/**
 * Normalizes property type from diverse inputs (HOUSE, APARTMENT, LAND, OFFICE, COMMERCIAL)
 */
const normalizePropertyType = (val) => {
  if (!val) return null;
  const str = String(val).trim().toUpperCase();
  if (['HOUSE', 'CASA', 'HOMES', 'TOWNHOUSE', 'VILLA'].includes(str)) return 'HOUSE';
  if (['APARTMENT', 'APARTAMENTO', 'DEPARTAMENTO', 'CONDO', 'PENTHOUSE', 'FLAT'].includes(str)) return 'APARTMENT';
  if (['LAND', 'PLOT', 'SOLAR', 'TERRENO', 'LOTE', 'PARCELA'].includes(str)) return 'LAND';
  if (['OFFICE', 'OFICINA'].includes(str)) return 'OFFICE';
  if (['COMMERCIAL', 'LOCAL', 'LOCAL COMERCIAL', 'COMERCIAL', 'SHOP'].includes(str)) return 'COMMERCIAL';
  if (['APARTMENT', 'HOUSE', 'LAND', 'OFFICE', 'COMMERCIAL'].includes(str)) return str;
  return null;
};

let cachedTier1 = null;
let cachedTier1Expiry = 0;
const getDefaultTier1 = async () => {
  const now = Date.now();
  if (cachedTier1 && now < cachedTier1Expiry) {
    return cachedTier1;
  }
  try {
    const tier = await Tier.findOne({ tierLevel: 1 }).lean();
    if (tier) {
      cachedTier1 = tier;
      cachedTier1Expiry = now + 10 * 60 * 1000;
      return cachedTier1;
    }
  } catch (err) {
    console.warn('Tier fetch failed, using fallback:', err.message);
  }
  return {
    tierLevel: 1,
    name: 'Tier 1 — Basic',
    uiAppearance: { badgeType: 'NONE', enableShimmerAnimation: false, hasCardHighlight: false },
    conversionAndLeads: { external_webview: true, whatapps_button: false, enableNativeLeadNotifications: false }
  };
};

const escapeRegex = (string) => {
  if (!string || typeof string !== 'string') return '';
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const normalizeLocation = (locStr) => {
  if (!locStr || typeof locStr !== 'string') return locStr;
  const trimmed = locStr.trim();
  const lower = trimmed.toLowerCase();

  // Sector pattern: "sec 62 noida", "noida sector 62", "sector 150 greater noida"
  const secMatch = lower.match(/\b(?:sec|sector)\s*(\d+[a-z]?)\b/i);
  if (secMatch) {
    const secNum = secMatch[1].toUpperCase();
    const cityPart = lower
      .replace(/\b(?:sec|sector)\s*\d+[a-z]?\b/i, '')
      .replace(/[,]+/g, '')
      .trim();

    if (cityPart) {
      const formattedCity = cityPart
        .split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      return `Sector ${secNum}, ${formattedCity}`;
    }
    return `Sector ${secNum}`;
  }

  // Phase pattern: "phase 2 gurgaon", "dlf phase 2"
  const phaseMatch = lower.match(/\bphase\s*(\d+[a-z]?)\b/i);
  if (phaseMatch) {
    const phaseNum = phaseMatch[1].toUpperCase();
    const otherPart = lower
      .replace(/\bphase\s*\d+[a-z]?\b/i, '')
      .replace(/[,]+/g, '')
      .trim();

    if (otherPart) {
      const formattedOther = otherPart
        .split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      return `Phase ${phaseNum}, ${formattedOther}`;
    }
  }

  // Otherwise standard title case
  return trimmed
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
};

const makeAccentRegexPattern = (str) => {
  const map = {
    'a': '[aáàâäãAÁÀÂÄÃ]', 'á': '[aáàâäãAÁÀÂÄÃ]',
    'e': '[eéèêëEÉÈÊË]', 'é': '[eéèêëEÉÈÊË]',
    'i': '[iíìîïIÍÌÎÏ]', 'í': '[iíìîïIÍÌÎÏ]',
    'o': '[oóòôöõOÓÒÔÖÕ]', 'ó': '[oóòôöõOÓÒÔÖÕ]',
    'u': '[uúùûüUÚÙÛÜ]', 'ú': '[uúùûüUÚÙÛÜ]',
    'n': '[nñNÑ]', 'ñ': '[nñNÑ]'
  };
  return escapeRegex(str).split('').map(ch => {
    const lower = ch.toLowerCase();
    return map[lower] || ch;
  }).join('');
};

/**
 * Builds comprehensive multi-token location/title conditions matching across:
 * location.city, location.area, location.address, location.state, location.sector,
 * title.es, and title.en
 */
const buildLocationConditions = (locStr) => {
  if (!locStr || typeof locStr !== 'string' || !locStr.trim()) return [];
  const trimmed = locStr.trim();

  // If comma-separated (e.g. "Bella Vista, Santo Domingo"), split into parts
  const parts = trimmed.split(',').map(p => p.trim()).filter(Boolean);

  const getOrConditionsForPhrase = (phrase) => {
    const phrasesToMatch = [phrase];
    // If it starts with 'Ensanche ' or 'Sector ', also include the core name (e.g. 'Ensanche Paraiso' -> 'Paraiso')
    const withoutPrefix = phrase.replace(/^(?:ensanche|sector)\s+/i, '').trim();
    if (withoutPrefix && withoutPrefix.toLowerCase() !== phrase.toLowerCase()) {
      phrasesToMatch.push(withoutPrefix);
    }

    const orList = [];
    for (const p of phrasesToMatch) {
      const pat = makeAccentRegexPattern(p);
      const regex = new RegExp(`(^|\\b)${pat}(\\b|$)`, 'i');
      orList.push(
        { 'location.area': regex },
        { 'location.sector': regex },
        { 'location.address': regex },
        { 'location.city': regex },
        { 'location.state': regex },
        { 'title.es': regex },
        { 'title.en': regex },
        { title: regex }
      );
    }
    return orList;
  };

  if (parts.length > 1) {
    return parts.map(part => ({ $or: getOrConditionsForPhrase(part) }));
  }

  return getOrConditionsForPhrase(trimmed);
};

/**
 * Unified MongoDB query builder used by both AI Chat API and Properties Filter API
 */
const buildPropertyQuery = (filters = {}) => {
  const mongoQuery = { status: 'Active' };

  // 1. Listing Type (BUY / RENT)
  let normalizedListing = null;
  if (filters.listingType) {
    if (Array.isArray(filters.listingType)) {
      const types = filters.listingType.map(normalizeListingType).filter(Boolean);
      if (types.length === 1) {
        normalizedListing = types[0];
        mongoQuery.listingType = normalizedListing;
      } else if (types.length > 1) {
        mongoQuery.listingType = { $in: types };
      }
    } else {
      normalizedListing = normalizeListingType(filters.listingType);
      if (normalizedListing) {
        mongoQuery.listingType = normalizedListing;
      }
    }
  }

  // 2. Property Type
  if (filters.propertyType) {
    let rawTypes = [];
    if (Array.isArray(filters.propertyType)) {
      rawTypes = filters.propertyType;
    } else if (typeof filters.propertyType === 'string') {
      rawTypes = filters.propertyType.split(',').map(t => t.trim());
    }
    const validTypes = rawTypes.map(normalizePropertyType).filter(Boolean);
    if (validTypes.length === 1) {
      mongoQuery.propertyType = validTypes[0];
    } else if (validTypes.length > 1) {
      mongoQuery.propertyType = { $in: validTypes };
    }
  }

  // 3. Bedrooms & Bathrooms
  if (filters.bedrooms !== null && filters.bedrooms !== undefined && filters.bedrooms !== '') {
    const beds = Number(filters.bedrooms);
    if (!isNaN(beds)) mongoQuery.bedrooms = beds;
  }
  if (filters.bathrooms !== null && filters.bathrooms !== undefined && filters.bathrooms !== '') {
    const baths = Number(filters.bathrooms);
    if (!isNaN(baths)) mongoQuery.bathrooms = baths;
  }

  // 4. Size
  if (filters.minSize !== undefined && filters.minSize !== '' || filters.maxSize !== undefined && filters.maxSize !== '') {
    mongoQuery.size = {};
    if (filters.minSize !== undefined && filters.minSize !== '') mongoQuery.size.$gte = Number(filters.minSize);
    if (filters.maxSize !== undefined && filters.maxSize !== '') mongoQuery.size.$lte = Number(filters.maxSize);
    if (Object.keys(mongoQuery.size).length === 0) delete mongoQuery.size;
  }

  // 5. Amenities
  if (Array.isArray(filters.amenities) && filters.amenities.length > 0) {
    mongoQuery.amenities = { $in: filters.amenities };
  }

  // 6. Price Range & Dollar Thresholds (Buy > $30k, Rent < $30k)
  let usdMin = null;
  let usdMax = null;
  let dopMin = null;
  let dopMax = null;

  const priceObj = filters.price;
  if (priceObj && typeof priceObj === 'object') {
    if (typeof priceObj.usd === 'number' || (typeof priceObj.usd === 'string' && priceObj.usd !== '' && !isNaN(Number(priceObj.usd)))) {
      usdMax = Number(priceObj.usd);
    } else if (priceObj.usd && typeof priceObj.usd === 'object') {
      if (priceObj.usd.min !== undefined && priceObj.usd.min !== '' && !isNaN(Number(priceObj.usd.min))) usdMin = Number(priceObj.usd.min);
      if (priceObj.usd.max !== undefined && priceObj.usd.max !== '' && !isNaN(Number(priceObj.usd.max))) usdMax = Number(priceObj.usd.max);
    }

    if (typeof priceObj.dop === 'number' || (typeof priceObj.dop === 'string' && priceObj.dop !== '' && !isNaN(Number(priceObj.dop)))) {
      dopMax = Number(priceObj.dop);
    } else if (priceObj.dop && typeof priceObj.dop === 'object') {
      if (priceObj.dop.min !== undefined && priceObj.dop.min !== '' && !isNaN(Number(priceObj.dop.min))) dopMin = Number(priceObj.dop.min);
      if (priceObj.dop.max !== undefined && priceObj.dop.max !== '' && !isNaN(Number(priceObj.dop.max))) dopMax = Number(priceObj.dop.max);
    }

    if (priceObj.minUsd !== undefined && priceObj.minUsd !== '' && !isNaN(Number(priceObj.minUsd))) usdMin = Number(priceObj.minUsd);
    if (priceObj.maxUsd !== undefined && priceObj.maxUsd !== '' && !isNaN(Number(priceObj.maxUsd))) usdMax = Number(priceObj.maxUsd);
    if (priceObj.minDop !== undefined && priceObj.minDop !== '' && !isNaN(Number(priceObj.minDop))) dopMin = Number(priceObj.minDop);
    if (priceObj.maxDop !== undefined && priceObj.maxDop !== '' && !isNaN(Number(priceObj.maxDop))) dopMax = Number(priceObj.maxDop);

    if (priceObj.min !== undefined && priceObj.min !== '' && !isNaN(Number(priceObj.min))) {
      const cur = String(priceObj.currency || filters.currency || 'USD').toUpperCase();
      if (cur === 'DOP') dopMin = Number(priceObj.min);
      else usdMin = Number(priceObj.min);
    }
    if (priceObj.max !== undefined && priceObj.max !== '' && !isNaN(Number(priceObj.max))) {
      const cur = String(priceObj.currency || filters.currency || 'USD').toUpperCase();
      if (cur === 'DOP') dopMax = Number(priceObj.max);
      else usdMax = Number(priceObj.max);
    }
  } else if (typeof priceObj === 'number' || (typeof priceObj === 'string' && priceObj.trim() !== '' && !isNaN(Number(priceObj)))) {
    const cur = String(filters.currency || 'USD').toUpperCase();
    if (cur === 'DOP') dopMax = Number(priceObj);
    else usdMax = Number(priceObj);
  }

  // Direct minPrice / maxPrice
  if (filters.minPrice !== undefined && filters.minPrice !== '' && !isNaN(Number(filters.minPrice))) {
    const cur = String(filters.currency || 'USD').toUpperCase();
    if (cur === 'DOP') dopMin = Number(filters.minPrice);
    else usdMin = Number(filters.minPrice);
  }
  if (filters.maxPrice !== undefined && filters.maxPrice !== '' && !isNaN(Number(filters.maxPrice))) {
    const cur = String(filters.currency || 'USD').toUpperCase();
    if (cur === 'DOP') dopMax = Number(filters.maxPrice);
    else usdMax = Number(filters.maxPrice);
  }

  const priceConditions = [];
  if (normalizedListing === 'BUY') {
    const usdCond = { $gte: 30000 };
    if (usdMin !== null && !isNaN(usdMin) && usdMin > 0) {
      usdCond.$gte = Math.max(30000, usdMin);
    }
    if (usdMax !== null && !isNaN(usdMax) && usdMax > 0) {
      usdCond.$lte = usdMax;
    }
    if (!usdMin) {
      priceConditions.push(
        { 'price.usd': usdCond },
        { 'price.usd': 0 }
      );
    } else {
      mongoQuery['price.usd'] = usdCond;
    }
  } else if (normalizedListing === 'RENT') {
    const usdCond = { $lt: 30000, $gt: 0 };
    if (usdMin !== null && !isNaN(usdMin) && usdMin > 0) {
      usdCond.$gte = usdMin;
    }
    if (usdMax !== null && !isNaN(usdMax) && usdMax > 0) {
      if (usdMax < 30000) {
        usdCond.$lte = usdMax;
        delete usdCond.$lt;
      }
    }
    mongoQuery['price.usd'] = usdCond;
  } else if (usdMin || usdMax || dopMin || dopMax) {
    if (usdMin || usdMax) {
      const usdCond = {};
      if (usdMin && !isNaN(usdMin)) usdCond.$gte = usdMin;
      if (usdMax && !isNaN(usdMax) && usdMax > 0) usdCond.$lte = usdMax;
      if (Object.keys(usdCond).length > 0) {
        if (!usdCond.$gte) usdCond.$gt = 0;
        priceConditions.push({ 'price.usd': usdCond });
      }
    }

    if (dopMin || dopMax) {
      const dopCond = {};
      if (dopMin && !isNaN(dopMin)) dopCond.$gte = dopMin;
      if (dopMax && !isNaN(dopMax) && dopMax > 0) dopCond.$lte = dopMax;
      if (Object.keys(dopCond).length > 0) {
        if (!dopCond.$gte) dopCond.$gt = 0;
        priceConditions.push({ 'price.dop': dopCond });
      }
    }
  }

  // 7. Location & Search query
  const andClauses = [];

  // Exact location matching on location fields
  if (filters.location && typeof filters.location === 'string' && filters.location.trim() !== '') {
    const locConditions = buildLocationConditions(filters.location);
    if (locConditions.length > 0) {
      if (locConditions[0] && locConditions[0].$or) {
        andClauses.push(...locConditions);
      } else {
        andClauses.push({ $or: locConditions });
      }
    }
  }

  // Free-text search across titles, descriptions, and location
  const freeText = filters.search || filters.query || filters.keyword || '';
  if (freeText && typeof freeText === 'string' && freeText.trim() !== '') {
    const escText = escapeRegex(freeText.trim());
    const textRegex = new RegExp(escText, 'i');
    andClauses.push({
      $or: [
        { 'title.en': textRegex },
        { 'title.es': textRegex },
        { 'description.en': textRegex },
        { 'description.es': textRegex },
        { 'location.address': textRegex },
        { 'location.area': textRegex },
        { 'location.city': textRegex },
      ],
    });
  }

  if (priceConditions.length > 0) {
    andClauses.push({ $or: priceConditions });
  }

  if (andClauses.length === 1) {
    mongoQuery.$or = andClauses[0].$or;
  } else if (andClauses.length > 1) {
    mongoQuery.$and = andClauses;
  }

  return mongoQuery;
};

/**
 * 3-Tier Commercial Sorting Helper:
 * Tier 3 (Founding Sponsor) first, then Tier 2 (Pro Subscriber), then Tier 1 (Basic / Organic).
 * Within the same tier, respects the secondary sort rule (e.g. price_asc, price_desc, oldest, or newest).
 */
const sortPropertiesByTier = (properties = [], sortBy = 'newest', currency = 'USD') => {
  const targetCurrency = String(currency).toLowerCase().trim();
  const isDop = targetCurrency.includes('peso') || targetCurrency === 'dop';

  return properties.sort((a, b) => {
    const tierA = a.tier?.tierLevel || 1;
    const tierB = b.tier?.tierLevel || 1;

    // Commercial priority: Tier 3 > Tier 2 > Tier 1
    if (tierA !== tierB) {
      return tierB - tierA;
    }

    // Within same tier, apply secondary sort
    if (sortBy === 'price_asc') {
      const priceA = isDop ? (a.price?.dop || 0) : (a.price?.usd || 0);
      const priceB = isDop ? (b.price?.dop || 0) : (b.price?.usd || 0);
      return priceA - priceB;
    }
    if (sortBy === 'price_desc') {
      const priceA = isDop ? (a.price?.dop || 0) : (a.price?.usd || 0);
      const priceB = isDop ? (b.price?.dop || 0) : (b.price?.usd || 0);
      return priceB - priceA;
    }
    if (sortBy === 'oldest') {
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    }

    // Default newest
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
};

module.exports = {
  normalizeListingType,
  normalizePropertyType,
  getDefaultTier1,
  escapeRegex,
  normalizeLocation,
  buildLocationConditions,
  buildPropertyQuery,
  sortPropertiesByTier,
};
