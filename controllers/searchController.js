const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const Property = require('../models/Property');
const Amenity = require('../models/Amenity');
const SavedSearch = require('../models/SavedSearch');
const User = require('../models/User');
const ChatSession = require('../models/ChatSession');
const jwt = require('jsonwebtoken');
const languageMappings = require('../config/languageMappings');
const SearchLog = require('../models/SearchLog');
const mongoose = require('mongoose');
const Tier = require('../models/Tier');
const Agency = require('../models/Agency');
const { resolveLanguage, formatPropertyData, getLocalizedMessage, getSearchResultMessage } = require('../utils/languageHelper');
const { resolvePropertyEngagement } = require('../utils/propertyEngagementHelper');
const { redis, isConnected: isRedisConnected } = require('../config/redis');
const { generateStructuredJson, generateText } = require('../services/aiService');

const normalizeListingType = (val) => {
  if (!val) return null;
  const str = String(val).trim().toUpperCase();
  if (['BUY', 'COMPRA', 'VENTA', 'SALE'].includes(str)) return 'BUY';
  if (['RENT', 'ALQUILER', 'RENTA'].includes(str)) return 'RENT';
  return null;
};

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

const getAgentTierLevel = async (user) => {
  if (!user) return 1;
  if (user.tier && typeof user.tier === 'object' && user.tier.tierLevel) {
    return Number(user.tier.tierLevel) || 1;
  }
  if (user.tier && mongoose.Types.ObjectId.isValid(user.tier)) {
    const tierDoc = await Tier.findById(user.tier).lean();
    if (tierDoc && tierDoc.tierLevel) {
      return Number(tierDoc.tierLevel) || 1;
    }
  }
  if (user._id) {
    const userDoc = await User.findById(user._id).populate('tier').lean();
    if (userDoc?.tier) {
      if (typeof userDoc.tier === 'object' && userDoc.tier.tierLevel) {
        return Number(userDoc.tier.tierLevel) || 1;
      }
      if (mongoose.Types.ObjectId.isValid(userDoc.tier)) {
        const tierDoc = await Tier.findById(userDoc.tier).lean();
        if (tierDoc && tierDoc.tierLevel) {
          return Number(tierDoc.tierLevel) || 1;
        }
      }
    }
  }
  return 1;
};

// Singleton GenAI Client & In-Memory Model Cache for HTTP Connection Reuse
let cachedGenAI = null;
const cachedGeminiModels = new Map();
let cachedTextModel = null;

const getGenAIClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    return null;
  }
  if (!cachedGenAI) {
    cachedGenAI = new GoogleGenerativeAI(apiKey);
  }
  return cachedGenAI;
};

// In-Memory Query Extraction LRU Cache (<1ms on cache hits)
const queryFilterCache = new Map();
const MAX_QUERY_CACHE_SIZE = 500;
const QUERY_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const getQueryCacheKey = (query, prevFilters) => {
  const normQuery = String(query || '').trim().toLowerCase();
  const prevKey = prevFilters && Object.keys(prevFilters).length > 0
    ? JSON.stringify(prevFilters)
    : '';
  return `${normQuery}::${prevKey}`;
};

const getCachedQueryFilters = async (cacheKey) => {
  // L1 In-Memory Cache (<0.1ms)
  const item = queryFilterCache.get(cacheKey);
  if (item && Date.now() <= item.expiresAt) {
    return JSON.parse(JSON.stringify(item.filters));
  }
  if (item) {
    queryFilterCache.delete(cacheKey);
  }

  // L2 Redis Shared Cache (~1ms)
  if (isRedisConnected && isRedisConnected()) {
    try {
      const redisVal = await redis.get(`klever:ai:query:${cacheKey}`);
      if (redisVal) {
        const parsed = JSON.parse(redisVal);
        queryFilterCache.set(cacheKey, {
          filters: parsed,
          expiresAt: Date.now() + QUERY_CACHE_TTL_MS,
        });
        return parsed;
      }
    } catch (err) {
      console.warn('Redis AI query cache read error:', err.message);
    }
  }
  return null;
};

const setCachedQueryFilters = async (cacheKey, filters) => {
  if (!cacheKey || !filters) return;

  // L1 In-Memory Set
  if (queryFilterCache.size >= MAX_QUERY_CACHE_SIZE) {
    const oldestKey = queryFilterCache.keys().next().value;
    queryFilterCache.delete(oldestKey);
  }
  queryFilterCache.set(cacheKey, {
    filters: JSON.parse(JSON.stringify(filters)),
    expiresAt: Date.now() + QUERY_CACHE_TTL_MS,
  });

  // L2 Redis Set (1-hour shared TTL)
  if (isRedisConnected && isRedisConnected()) {
    try {
      await redis.set(`klever:ai:query:${cacheKey}`, JSON.stringify(filters), 'EX', 3600);
    } catch (err) {
      console.warn('Redis AI query cache write error:', err.message);
    }
  }
};

const getGeminiModel = (overrideModelName = null) => {
  const genAI = getGenAIClient();
  if (!genAI) {
    return null;
  }

  const modelName = overrideModelName || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  if (cachedGeminiModels.has(modelName)) {
    return cachedGeminiModels.get(modelName);
  }

  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      maxOutputTokens: 250,
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          listingType: {
            type: SchemaType.STRING,
            enum: ['RENT', 'BUY'],
            nullable: true,
            description: 'RENT or BUY. If not mentioned or unclear, null.',
          },
          propertyType: {
            type: SchemaType.STRING,
            enum: ['APARTMENT', 'HOUSE', 'LAND', 'OFFICE', 'COMMERCIAL'],
            nullable: true,
            description: 'APARTMENT (apartment/flat/condo/penthouse/studio), HOUSE (house/villa/casa/home/townhouse), LAND (land/solar/terreno/lote), OFFICE (office/oficina), COMMERCIAL (commercial local/shop/local comercial). If not specified, null.',
          },
          subType: {
            type: SchemaType.STRING,
            enum: ['PENTHOUSE', 'VILLA', 'STUDIO', 'DUPLEX', 'TOWNHOUSE'],
            nullable: true,
            description: 'Specific luxury or architectural subtype: PENTHOUSE (penthouse/pent house/ático), VILLA (villa/chalet), STUDIO (studio/estudio), DUPLEX, TOWNHOUSE. If regular apartment or house without specialty subtype, null.',
          },
          location: {
            type: SchemaType.STRING,
            nullable: true,
            description: 'City, locality, sector, or area name ONLY (e.g. "Evaristo Morales", "Santo Domingo", "Gazcue", "Punta Cana", "Piantini", "Naco", "Bella Vista", "Casa de Campo", "Cap Cana", "Las Terrenas"). NEVER include budget, price, numbers, or bedroom text in location.',
          },
          bedrooms: {
            type: SchemaType.INTEGER,
            nullable: true,
            description: 'Number of bedrooms (e.g. 1, 2, 3, 4). NEVER confuse with price.',
          },
          bathrooms: {
            type: SchemaType.INTEGER,
            nullable: true,
            description: 'Number of bathrooms (e.g. 1, 2, 3).',
          },
          maxPrice: {
            type: SchemaType.NUMBER,
            nullable: true,
            description: 'Maximum budget amount. Accepts ANY number of digits without restriction (e.g. 2 digits like 50 or 75, 3 digits like 500, up to 10+ digits like 10000000000). Convert multipliers (10k->10000, 250k->250000, 2M->2000000, 10 mil->10000). For ranges like "between 500 and 1500", maxPrice is 1500. If not specified, null.',
          },
          minPrice: {
            type: SchemaType.NUMBER,
            nullable: true,
            description: 'Minimum budget amount. Accepts ANY number of digits without restriction (e.g. 50, 500, 10000). For ranges like "between 500 and 1500", minPrice is 500. For "above 1000", minPrice is 1000. If not specified, null.',
          },
          paymentMethod: {
            type: SchemaType.STRING,
            enum: ['CASH', 'MORTGAGE', 'PAYMENT_PLAN'],
            nullable: true,
            description: 'Payment or financing method: CASH, MORTGAGE, PAYMENT_PLAN. If not mentioned, null.',
          },
          timeline: {
            type: SchemaType.STRING,
            enum: ['IMMEDIATE', '1_TO_3_MONTHS', '3_TO_6_MONTHS', 'EXPLORING'],
            nullable: true,
            description: 'Purchase timeline or urgency: IMMEDIATE, 1_TO_3_MONTHS, 3_TO_6_MONTHS, EXPLORING. If not mentioned, null.',
          },
          minSize: {
            type: SchemaType.NUMBER,
            nullable: true,
            description: 'Minimum property area or size in square meters. If user specifies in sq ft (e.g. 1500 sq ft), convert to square meters (1500 / 10.76 = ~139.4). If in m2/metros (e.g. 150 m2), minSize = 150. If not mentioned, null.',
          },
          maxSize: {
            type: SchemaType.NUMBER,
            nullable: true,
            description: 'Maximum property area or size in square meters. If user specifies in sq ft (e.g. 2500 sq ft), convert to square meters. If in m2/metros (e.g. 200 m2), maxSize = 200. If not mentioned, null.',
          },
        },
        required: [
          'listingType',
          'propertyType',
          'subType',
          'location',
          'bedrooms',
          'bathrooms',
          'maxPrice',
          'minPrice',
          'paymentMethod',
          'timeline',
          'minSize',
          'maxSize',
        ],
      },
    },
    systemInstruction: `You are an expert real estate AI assistant for KleverProp in the Dominican Republic.
Extract structured search parameters from user queries in English, Spanish, Hindi, or Hinglish.

CRITICAL EXTRACTION RULES:
1. BUDGET & PRICE (ANY DIGIT LENGTH ALLOWED):
   - Accepts ANY number of ANY digit length: 2 digits (e.g. 50, 75, 99), 3 digits (e.g. 500, 800), 4-6 digits (e.g. 1500, 250000), or 10+ digits (e.g. 10000000000).
   - "under 50" / "max price 500" / "hasta 2500" / "budget 75" -> maxPrice = number.
   - "above 1000" / "desde 500" / "more than 300" -> minPrice = number.
   - "between 500 and 1500" / "500 to 1500" / "de 500 a 1500" -> minPrice = 500, maxPrice = 1500.
   - Multipliers: "10k" -> 10000, "250k" -> 250000, "10 mil" -> 10000, "1 millon" / "1M" -> 1000000, "1.5 cr" -> 15000000.
   - NEVER confuse bedrooms with budget: "2 bedroom under 50" -> bedrooms=2, maxPrice=50.

2. LOCATION PURITY & ENTITY RECOGNITION (DYNAMIC):
   - "location" must ONLY be the clean geographical sector/city/resort/area name (e.g. "Evaristo Morales", "Piantini", "Naco", "Bella Vista", "Santo Domingo", "Punta Cana", "Santiago", "Casa de Campo", "Cap Cana", "Las Terrenas", "Sosúa", "Jarabacoa").
   - Short forms: "Evaristo" -> "Evaristo Morales", "Punta" -> "Punta Cana", "Bella" -> "Bella Vista".
   - CRITICAL COMPOUND ENTITY NAMES:
     * "Casa de Campo" is a world-famous luxury resort/locality in La Romana, DR. It is ALWAYS location: "Casa de Campo", NEVER propertyType: "HOUSE"!
     * Sectors with "Villa" (e.g. "Villa Mella", "Villa María", "Villa Juana") are LOCATIONS, not subType "VILLA".
   - NEVER include budget words ("max price", "budget", "under", "500", "50") or bedroom counts inside the location string! If no place is mentioned, location is null.

3. PROPERTY TYPES & LUXURY SUBTYPES (subType):
   - "penthouse", "pent house", "ático" -> propertyType: "APARTMENT", subType: "PENTHOUSE"
   - "villa", "chalet" -> propertyType: "HOUSE", subType: "VILLA"
   - "studio", "estudio" -> propertyType: "APARTMENT", subType: "STUDIO"
   - "duplex" -> subType: "DUPLEX"
   - "townhouse" -> propertyType: "HOUSE", subType: "TOWNHOUSE"
   - "flat", "apartment", "apartamento", "piso", "condo", "departamento" -> propertyType: "APARTMENT", subType: null
   - "house", "casa", "home", "makaan", "ghar", "kothi", "vivienda" -> propertyType: "HOUSE", subType: null
   - "plot", "land", "terreno", "solar", "lote", "parcela", "zameen" -> propertyType: "LAND", subType: null
   - "office", "oficina" -> propertyType: "OFFICE", subType: null
   - "shop", "commercial", "local", "tienda", "nave", "dukaan" -> propertyType: "COMMERCIAL", subType: null

4. LISTING TYPES:
   - "rent", "alquiler", "rentar", "alquilar", "en alquiler", "kiraya", "bhaada", "lease" -> RENT
   - "buy", "sale", "comprar", "venta", "en venta", "kharidna", "purchase", "adquirir" -> BUY

5. BEDROOMS & BATHROOMS:
   - "1bhk", "2bhk", "3bhk", "2 bedrooms", "2 habitaciones", "3 cuartos", "do kamre" -> bedrooms = number
   - "1 bathroom", "2 banos", "baño", "baños" -> bathrooms = number

6. PROPERTY SIZE / AREA (minSize & maxSize in Square Meters):
   - Dominican Republic properties store size in square meters ('sq meters').
   - "mas de 150 m2" / "above 150 sqm" / "desde 150 metros" / "more than 150 mt2" -> minSize = 150.
   - "hasta 250 m2" / "under 250 metros" / "max 250 mts" / "menos de 250 m2" -> maxSize = 250.
   - "entre 100 y 200 m2" / "100 to 200 metros" / "de 100 a 200 metros" -> minSize = 100, maxSize = 200.
   - If user searches in sq ft (e.g. "above 2000 sq ft" / "2000 sqft" / "2000 pies cuadrados"), convert to square meters (e.g. 2000 / 10.7639 = 185.8) so it matches the database.
   - NEVER confuse property size/area with budget/price or bedrooms!

7. NEGATIONS, EXCLUSIONS & CONTRASTING CHOICES (CRITICAL):
   - If user explicitly REJECTS a property/listing type ("nahi chahiye", "nhi", "no quiero", "not", "without", "sin", "except", "chhod kar"), NEVER extract the rejected item!
   - If they state an alternative positive requirement ("house chahiye"), extract THAT positive value.

8. CASUAL CHAT & NON-PROPERTY QUERIES:
   - If user sends greetings or non-property questions, return null for ALL search fields.

9. If any parameter is not mentioned, return null for it.`,
  });

  cachedGeminiModels.set(modelName, model);
  return model;
};

const getGeminiTextModel = () => {
  const genAI = getGenAIClient();
  if (!genAI) {
    return null;
  }
  if (cachedTextModel) {
    return cachedTextModel;
  }
  cachedTextModel = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    generationConfig: {
      maxOutputTokens: 250,
      temperature: 0.2,
    },
  });
  return cachedTextModel;
};

// Direct HTTPS Gemini Call with strict IPv4 to prevent Linux server fetch failures
const callGeminiHttpsSearch = (apiKey, modelName, prompt, timeoutMs = 8000) => {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 400
      }
    });

    const parsedUrl = new URL(url);
    const req = https.request({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      family: 4, // Enforce strict IPv4 to fix Linux server fetch failed errors
      rejectUnauthorized: false,
      timeout: timeoutMs
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP_${res.statusCode}: ${body.slice(0, 300)}`));
        }
        try {
          const json = JSON.parse(body);
          const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!rawText) return reject(new Error('No candidate text received from Gemini'));
          const cleanText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
          resolve(JSON.parse(cleanText));
        } catch (err) {
          reject(new Error(`Gemini JSON parse failed: ${err.message}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Gemini timed out after ${timeoutMs}ms`));
    });

    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
};

// Pure AI Filter Extractor (Gemini Primary + OpenAI GPT-4o-mini Secondary) with Multi-Turn Dialogue State Tracking
const extractFiltersDirectAI = async (userQuery, previousFilters = {}, conversationHistory = []) => {
  let promptContext = '';

  if (conversationHistory && conversationHistory.length > 0) {
    promptContext = `CONVERSATION TIMELINE (Recent chat turns in this session):
${conversationHistory.map((m, idx) => `[Turn ${idx + 1} ${m.role.toUpperCase()}]: "${m.content}"${m.filters && Object.keys(m.filters).length > 0 ? ` -> Active State: ${JSON.stringify(m.filters)}` : ''}`).join('\n')}

CURRENT ACTIVE FILTERS BEFORE THIS MESSAGE:
${JSON.stringify(previousFilters, null, 2)}

DIALOGUE STATE TRACKING INSTRUCTIONS:
- REFINEMENT (Additive): If user adds a constraint (e.g. 'under 1500', 'de 2 hab', 'con parqueo'), retain all existing criteria and update the specified field.
- OVERRIDE / EXPLICIT CHANGE: If user changes an existing criteria (e.g. 'now in Punta Cana', 'mejor 3 habitaciones'), update that specific attribute while preserving the rest of the search context.
- REMOVAL / BROADENING: If user asks to remove or relax a constraint (e.g. 'any bedroom', 'sin limite de precio', 'cualquier zona', 'all apartments'), set that attribute to null.
- COMPLETE TOPIC SHIFT: If user completely changes direction and begins a new search (e.g. previous was rental apartment in Piantini, now user says 'quiero comprar una villa en Punta Cana'), discard previous search filters and build a fresh state for the new search.
- RELATIVE ADJUSTMENT: If user says 'cheaper' / 'más barato', reduce maxPrice.`;
  } else if (previousFilters && Object.keys(previousFilters).length > 0) {
    promptContext = `CURRENT ACTIVE SEARCH STATE IN THIS SESSION:
${JSON.stringify(previousFilters, null, 2)}

DIALOGUE STATE TRACKING: Update active search state with user's new message. Retain existing filters if user is adding constraints; replace or reset if user asks for a different search.`;
  }

  const prompt = `You are an expert real estate conversational AI assistant for KleverProp in the Dominican Republic.
Analyze the user's message in ANY language (Spanish, English, Hindi, Hinglish, etc.) within the dialogue context and output the CURRENT COMPLETE structured search filter object in JSON.

OUTPUT JSON FORMAT:
{
  "listingType": "BUY" | "RENT" | null,
  "propertyType": "APARTMENT" | "HOUSE" | "LAND" | "OFFICE" | "COMMERCIAL" | null,
  "subType": "PENTHOUSE" | "VILLA" | "STUDIO" | "DUPLEX" | "TOWNHOUSE" | null,
  "location": "string clean city or sector name only" | null,
  "bedrooms": number | [number, number] | null,
  "bathrooms": number | null,
  "minPrice": number | null,
  "maxPrice": number | null,
  "minSize": number | null,
  "maxSize": number | null
}

CORE REAL ESTATE RULES:
- listingType: "RENT" (alquiler, rent, rentar, en alquiler, para alquilar, kiraya) or "BUY" (venta, buy, comprar, en venta, para comprar, purchase, kharidna).
- propertyType: "APARTMENT" (apartamento, flat, piso, condo, penthouse), "HOUSE" (casa, villa, chalet, home, townhouse), "LAND" (solar, terreno, lote, parcela), "OFFICE" (oficina), "COMMERCIAL" (local, local comercial, shop).
- subType (SPECIFIC LUXURY / ARCHITECTURAL SUBTYPE):
  * "penthouse", "pent house", "ático" -> subType: "PENTHOUSE", propertyType: "APARTMENT"
  * "villa", "chalet" -> subType: "VILLA", propertyType: "HOUSE"
  * "studio", "estudio" -> subType: "STUDIO", propertyType: "APARTMENT"
  * "duplex" -> subType: "DUPLEX"
  * "townhouse" -> subType: "TOWNHOUSE", propertyType: "HOUSE"
  * If user searches general house/casa/apartment/flat, subType MUST BE null.
- location (LOCATION PURITY & DYNAMIC ENTITY RECOGNITION):
  * Geographical place/city/area/resort ONLY (e.g. "Santo Domingo", "Piantini", "Punta Cana", "Bella Vista", "Naco", "Evaristo Morales", "Bavaro", "Santiago", "Casa de Campo", "Cap Cana", "Las Terrenas", "Sosúa", "Jarabacoa").
  * CRITICAL COMPOUND ENTITY RULES:
    - "Casa de Campo" is a famous resort locality in La Romana, DR. It is ALWAYS location: "Casa de Campo", NEVER propertyType: "HOUSE"!
    - Sectors like "Villa Mella" or "Villa María" are LOCATIONS, not subType "VILLA".
  * NEVER put listing terms ("alquiler", "venta", "rent", "buy") or proximity phrases ("cerca de la playa", "near beach") in location! If no geographical locality is mentioned, location MUST BE null.
- bedrooms: Convert words like "dos", "tres", or "2 hab", "2 habitaciones" to integer number. If range like "dos o tres", return array [2, 3] or minimum.
- price: Extract numbers. Convert multipliers ("10k" -> 10000, "10 mil" -> 10000, "1M" -> 1000000). Never confuse bedroom count with price.
- size & area (minSize & maxSize in Square Meters):
  Dominican Republic properties store size in square meters ('sq meters').
  "mas de 150 m2" / "above 150 sqm" / "desde 150 metros" -> minSize=150.
  "hasta 200 metros" / "under 200 m2" -> maxSize=200.
  "de 100 a 200 m2" / "between 100 and 200 meters" -> minSize=100, maxSize=200.
  If user searches in sq ft (e.g. "above 2000 sq ft"), convert to square meters (e.g. 2000 / 10.7639 = 185.8) because DB listings store size in square meters.
  Never confuse size with price or bedrooms. If not specified, return null.
- 30K RULE FOR LISTING TYPE: If user mentions a budget without stating buy or rent, infer listingType by price: under 30000 USD is "RENT", 30000 USD or more is "BUY".
- Casual chat or greetings: return null for all fields.

${promptContext ? promptContext + '\n\n' : ''}LATEST USER MESSAGE:
"${userQuery}"`;

  // Unified AI Engine (Gemini Candidates + OpenAI Fallback via aiService)
  const aiRes = await generateStructuredJson({
    prompt,
    systemInstruction: 'You are an expert real estate AI. Return valid JSON filter object matching the exact schema provided.',
    maxTokens: 400,
    temperature: 0.1,
    timeoutMs: 8000
  });

  if (aiRes.data && typeof aiRes.data === 'object') {
    console.log(`[AI Filter Extraction Success (${aiRes.engine})]:`, aiRes.data);
    return aiRes.data;
  }

  return null;
};

const generateWhyThisProperty = async (topProperties, userQuery, extractedFilters, lang, forceAIPitch = false) => {
  if (!topProperties || topProperties.length === 0) return [];
  const isSpanish = (lang === 'es');

  const aiReasons = {};

  // High-Performance Strategy: By default, use instant 3-tier contextual templates (0ms).
  // Full external LLM generation is only triggered if forceAIPitch is explicitly requested (saving ~3.7 seconds).
  if (forceAIPitch) {
    const textModel = getGeminiTextModel();
    if (textModel) {
      try {
        const summaryList = topProperties.map((p, idx) => {
          const loc = [p.location?.area, p.location?.city].filter(Boolean).join(', ') || p.location?.address || '';
          const price = p.price?.usd ? `$${p.price.usd.toLocaleString()}` : (p.price?.dop ? `RD$${p.price.dop.toLocaleString()}` : '');
          const tierLvl = p.tier?.tierLevel || 1;
          const agencyName = p.agency?.name || (p.source || 'Direct');
          const isSponsor = tierLvl === 3 || p.agency?.isFoundingSponsor;
          const tierLabel = isSponsor ? 'TIER 3 (FOUNDING SPONSOR)' : (tierLvl === 2 ? 'TIER 2 (PRO SUBSCRIBER)' : 'TIER 1 (ORGANIC FILLER)');
          return `Property ${idx + 1} (ID: ${p._id}): [${tierLabel}], Agency: "${agencyName}", Title: "${p.title || ''}", Type: ${p.propertyType || ''}, Location: ${loc}, Price: ${price}, Beds: ${p.bedrooms || 0}, Baths: ${p.bathrooms || 0}`;
        }).join('\n');

        const prompt = `You are an expert AI Realtor Assistant in the Dominican Republic.
User search query: "${userQuery}"
Extracted search criteria: ${JSON.stringify(extractedFilters || {})}

Properties to recommend:
${summaryList}

TASK:
Write a unique, punchy 1-to-2 sentence recommendation for EACH property above in ${isSpanish ? 'SPANISH' : 'ENGLISH'}, strictly following these commercial tier business rules:

CRITICAL ANTI-REPETITION REQUIREMENT:
- DO NOT start every property with the same opening phrase or rigid formula!
- NEVER repeat phrases like "Offered by our Official Sponsor" or "backed by institutional trust" identically across multiple properties.
- Each recommendation MUST have a completely different sentence structure, tone, and marketing angle reflecting that specific property's merits (e.g. location prestige, family space, high-yield investment, architectural finishes, or turnkey ease).

COMMERCIAL TIER GUIDELINES:
1. TIER 3 (FOUNDING SPONSOR ANCHOR):
   Subtly weave in the Founding Sponsor's institutional credibility, certified title security, and nationwide professional network, BUT adapt the specific angle dynamically:
   - For Rank 1 property: Emphasize prime location prestige, verified legal guarantees, and premier institutional quality.
   - For Rank 2 property: Emphasize expansive family layout, verified compliance, and the sponsor's master network.
   - For Rank 3 property: Emphasize exceptional price-to-value ratio, seamless pre-qualified financing, or luxury amenities.

2. TIER 2 (PRO SUBSCRIBER PLACEMENT):
   Generate persuasive, highly tailored sales descriptions targeting the explicit needs detected in the user conversation (specific budget, family size, financing method, or urgency).

3. TIER 1 (ORGANIC FILLER):
   Generate a concise, neutral property summary without special promotional claims.

Format your output strictly as a JSON array of objects:
[
  { "id": "property_id_here", "whyThisProperty": "..." }
]`;

        const result = await textModel.generateContent(prompt);
        const rawText = result.response.text();
        const jsonMatch = rawText.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          parsed.forEach(item => {
            if (item.id && item.whyThisProperty) {
              aiReasons[item.id.toString()] = item.whyThisProperty.trim();
            }
          });
        }
      } catch (err) {
        console.warn('Gemini WhyThisProperty generation error (using fallback templates):', err.message);
      }
    }
  }

  // Attach explanation, match score, and ranking with robust diverse 3-tier fallback
  return topProperties.map((prop, index) => {
    const propId = prop._id ? prop._id.toString() : '';
    let reason = aiReasons[propId];

    if (!reason) {
      const loc = [prop.location?.area, prop.location?.city].filter(Boolean).join(', ') || prop.location?.address || (isSpanish ? 'esta ubicación' : 'this location');
      const beds = prop.bedrooms ? (isSpanish ? `${prop.bedrooms} hab.` : `${prop.bedrooms} beds`) : '';
      const priceStr = prop.price?.usd ? `$${prop.price.usd.toLocaleString()}` : (prop.price?.dop ? `RD$${prop.price.dop.toLocaleString()}` : '');
      const agencyName = prop.agency?.name || 'Oficial';
      const isSponsor = prop.tier?.tierLevel === 3 || prop.agency?.isFoundingSponsor;
      const isPro = prop.tier?.tierLevel === 2;

      if (isSpanish) {
        if (isSponsor) {
          if (index === 0) {
            reason = `Propiedad insignia verificada por el Patrocinador Oficial ${agencyName}: máxima garantía jurídica y acabados de primera en ${loc}${priceStr ? ` por ${priceStr}` : ''}.`;
          } else if (index === 1) {
            reason = `Respaldada por la red institucional de ${agencyName}: excelente distribución${beds ? ` con ${beds}` : ''} y plusvalía garantizada en ${loc}${priceStr ? ` (${priceStr})` : ''}.`;
          } else {
            reason = `Oportunidad exclusiva avalada por el Patrocinador Oficial ${agencyName}: excelente relación precio-calidad con seguridad integral en ${loc}${priceStr ? ` por ${priceStr}` : ''}.`;
          }
        } else if (isPro) {
          if (index === 0) {
            reason = `Top selección verificada en ${loc}${beds ? ` con ${beds}` : ''}: opción altamente recomendada y adaptada a tus preferencias${priceStr ? ` en ${priceStr}` : ''}.`;
          } else if (index === 1) {
            reason = `Gran alternativa en ${loc}: excelente conectividad y espacios diseñados para tu comodidad${priceStr ? ` a ${priceStr}` : ''}.`;
          } else {
            reason = `Opción destacada en ${loc}: lista para entrega con asesoría profesional dedicada${priceStr ? ` (${priceStr})` : ''}.`;
          }
        } else {
          reason = `Opción disponible en ${loc}${beds ? ` con ${beds}` : ''}${priceStr ? ` dentro del rango de ${priceStr}` : ''}.`;
        }
      } else {
        if (isSponsor) {
          if (index === 0) {
            reason = `Flagship residence verified by Official Sponsor ${agencyName}: certified title security and premium finishes in ${loc}${priceStr ? ` at ${priceStr}` : ''}.`;
          } else if (index === 1) {
            reason = `Backed by ${agencyName}'s institutional network: outstanding layout${beds ? ` with ${beds}` : ''} and proven market value in ${loc}${priceStr ? ` (${priceStr})` : ''}.`;
          } else {
            reason = `Exclusive opportunity endorsed by Official Sponsor ${agencyName}: exceptional value and certified transaction security in ${loc}${priceStr ? ` at ${priceStr}` : ''}.`;
          }
        } else if (isPro) {
          if (index === 0) {
            reason = `Top verified Pro match in ${loc}${beds ? ` with ${beds}` : ''}: highly tailored to your search criteria${priceStr ? ` at ${priceStr}` : ''}.`;
          } else if (index === 1) {
            reason = `Great alternative in ${loc}: prime connectivity and comfortable living space${priceStr ? ` at ${priceStr}` : ''}.`;
          } else {
            reason = `Featured choice in ${loc}: ready for move-in with dedicated verified agent guidance${priceStr ? ` (${priceStr})` : ''}.`;
          }
        } else {
          reason = `Available listing in ${loc}${beds ? ` with ${beds}` : ''}${priceStr ? ` at ${priceStr}` : ''}.`;
        }
      }
    }

    return {
      ...prop,
      isTopRecommendation: true,
      recommendationRank: index + 1,
      whyThisProperty: reason,
    };
  });
};

const generateNoResultsMessage = (userQuery, extractedFilters, lang) => {
  const isSpanish = (lang === 'es');

  // Fallback template message
  let propTypeLabelEs = ' propiedades';
  let propTypeLabelEn = ' properties';
  if (extractedFilters?.subType) {
    const sType = String(extractedFilters.subType).toUpperCase();
    if (sType === 'PENTHOUSE') {
      propTypeLabelEs = ' penthouses';
      propTypeLabelEn = ' penthouses';
    } else if (sType === 'VILLA') {
      propTypeLabelEs = ' villas';
      propTypeLabelEn = ' villas';
    } else if (sType === 'STUDIO') {
      propTypeLabelEs = ' estudios';
      propTypeLabelEn = ' studio apartments';
    } else if (sType === 'DUPLEX') {
      propTypeLabelEs = ' dúplex';
      propTypeLabelEn = ' duplex properties';
    } else if (sType === 'TOWNHOUSE') {
      propTypeLabelEs = ' townhouses';
      propTypeLabelEn = ' townhouses';
    }
  } else if (extractedFilters?.propertyType) {
    const pType = String(extractedFilters.propertyType).toUpperCase();
    if (pType === 'HOUSE') {
      propTypeLabelEs = ' casas';
      propTypeLabelEn = ' houses';
    } else if (pType === 'APARTMENT') {
      propTypeLabelEs = ' apartamentos';
      propTypeLabelEn = ' apartments';
    } else if (pType === 'LAND') {
      propTypeLabelEs = ' solares o terrenos';
      propTypeLabelEn = ' land/plots';
    } else if (pType === 'OFFICE') {
      propTypeLabelEs = ' oficinas';
      propTypeLabelEn = ' offices';
    } else if (pType === 'COMMERCIAL') {
      propTypeLabelEs = ' locales comerciales';
      propTypeLabelEn = ' commercial spaces';
    }
  }

  const locStr = extractedFilters?.location ? ` in ${extractedFilters.location}` : '';
  const locStrEs = extractedFilters?.location ? ` en ${extractedFilters.location}` : '';
  return isSpanish
    ? `No encontramos${propTypeLabelEs} que coincidan con tu búsqueda${locStrEs}. Intenta buscar en otra zona o cambiar tus filtros.`
    : `We couldn't find any${propTypeLabelEn} matching your search${locStr}. Please try searching in another area or adjusting your filters.`;
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

const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

// Universal Multiplier Helper
const parsePriceMultiplier = (numStr, unit) => {
  let num = parseFloat(numStr);
  if (isNaN(num)) return null;
  const u = (unit || '').toLowerCase();
  if (u === 'k' || u === 'mil' || u === 'thousand' || u === 'hazar') return Math.round(num * 1000);
  if (u === 'm' || u.startsWith('mill') || u === 'million') return Math.round(num * 1000000);
  if (u === 'lakh' || u === 'lac') return Math.round(num * 100000);
  if (u === 'cr' || u === 'crore') return Math.round(num * 10000000);
  return Math.round(num);
};

const parseFiltersFallback = (text, previousFilters = {}) => {
  const lower = text.toLowerCase();
  let filters = {
    listingType: null,
    propertyType: null,
    subType: null,
    location: null,
    bedrooms: null,
    bathrooms: null,
    minPrice: null,
    maxPrice: null,
    minSize: null,
    maxSize: null,
    paymentMethod: null,
    timeline: null,
    furnishedStatus: null,
    amenities: [],
  };

  const normalizedText = lower.replace(/,/g, '');

  // 1a. Specific Luxury / Architectural SubTypes
  if (lower.match(/\bpent\s*house\b/i) || lower.match(/\b[aá]tico\b/i)) {
    filters.subType = 'PENTHOUSE';
    filters.propertyType = 'APARTMENT';
  } else if (lower.match(/\bvillas?\b/i) && !lower.match(/\bvilla\s+(mella|mar[ií]a|juana|consuelo|francisca)\b/i)) {
    filters.subType = 'VILLA';
    filters.propertyType = 'HOUSE';
  } else if (lower.match(/\b(studio|estudio)\b/i)) {
    filters.subType = 'STUDIO';
    filters.propertyType = 'APARTMENT';
  }

  // 1b. Broad Property Type (with Negation & Contrast Detection)
  const checkTypeNegated = (keywordRegex) => {
    return lower.match(new RegExp('(?:nhi|nahi|not|no|no\\s+quiero|sin|without|chhod\\s*kar|alawa)\\s+(?:chahiye\\s+)?' + keywordRegex.source, 'i')) ||
      lower.match(new RegExp(keywordRegex.source + '\\s+(?:nhi|nahi|not|no|mat)\\s*(?:chahiye|chaiye)?', 'i'));
  };

  const aptRegex = /\b(flat|apartment|apartamento|piso|departamento|depa|condo|penthouse|estudio|studio)\b/i;
  const houseRegex = /\b(house|home|makan|makaan|villa|kothi|ghar|ghr|casa|vivienda|chalet|townhouse)\b/i;
  const landRegex = /\b(plot|land|zameen|solar|terreno|parcela|lote)\b/i;
  const officeRegex = /\b(office|oficina)\b/i;
  const commRegex = /\b(commercial|shop|dukaan|local|tienda|nave)\b/i;

  const isAptNegated = Boolean(checkTypeNegated(aptRegex));
  const isHouseNegated = Boolean(checkTypeNegated(houseRegex));
  const isLandNegated = Boolean(checkTypeNegated(landRegex));
  const isOfficeNegated = Boolean(checkTypeNegated(officeRegex));
  const isCommNegated = Boolean(checkTypeNegated(commRegex));

  if (!filters.propertyType) {
    if (houseRegex.test(lower) && !isHouseNegated && !lower.match(/\bcasa\s+de\s+campo\b/i)) {
      filters.propertyType = 'HOUSE';
    } else if (aptRegex.test(lower) && !isAptNegated) {
      filters.propertyType = 'APARTMENT';
    } else if (landRegex.test(lower) && !isLandNegated) {
      filters.propertyType = 'LAND';
    } else if (officeRegex.test(lower) && !isOfficeNegated) {
      filters.propertyType = 'OFFICE';
    } else if (commRegex.test(lower) && !isCommNegated) {
      filters.propertyType = 'COMMERCIAL';
    }
  }

  // 2. Listing Type (with Negation Detection)
  const rentRegex = /\b(rent\w*|kiray\w*|bhaad\w*|alquilar\w*|alquiler\w*|rentar\w*|renta\w*|en alquiler|lease)\b/i;
  const buyRegex = /\b(buy\w*|kharid\w*|khareed\w*|purchase\w*|sale\w*|comprar\w*|compra\w*|en venta|adquirir\w*)\b/i;

  const isRentNegated = Boolean(checkTypeNegated(rentRegex));
  const isBuyNegated = Boolean(checkTypeNegated(buyRegex));

  if (rentRegex.test(lower) && !isRentNegated) {
    filters.listingType = 'RENT';
  } else if (buyRegex.test(lower) && !isBuyNegated) {
    filters.listingType = 'BUY';
  }

  // 3. Bedrooms & Bathrooms (Extract first so room counts are NEVER confused with budget)
  const bhkMatch = lower.match(/(\d+)\s*[-]?\s*(bhk|bedrooms?|beds?|kamre?|rooms?|habitaci[oó]n(?:es)?|dormitorios?|cuartos?)\b/i);
  if (bhkMatch) {
    filters.bedrooms = parseInt(bhkMatch[1], 10);
  }

  const bathMatch = lower.match(/(\d+)\s*[-]?\s*(bathrooms?|baths?|ba[nñ]os?)\b/i);
  if (bathMatch) {
    filters.bathrooms = parseInt(bathMatch[1], 10);
  }

  // 4. UNIVERSAL PRICE EXTRACTION (ANY DIGIT COUNT: from 2 digits to 10+ digits, ranges, multipliers)
  // 4a. Price Range: between X and Y / X to Y / de X a Y / X - Y
  const rangeMatch = normalizedText.match(/(?:between|de|from|entre)\s*[:$]?\s*(\d+(?:\.\d+)?)\s*(k|mil|m|mill[oó]n(?:es)?|million|lakh|lac|cr)?\s*(?:and|to|y|a|-)\s*[:$]?\s*(\d+(?:\.\d+)?)\s*(k|mil|m|mill[oó]n(?:es)?|million|lakh|lac|cr)?\b/i);
  if (rangeMatch) {
    filters.minPrice = parsePriceMultiplier(rangeMatch[1], rangeMatch[2]);
    filters.maxPrice = parsePriceMultiplier(rangeMatch[3], rangeMatch[4]);
  }

  // 4b. Explicit Max Budget: "under 50", "max price 500", "hasta 250k", "budget 1000", "menos de 300"
  if (!filters.maxPrice) {
    const maxMatch = normalizedText.match(/(?:max\s*price|maximum\s*price|max|budget|presupuesto|under|below|hasta|menos\s*de|ke\s*andar|tak|upto|menos\s*que)\s*[:$]?\s*(\d+(?:\.\d+)?)\s*(k|mil|m|mill[oó]n(?:es)?|million|lakh|lac|cr)?\b/i);
    if (maxMatch) {
      filters.maxPrice = parsePriceMultiplier(maxMatch[1], maxMatch[2]);
    }
  }

  // 4c. Explicit Min Budget: "above 1000", "desde 500", "min price 300", "more than 50"
  if (!filters.minPrice) {
    const minMatch = normalizedText.match(/(?:min\s*price|minimum\s*price|min|above|over|more\s*than|mas\s*de|desde|a\s*partir\s*de)\s*[:$]?\s*(\d+(?:\.\d+)?)\s*(k|mil|m|mill[oó]n(?:es)?|million|lakh|lac|cr)?\b/i);
    if (minMatch) {
      filters.minPrice = parsePriceMultiplier(minMatch[1], minMatch[2]);
    }
  }

  // 4d. Standalone numbers or currency mentions (e.g. $50, 50 USD, 250k, 10000000000)
  if (!filters.maxPrice && !filters.minPrice) {
    // Strip bedroom and bathroom numbers first so they are never parsed as budget
    const priceTextOnly = normalizedText
      .replace(/(\d+)\s*[-]?\s*(bhk|bedrooms?|beds?|kamre?|rooms?|habitaci[oó]n(?:es)?|dormitorios?|cuartos?)\b/gi, '')
      .replace(/(\d+)\s*[-]?\s*(bathrooms?|baths?|ba[nñ]os?)\b/gi, '');

    const currMatch = priceTextOnly.match(/(?:[$₹]|usd|dop|rd\$)\s*[:$]?\s*(\d+(?:\.\d+)?)\s*(k|mil|m|mill[oó]n(?:es)?|million|lakh|lac|cr)?\b/i)
      || priceTextOnly.match(/(\d+(?:\.\d+)?)\s*(?:usd|dop|rd\$|dolares|pesos)\b/i)
      || priceTextOnly.match(/(\d+(?:\.\d+)?)\s*(k|mil|m|mill[oó]n(?:es)?|million|lakh|lac|cr)\b/i)
      || priceTextOnly.match(/[$₹]\s*(\d+(?:\.\d+)?)/i)
      || priceTextOnly.match(/\b(\d+)\b/); // Any standalone number of ANY digit length!

    if (currMatch) {
      const numVal = currMatch[1] || currMatch[0];
      const unitVal = currMatch[2] || null;
      filters.maxPrice = parsePriceMultiplier(numVal, unitVal);
    }
  }

  // Default listingType based on budget if not specified
  if (filters.maxPrice && filters.maxPrice <= 50000 && !filters.listingType) {
    filters.listingType = 'RENT';
  } else if (filters.maxPrice && filters.maxPrice > 50000 && !filters.listingType) {
    filters.listingType = 'BUY';
  }

  // 5. PROPERTY SIZE / AREA EXTRACTION (m2, metros, mts, sqft)
  const SQM_TO_SQFT = 10.7639;

  // 5a. Size Range: "between 100 and 200 m2", "de 100 a 200 metros", "100 - 200 sqft"
  const sizeRangeMatch = normalizedText.match(/(?:between|de|from|entre)\s*(\d+(?:\.\d+)?)\s*(?:and|to|y|a|-)\s*(\d+(?:\.\d+)?)\s*(m2|mt2|mts|metros|meters|sq\s*meters|sqm|sqft|sq\s*ft|pies\s*cuadrados)\b/i);
  if (sizeRangeMatch) {
    let s1 = parseFloat(sizeRangeMatch[1]);
    let s2 = parseFloat(sizeRangeMatch[2]);
    const u = (sizeRangeMatch[3] || '').toLowerCase();
    if (u.includes('ft') || u.includes('pie')) {
      s1 = Math.round((s1 / SQM_TO_SQFT) * 10) / 10;
      s2 = Math.round((s2 / SQM_TO_SQFT) * 10) / 10;
    }
    filters.minSize = Math.min(s1, s2);
    filters.maxSize = Math.max(s1, s2);
  }

  // 5b. Max Size: "under 200 m2", "hasta 250 metros", "menos de 200 m2"
  if (!filters.maxSize) {
    const maxSizeMatch = normalizedText.match(/(?:under|below|hasta|menos\s*de|upto|menos\s*que)\s*(\d+(?:\.\d+)?)\s*(m2|mt2|mts|metros|meters|sq\s*meters|sqm|sqft|sq\s*ft|pies\s*cuadrados)\b/i);
    if (maxSizeMatch && maxSizeMatch[1]) {
      let s = parseFloat(maxSizeMatch[1]);
      const u = (maxSizeMatch[2] || '').toLowerCase();
      if (u.includes('ft') || u.includes('pie')) s = Math.round((s / SQM_TO_SQFT) * 10) / 10;
      filters.maxSize = s;
    }
  }

  // 5c. Min Size: "above 150 m2", "mas de 100 metros", "desde 120 mts", "more than 150 m2"
  if (!filters.minSize) {
    const minSizeMatch = normalizedText.match(/(?:above|over|more\s*than|mas\s*de|m[aá]s\s*de|desde|a\s*partir\s*de)\s*(\d+(?:\.\d+)?)\s*(m2|mt2|mts|metros|meters|sq\s*meters|sqm|sqft|sq\s*ft|pies\s*cuadrados)\b/i);
    if (minSizeMatch && minSizeMatch[1]) {
      let s = parseFloat(minSizeMatch[1]);
      const u = (minSizeMatch[2] || '').toLowerCase();
      if (u.includes('ft') || u.includes('pie')) s = Math.round((s / SQM_TO_SQFT) * 10) / 10;
      filters.minSize = s;
    }
  }

  // 5d. Standalone size with explicit unit: "150 m2", "200 metros", "2000 sqft"
  if (!filters.minSize && !filters.maxSize) {
    const standaloneMatch = normalizedText.match(/(\d+(?:\.\d+)?)\s*(m2|mt2|mts|metros|meters|sq\s*meters|sqm|sqft|sq\s*ft|pies\s*cuadrados)\b/i);
    if (standaloneMatch && standaloneMatch[1]) {
      let s = parseFloat(standaloneMatch[1]);
      const u = (standaloneMatch[2] || '').toLowerCase();
      if (u.includes('ft') || u.includes('pie')) s = Math.round((s / SQM_TO_SQFT) * 10) / 10;
      filters.minSize = s;
    }
  }

  // 6. ACCURATE LOCATION EXTRACTION (Pure Dynamic NLP - No hardcoded arrays)
  // Dynamic compound place recognition
  if (lower.match(/\bcasa\s+de\s+campo\b/i)) {
    filters.location = 'Casa de Campo';
  }

  // 5b. Pattern: Hindi "me" / "mein"
  if (!filters.location) {
    const meMatch = lower.match(/([a-z0-9\s,]+?)\s+\b(?:me|mein)\b/i);
    if (meMatch && meMatch[1]) {
      const stopWords = new Set(['muje', 'mujhe', 'humko', 'hume', 'hame', 'mere', 'apne', 'bhai', 'yaar', 'sir', 'plz', 'please', 'i', 'we', 'want', 'need', 'chahiye', 'ek', 'do', 'on', 'rent', 'buy', 'flat', 'house', 'ghr', 'ghar']);
      const validWords = meMatch[1].replace(/[.,]+$/g, '').trim().split(/\s+/).filter(w => !stopWords.has(w));
      if (validWords.length > 0) {
        filters.location = validWords.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }
    }
  }

  // 5c. Pattern: English / Spanish "in" / "en" / "at" / "near" with strict boundary delimiters
  if (!filters.location) {
    const inMatch = lower.match(/\b(?:in|en|at|near|around|cerca\s+de)\s+([a-z0-9\s,]+?)(?:\s+(?<!(?:sector|sec|phase|fase)\s*)\b(?:under|below|above|from|max|maximum|min|minimum|budget|price|precio|presupuesto|for\s+rent|for\s+sale|en\s+alquiler|en\s+venta|with|con|bedrooms?|beds?|baths?|habitaci[oó]n|ba[nñ]o|\$|\₹|rd\$|usd|dop|\d+)\b|$)/i)
      || lower.match(/\b(?:in|en|at|near|around|cerca\s+de)\s+([a-z0-9\s,]+)$/i);
    if (inMatch && inMatch[1]) {
      const stopWords = new Set(['i', 'we', 'want', 'need', 'flat', 'house', 'apartment', 'un', 'una', 'el', 'la', 'en', 'de', 'con', 'por', 'favor', 'please', 'alquiler', 'venta', 'rent', 'buy', 'sale', 'playa', 'cerca', 'renta']);
      const validWords = inMatch[1].replace(/[.,]+$/g, '').trim().split(/\s+/).filter(w => !stopWords.has(w));
      if (validWords.length > 0) {
        const candidateLoc = validWords.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        const blackList = ['Alquiler', 'Venta', 'Rent', 'Sale', 'Playa', 'Cerca Playa', 'Venta Cerca Playa'];
        if (!blackList.includes(candidateLoc)) {
          filters.location = candidateLoc;
        }
      }
    }
  }

  // 6. Furnished Status
  if (lower.includes('unfurnished') || lower.includes('un-furnished')) {
    filters.furnishedStatus = 'UNFURNISHED';
  } else if (lower.includes('semi furnished') || lower.includes('semi-furnished')) {
    filters.furnishedStatus = 'SEMI_FURNISHED';
  } else if (lower.includes('fully furnished') || lower.includes('full furnished') || lower.includes('furnished')) {
    filters.furnishedStatus = 'FULLY_FURNISHED';
  }

  // 7. Amenities Extraction
  const amenityMap = [
    { key: 'swimming pool', aliases: ['swimming pool', 'pool', 'piscina'] },
    { key: 'gym', aliases: ['gym', 'gymnasium', 'fitness', 'gimnasio'] },
    { key: 'parking', aliases: ['parking', 'car parking', 'garage', 'parqueo'] },
    { key: 'power backup', aliases: ['power backup', 'generator', 'full power backup', 'planta electrica', 'planta'] },
    { key: 'elevator', aliases: ['lift', 'elevator', 'ascensor'] },
    { key: 'security', aliases: ['security', '24/7 security', 'guard', 'seguridad'] },
    { key: 'balcony', aliases: ['balcony', 'terrace', 'balcon', 'terraza'] },
    { key: 'garden', aliases: ['garden', 'jardin'] },
    { key: 'air conditioning', aliases: ['ac', 'air conditioning', 'aire acondicionado'] },
    { key: 'clubhouse', aliases: ['clubhouse', 'club house'] },
    { key: 'play area', aliases: ['play area', 'kids play area', 'children play area'] },
  ];

  for (const item of amenityMap) {
    if (item.aliases.some(alias => lower.includes(alias))) {
      if (!filters.amenities.includes(item.key)) {
        filters.amenities.push(item.key);
      }
    }
  }

  // 8. Payment Method (cash, mortgage, payment plan)
  if (lower.match(/\b(cash|contado|efectivo|de contado)\b/i)) {
    filters.paymentMethod = 'CASH';
  } else if (lower.match(/\b(mortgage|loan|financiamiento|banco|prestamo|préstamo|hipoteca|cr[eé]dito)\b/i)) {
    filters.paymentMethod = 'MORTGAGE';
  } else if (lower.match(/\b(cuotas|plan de pago|inicial)\b/i)) {
    filters.paymentMethod = 'PAYMENT_PLAN';
  }

  // 9. Timeline (immediate, 1-3 months, 3-6 months, exploring)
  if (lower.match(/\b(now|ya|de una vez|inmediato|urgente|ready|este mes)\b/i)) {
    filters.timeline = 'IMMEDIATE';
  } else if (lower.match(/\b(1\s*mes|2\s*meses|3\s*meses|1-3\s*months?|en unos meses)\b/i)) {
    filters.timeline = '1_TO_3_MONTHS';
  } else if (lower.match(/\b(3-6\s*meses|este a[nñ]o|segundo semestre)\b/i)) {
    filters.timeline = '3_TO_6_MONTHS';
  } else if (lower.match(/\b(solo viendo|explorando|just looking|curioseando)\b/i)) {
    filters.timeline = 'EXPLORING';
  }

  if (filters.location) {
    filters.location = normalizeLocation(filters.location);
  }

  // Merge with previous conversation filters using smart broadening/restatement detection
  if (previousFilters && typeof previousFilters === 'object') {
    filters = mergeSessionFilters(filters, previousFilters, text);
  }

  return filters;
};

// Smart Multi-Turn Session Filter Merger
// Distinguishes incremental refinements (e.g. "under $1500") from complete re-queries / broadening ("apartment for rent in Bella Vista")
const mergeSessionFilters = (extractedFilters, previousFilters, userQuery = '') => {
  if (!previousFilters || typeof previousFilters !== 'object' || Object.keys(previousFilters).length === 0) {
    return extractedFilters || {};
  }

  const merged = { ...extractedFilters };
  const lowerQ = (userQuery || '').toLowerCase();

  // 1. Broadening / Removal Intent Detection:
  const isBroadeningBedrooms = Boolean(
    lowerQ.match(/\b(any|all|todos|todas|cualquier|cualquiera|sin\s+importar|koi\s*bhi|kuch\s*bhi|saare|sare)\s*(?:habita|bedroom|bhk|bed|cuarto|dormitorio|kamre)?/i) ||
    lowerQ.match(/\b(without\s+bedroom|sin\s+habitaci[oó]n|bina\s+bedroom|no\s+bedroom\s*limit)\b/i)
  );

  const isBroadeningBathrooms = Boolean(
    lowerQ.match(/\b(any|all|todos|todas|cualquier|cualquiera|koi\s*bhi)\s*(?:ba[nñ]o|bath|bathroom)?/i)
  );

  const isBroadeningPrice = Boolean(
    lowerQ.match(/\b(any\s*budget|any\s*price|no\s*budget|no\s*price|sin\s*l[ií]mite|koi\s*bhi\s*budget|koi\s*bhi\s*price|sin\s*presupuesto)\b/i)
  );

  const isBroadeningLocation = Boolean(
    lowerQ.match(/\b(anywhere|any\s*location|everywhere|cualquier\s*lugar|donde\s*sea|kahi\s*bhi|all\s*cities)\b/i)
  );

  const isBroadeningPropertyType = Boolean(
    lowerQ.match(/\b(any\s*property|any\s*type|all\s*properties|cualquier\s*propiedad|koi\s*bhi\s*property)\b/i)
  );

  const isBroadeningSize = Boolean(
    lowerQ.match(/\b(any\s*size|cualquier\s*tama[nñ]o|sin\s*importar\s*(?:el\s*)?tama[nñ]o|koi\s*bhi\s*size|all\s*sizes)\b/i)
  );

  // 2. Complete Standalone Query Detection:
  // If the user's new query specifies both propertyType and location (e.g. "apartment for rent in Bella Vista"),
  // then any omitted attribute (such as bedrooms or bathrooms) is intentionally broadened to all.
  const hasExplicitType = Boolean(merged.propertyType || lowerQ.match(/\b(apartment|flat|apartamento|house|casa|villa|condo|local|office|commercial|land|plot|terreno)\b/i));
  const hasExplicitLoc = Boolean(merged.location || lowerQ.match(/\b(bella\s*vista|piantini|naco|punta\s*cana|santo\s*domingo|gazcue|santiago|bavaro|evaristo|morales|zona\s*colonial|ensanche)\b/i));
  const isCompleteRestatement = hasExplicitType && hasExplicitLoc;

  // 3. Selective inheritance:
  // Listing type
  if (!merged.listingType && previousFilters.listingType) {
    merged.listingType = previousFilters.listingType;
  }

  // Property type
  if (isBroadeningPropertyType) {
    merged.propertyType = null;
  } else if (!merged.propertyType && previousFilters.propertyType) {
    merged.propertyType = previousFilters.propertyType;
  }

  // Location
  if (isBroadeningLocation) {
    merged.location = null;
  } else if (!merged.location && previousFilters.location) {
    merged.location = previousFilters.location;
  }

  // Bedrooms: do NOT inherit if user broadened or restated complete query
  if (isBroadeningBedrooms) {
    merged.bedrooms = null;
  } else if (merged.bedrooms === null || merged.bedrooms === undefined) {
    if (!isCompleteRestatement && previousFilters.bedrooms !== null && previousFilters.bedrooms !== undefined) {
      merged.bedrooms = previousFilters.bedrooms;
    }
  }

  // Bathrooms
  if (isBroadeningBathrooms) {
    merged.bathrooms = null;
  } else if (merged.bathrooms === null || merged.bathrooms === undefined) {
    if (!isCompleteRestatement && previousFilters.bathrooms !== null && previousFilters.bathrooms !== undefined) {
      merged.bathrooms = previousFilters.bathrooms;
    }
  }

  // Price
  if (isBroadeningPrice) {
    merged.minPrice = null;
    merged.maxPrice = null;
  } else if (merged.maxPrice === null && previousFilters.maxPrice !== null && previousFilters.maxPrice !== undefined) {
    const hasNewPriceMention = lowerQ.match(/\b(\d+)\b/) || lowerQ.match(/budget|price|under|below|sasta|mehenga|presupuesto|hasta|menos/i);
    if (!hasNewPriceMention && !isCompleteRestatement) {
      merged.maxPrice = previousFilters.maxPrice;
    }
  }
  if (merged.minPrice === null && previousFilters.minPrice !== null && previousFilters.minPrice !== undefined) {
    if (!isCompleteRestatement) {
      merged.minPrice = previousFilters.minPrice;
    }
  }

  // Size (minSize, maxSize)
  if (isBroadeningSize) {
    merged.minSize = null;
    merged.maxSize = null;
  } else {
    const hasNewSizeMention = lowerQ.match(/m2|mt2|mts|metros|meters|sqm|sqft|sq\s*ft|pies\s*cuadrados|tama[nñ]o|size/i);
    if ((merged.maxSize === null || merged.maxSize === undefined) && previousFilters.maxSize !== null && previousFilters.maxSize !== undefined) {
      if (!hasNewSizeMention && !isCompleteRestatement) {
        merged.maxSize = previousFilters.maxSize;
      }
    }
    if ((merged.minSize === null || merged.minSize === undefined) && previousFilters.minSize !== null && previousFilters.minSize !== undefined) {
      if (!hasNewSizeMention && !isCompleteRestatement) {
        merged.minSize = previousFilters.minSize;
      }
    }
  }

  // Payment method & timeline
  if (!merged.paymentMethod && previousFilters.paymentMethod && !isCompleteRestatement) {
    merged.paymentMethod = previousFilters.paymentMethod;
  }
  if (!merged.timeline && previousFilters.timeline && !isCompleteRestatement) {
    merged.timeline = previousFilters.timeline;
  }
  if (!merged.furnishedStatus && previousFilters.furnishedStatus && !isCompleteRestatement) {
    merged.furnishedStatus = previousFilters.furnishedStatus;
  }
  if (!merged.subType && previousFilters.subType && !isCompleteRestatement) {
    merged.subType = previousFilters.subType;
  }
  if ((!merged.amenities || merged.amenities.length === 0) && Array.isArray(previousFilters.amenities) && previousFilters.amenities.length > 0 && !isCompleteRestatement) {
    merged.amenities = previousFilters.amenities;
  }

  return merged;
};

// Universal Post-Extraction Sanitizer Guard
const sanitizeExtractedFilters = (filters, rawQuery = '') => {
  if (!filters || typeof filters !== 'object') return filters || {};

  // 1. Sanitize location: Prevent price, numbers, or bedrooms from leaking into location
  if (filters.location && typeof filters.location === 'string') {
    let loc = filters.location.trim();

    // Check if price or budget leaked into location (e.g. "Evaristo Max Price 500" or "Piantini under 50")
    const priceLeak = loc.match(/(?:max\s*price|maximum|budget|presupuesto|under|below|menos\s*de|hasta|price|precio)?\s*[:$]?\s*(\d+(?:\.\d+)?)\s*(k|mil|m|mill[oó]n(?:es)?|million|lakh|lac|cr)?\b/i);
    if (priceLeak && priceLeak[1]) {
      const extractedPrice = parsePriceMultiplier(priceLeak[1], priceLeak[2]);
      if (extractedPrice && (!filters.maxPrice || filters.maxPrice === 0)) {
        filters.maxPrice = extractedPrice;
      }

      loc = loc
        .replace(priceLeak[0], '')
        .replace(/\b(?:max\s*price|maximum\s*price|max|budget|presupuesto|under|below|menos\s*de|hasta|price|precio)\b/gi, '')
        .replace(/[,:\-]+/g, '')
        .trim();
    }

    // Clean stray bedroom count from location
    const bedLeak = loc.match(/(\d+)\s*[-]?\s*(?:bhk|bedrooms?|beds?|habitaci[oó]n(?:es)?|cuartos?|dormitorios?)\b/i);
    if (bedLeak && bedLeak[1]) {
      if (!filters.bedrooms) {
        filters.bedrooms = parseInt(bedLeak[1], 10);
      }
      loc = loc.replace(bedLeak[0], '').trim();
    }

    // Clean stray size mention from location (e.g. "Bella Vista 150 m2")
    const sizeLeak = loc.match(/(\d+(?:\.\d+)?)\s*(?:m2|mt2|mts|metros|meters|sq\s*meters|sqm|sqft|sq\s*ft|pies\s*cuadrados)\b/i);
    if (sizeLeak && sizeLeak[1]) {
      const extractedSize = parseFloat(sizeLeak[1]);
      if (extractedSize && (!filters.minSize || filters.minSize === 0)) {
        filters.minSize = extractedSize;
      }
      loc = loc.replace(sizeLeak[0], '').replace(/\b(?:de|con|en)\b/gi, '').trim();
    }

    // Normalize known short aliases
    const lowerLoc = loc.toLowerCase();
    if (lowerLoc === 'evaristo' || lowerLoc.startsWith('evaristo ')) {
      loc = 'Evaristo Morales';
    } else if (lowerLoc === 'punta') {
      loc = 'Punta Cana';
    } else if (lowerLoc === 'bella' && !lowerLoc.includes('vista')) {
      loc = 'Bella Vista';
    }

    // Reject terms that are listing types or proximity phrases mistakenly labelled as location
    const badLocs = new Set(['alquiler', 'venta', 'en alquiler', 'en venta', 'rent', 'buy', 'sale', 'playa', 'cerca de la playa', 'cerca playa', 'venta cerca playa', 'renta']);
    if (badLocs.has(lowerLoc)) {
      loc = '';
    }

    filters.location = loc && loc.length > 0 ? normalizeLocation(loc) : null;
  }

  // 2. Validate and clean numeric values
  if (filters.maxPrice !== null && filters.maxPrice !== undefined) {
    const p = Number(filters.maxPrice);
    filters.maxPrice = (!isNaN(p) && p > 0) ? p : null;
  }
  if (filters.minPrice !== null && filters.minPrice !== undefined) {
    const p = Number(filters.minPrice);
    filters.minPrice = (!isNaN(p) && p > 0) ? p : null;
  }

  // Swap if minPrice > maxPrice
  if (filters.minPrice && filters.maxPrice && filters.minPrice > filters.maxPrice) {
    const temp = filters.minPrice;
    filters.minPrice = filters.maxPrice;
    filters.maxPrice = temp;
  }

  // 3. Normalize bedrooms & bathrooms
  if (filters.bedrooms !== null && filters.bedrooms !== undefined) {
    const b = Number(filters.bedrooms);
    filters.bedrooms = (!isNaN(b) && b > 0) ? b : null;
  }
  if (filters.bathrooms !== null && filters.bathrooms !== undefined) {
    const b = Number(filters.bathrooms);
    filters.bathrooms = (!isNaN(b) && b > 0) ? b : null;
  }

  // 4. Normalize minSize & maxSize
  if (filters.maxSize !== null && filters.maxSize !== undefined) {
    const s = Number(filters.maxSize);
    filters.maxSize = (!isNaN(s) && s > 0) ? s : null;
  }
  if (filters.minSize !== null && filters.minSize !== undefined) {
    const s = Number(filters.minSize);
    filters.minSize = (!isNaN(s) && s > 0) ? s : null;
  }
  if (filters.minSize && filters.maxSize && filters.minSize > filters.maxSize) {
    const temp = filters.minSize;
    filters.minSize = filters.maxSize;
    filters.maxSize = temp;
  }

  // 5. Normalize & validate subType (PENTHOUSE, VILLA, STUDIO, DUPLEX, TOWNHOUSE)
  const lowerQ = (rawQuery || '').toLowerCase();
  if (filters.subType && typeof filters.subType === 'string') {
    const st = filters.subType.trim().toUpperCase();
    if (['PENTHOUSE', 'VILLA', 'STUDIO', 'DUPLEX', 'TOWNHOUSE'].includes(st)) {
      filters.subType = st;
      if (st === 'PENTHOUSE' || st === 'STUDIO') {
        filters.propertyType = 'APARTMENT';
      } else if (st === 'VILLA' || st === 'TOWNHOUSE') {
        filters.propertyType = 'HOUSE';
      }
    } else {
      filters.subType = null;
    }
  }

  // Safety fallback: ensure specialty subtypes are caught even if model omitted them
  if (!filters.subType) {
    if (/\bpent\s*house\b/i.test(lowerQ) || /\b[aá]tico\b/i.test(lowerQ)) {
      filters.subType = 'PENTHOUSE';
      filters.propertyType = 'APARTMENT';
    } else if (/\bvillas?\b/i.test(lowerQ) && !/\bvilla\s+(mella|mar[ií]a|juana|consuelo|francisca)\b/i.test(lowerQ)) {
      filters.subType = 'VILLA';
      filters.propertyType = 'HOUSE';
    } else if (/\b(estudio|studio)\b/i.test(lowerQ)) {
      filters.subType = 'STUDIO';
      filters.propertyType = 'APARTMENT';
    }
  }

  // Safety fallback: ensure "Casa de Campo" is captured as location and NOT as propertyType HOUSE
  if (/\bcasa\s+de\s+campo\b/i.test(lowerQ)) {
    filters.location = 'Casa de Campo';
    if (!/\b(villa|chalet|apartamento|apartment|solar|terreno)\b/i.test(lowerQ)) {
      filters.propertyType = null;
    }
  }

  return filters;
};

const detectQueryLanguage = (text) => {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase();
  const spanishMarkers = [
    /\b(?:quiero|quisiera|busco|buscar|comprar|compra|alquilar|alquiler|rentar|renta|vivienda|apartamento|habitaci[oó]n|habitaciones|dormitorio|dormitorios|baño|baños|cuartos|piscina|parqueo|amueblado|en\s+venta|para\s+alquilar)\b/i,
    /\b(?:en|con|para|por)\s+(?:comprar|alquilar|venta|alquiler|casa|piso|apartamento)\b/i,
    /\b(?:una|un)\s+(?:casa|apartamento|piso|solar|terreno|local)\b/i,
  ];
  if (spanishMarkers.some(regex => regex.test(lower))) {
    return 'es';
  }
  return null;
};

const chatSearch = async (req, res, next) => {
  try {
    const userQuery = req.body?.query || req.body?.message || req.query?.query;
    const chatId = req.body?.chatId || req.query?.chatId;

    console.log(userQuery)
    // Extract user if authorization token is provided
    let userId = req.user ? req.user._id : null;
    if (!userId && req.headers?.authorization && req.headers.authorization.startsWith('Bearer')) {
      try {
        const token = req.headers.authorization.split(' ')[1];
        if (token && token !== 'null' && token !== 'undefined') {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          if (decoded && decoded.id) {
            const authenticatedUser = await User.findById(decoded.id).select('_id isActive preferredLanguage role tier aiChatUsage');
            if (authenticatedUser && authenticatedUser.isActive !== false) {
              userId = authenticatedUser._id;
              req.user = authenticatedUser;
            }
          }
        }
      } catch (authErr) {
        console.warn(`Optional token verification failed: ${authErr.message}`);
      }
    }

    let lang = resolveLanguage(req, req.user);
    // Auto-detect Spanish if client didn't explicitly specify language AND user has no preferredLanguage
    const hasExplicitLang = req.body?.language || req.body?.lang || req.body?.langInput || req.body?.preferredLanguage || req.query?.lang || req.query?.language || req.query?.langInput;
    if (!hasExplicitLang && (!req.user || !req.user.preferredLanguage) && userQuery) {
      const detected = detectQueryLanguage(userQuery);
      if (detected) {
        lang = detected;
      }
    }

    if (!userQuery || typeof userQuery !== 'string' || userQuery.trim() === '') {
      const error = new Error(lang === 'es' ? 'La consulta o mensaje de búsqueda es obligatorio' : 'Query / message is required');
      error.statusCode = 400;
      return next(error);
    }

    // Agent Daily AI Chat Limit check (Tier 1 = max 5 chats/day, Tier 2/3 = unlimited)
    let agentQuotaInfo = null;
    if (userId) {
      let currentUser = req.user;
      if (!currentUser || !currentUser.role || currentUser.aiChatUsage === undefined) {
        currentUser = await User.findById(userId).select('_id isActive preferredLanguage role tier aiChatUsage');
      }

      if (currentUser && currentUser.role === 'agent') {
        const agentTierLevel = await getAgentTierLevel(currentUser);
        if (agentTierLevel === 1) {
          const today = new Date().toISOString().split('T')[0];
          const lastDate = currentUser.aiChatUsage?.lastUsedDate;
          const countToday = (lastDate === today) ? (Number(currentUser.aiChatUsage?.count) || 0) : 0;

          if (countToday >= 5) {
            const limitMessage = lang === 'es'
              ? 'Has alcanzado el límite diario de 5 consultas de IA de tu plan Básico. Actualiza a Pro o Founding Sponsor para consultas ilimitadas.'
              : 'You have reached your daily limit of 5 AI queries for the Basic Tier. Upgrade to Pro or Founding Sponsor for unlimited AI searches.';

            return res.status(429).json({
              success: false,
              code: 'DAILY_AI_LIMIT_REACHED',
              message: limitMessage,
              data: {
                tierLevel: 1,
                dailyLimit: 5,
                usedToday: countToday,
                remainingToday: 0,
              },
            });
          }

          // Atomic increment with lazy reset
          if (lastDate !== today) {
            await User.findByIdAndUpdate(userId, {
              $set: {
                'aiChatUsage.count': 1,
                'aiChatUsage.lastUsedDate': today,
              },
            });
          } else {
            await User.findByIdAndUpdate(userId, {
              $inc: { 'aiChatUsage.count': 1 },
            });
          }

          agentQuotaInfo = {
            tierLevel: 1,
            dailyLimit: 5,
            usedToday: countToday + 1,
            remainingToday: Math.max(0, 5 - (countToday + 1)),
          };
        } else {
          // Tier 2 or Tier 3: Unlimited AI chat
          agentQuotaInfo = {
            tierLevel: agentTierLevel,
            unlimited: true,
          };
        }
      }
    }

    console.log(`\n--- Incoming AI Natural Language Search ---`);
    console.log(`Query: "${userQuery}"`);
    if (chatId) console.log(`Continuing Session: ${chatId}`);

    // Check if chatId is provided and fetch existing session to get conversational context
    let existingSession = null;
    let previousFilters = {};
    let conversationHistory = [];

    if (chatId && mongoose.Types.ObjectId.isValid(chatId)) {
      if (userId) {
        existingSession = await ChatSession.findOne({ _id: chatId, user: userId });
      } else {
        existingSession = await ChatSession.findById(chatId);
      }
      if (existingSession) {
        previousFilters = existingSession.currentFilters || {};
        console.log('Loaded previous session filters:', JSON.stringify(previousFilters));
        if (Array.isArray(existingSession.messages) && existingSession.messages.length > 0) {
          conversationHistory = existingSession.messages.slice(-4).map(m => ({
            role: m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content || '',
            filters: m.extractedFilters || null,
          }));
        }
      } else {
        console.log(`ChatSession ${chatId} not found, starting fresh session.`);
      }
    }

    let extractedFilters = null;
    const cacheKey = getQueryCacheKey(userQuery, previousFilters);
    const cachedResult = await getCachedQueryFilters(cacheKey);

    if (cachedResult) {
      console.log(`[Cache Hit] Filters loaded from Redis/in-memory cache for query "${userQuery}" in <1ms.`);
      extractedFilters = cachedResult;
    } else {
      // Direct Pure AI Dialogue State Tracking (AI naturally tracks refinements, overrides, and broadening)
      extractedFilters = await extractFiltersDirectAI(userQuery, previousFilters, conversationHistory);

      // Emergency offline fallback only if AI services are completely down
      if (!extractedFilters) {
        console.log('AI unreachable, using offline fallback parser...');
        extractedFilters = parseFiltersFallback(userQuery, previousFilters);
        if (previousFilters && Object.keys(previousFilters).length > 0) {
          extractedFilters = mergeSessionFilters(extractedFilters, previousFilters, userQuery);
        }
      }

      // Safety sanitation and location normalization
      extractedFilters = sanitizeExtractedFilters(extractedFilters, userQuery);

      // Save into L1 In-Memory + L2 Redis shared query filter cache
      if (extractedFilters) {
        await setCachedQueryFilters(cacheKey, extractedFilters);
      }
    }

    // Build Dynamic MongoDB Query using the extracted filters (only Active properties)
    const mongoQuery = { status: 'Active' };

    // 1. Listing Type (RENT / BUY)
    let normalizedListing = null;
    if (extractedFilters.listingType) {
      normalizedListing = normalizeListingType(extractedFilters.listingType);
      if (normalizedListing) {
        mongoQuery.listingType = normalizedListing;
      }
    }

    // 2. Property Type & Specialty SubType (PENTHOUSE, VILLA, STUDIO, etc.)
    const subtypeConditions = [];
    if (extractedFilters.subType === 'PENTHOUSE') {
      mongoQuery.propertyType = 'APARTMENT';
      subtypeConditions.push(
        { 'title.es': /penthouse|pent\s*house|[aá]tico/i },
        { 'title.en': /penthouse|pent\s*house/i },
        { 'description.es': /penthouse|pent\s*house|[aá]tico/i },
        { 'description.en': /penthouse|pent\s*house/i }
      );
    } else if (extractedFilters.subType === 'VILLA') {
      mongoQuery.propertyType = 'HOUSE';
      subtypeConditions.push(
        { 'title.es': /\bvillas?\b/i },
        { 'title.en': /\bvillas?\b/i },
        { 'description.es': /\bvillas?\b/i },
        { 'description.en': /\bvillas?\b/i }
      );
    } else if (extractedFilters.subType === 'STUDIO') {
      mongoQuery.propertyType = 'APARTMENT';
      subtypeConditions.push(
        { 'title.es': /\b(estudio|studio)\b/i },
        { 'title.en': /\b(studio|estudio)\b/i },
        { 'description.es': /\b(estudio|studio)\b/i },
        { 'description.en': /\b(studio|estudio)\b/i }
      );
    } else if (extractedFilters.propertyType) {
      const normalizedProp = normalizePropertyType(extractedFilters.propertyType);
      if (normalizedProp) {
        mongoQuery.propertyType = normalizedProp;
      }
    }

    // 3. Bedrooms (supports single number or array range [2, 3])
    if (Array.isArray(extractedFilters.bedrooms) && extractedFilters.bedrooms.length > 0) {
      const validBeds = extractedFilters.bedrooms.map(Number).filter(n => !isNaN(n));
      if (validBeds.length === 1) {
        mongoQuery.bedrooms = validBeds[0];
      } else if (validBeds.length > 1) {
        mongoQuery.bedrooms = { $in: validBeds };
      }
    } else if (extractedFilters.bedrooms !== null && extractedFilters.bedrooms !== undefined && !isNaN(Number(extractedFilters.bedrooms))) {
      mongoQuery.bedrooms = Number(extractedFilters.bedrooms);
    }

    // 4. Bathrooms
    if (extractedFilters.bathrooms !== null && extractedFilters.bathrooms !== undefined && !isNaN(Number(extractedFilters.bathrooms))) {
      mongoQuery.bathrooms = Number(extractedFilters.bathrooms);
    }

    // 5. Price Range & 30K Threshold (Rent < 30K, Buy >= 30K)
    const priceConditions = [];
    const minP = extractedFilters.minPrice ? Number(extractedFilters.minPrice) : null;
    const maxP = extractedFilters.maxPrice ? Number(extractedFilters.maxPrice) : null;

    if (normalizedListing === 'BUY') {
      const usdCond = { $gte: 30000 };
      if (minP && !isNaN(minP) && minP > 0) {
        usdCond.$gte = Math.max(30000, minP);
      }
      if (maxP && !isNaN(maxP) && maxP > 0) {
        usdCond.$lte = maxP;
      }
      if (!minP) {
        priceConditions.push(
          { 'price.usd': usdCond },
          { 'price.usd': 0 }
        );
      } else {
        mongoQuery['price.usd'] = usdCond;
      }
    } else if (normalizedListing === 'RENT') {
      const usdCond = { $lt: 30000, $gt: 0 };
      if (minP && !isNaN(minP) && minP > 0) {
        usdCond.$gte = minP;
      }
      if (maxP && !isNaN(maxP) && maxP > 0) {
        if (maxP < 30000) {
          usdCond.$lte = maxP;
          delete usdCond.$lt;
        }
      }
      mongoQuery['price.usd'] = usdCond;
    } else if (minP || maxP) {
      const usdCond = {};
      if (minP && !isNaN(minP)) usdCond.$gte = minP;
      if (maxP && !isNaN(maxP) && maxP > 0) usdCond.$lte = maxP;
      if (Object.keys(usdCond).length > 0) {
        mongoQuery['price.usd'] = usdCond;
      }
    }

    // 6. Property Area / Size (minSize / maxSize)
    const minS = extractedFilters.minSize ? Number(extractedFilters.minSize) : null;
    const maxS = extractedFilters.maxSize ? Number(extractedFilters.maxSize) : null;
    if ((minS && !isNaN(minS) && minS > 0) || (maxS && !isNaN(maxS) && maxS > 0)) {
      const sizeCond = {};
      if (minS && !isNaN(minS) && minS > 0) sizeCond.$gte = minS;
      if (maxS && !isNaN(maxS) && maxS > 0) sizeCond.$lte = maxS;
      if (Object.keys(sizeCond).length > 0) {
        mongoQuery.size = sizeCond;
      }
    }

    // 7. Location (Search across city, area, address, state)
    let locConditions = [];
    if (extractedFilters.location && extractedFilters.location.trim() !== '') {
      locConditions = buildLocationConditions(extractedFilters.location);
    }

    // Combine conditions cleanly so location, subtype, and price don't overwrite each other
    const andClauses = [];
    if (locConditions.length > 0) {
      if (locConditions[0] && locConditions[0].$or) {
        andClauses.push(...locConditions);
      } else {
        andClauses.push({ $or: locConditions });
      }
    }
    if (subtypeConditions.length > 0) {
      andClauses.push({ $or: subtypeConditions });
    }
    if (priceConditions.length > 0) {
      andClauses.push({ $or: priceConditions });
    }
    if (andClauses.length === 1) {
      mongoQuery.$or = andClauses[0].$or;
    } else if (andClauses.length > 1) {
      mongoQuery.$and = andClauses;
    }

    const hasFilters = Boolean(
      (extractedFilters?.location && extractedFilters.location.trim() !== '') ||
      extractedFilters?.propertyType ||
      extractedFilters?.subType ||
      extractedFilters?.listingType ||
      (extractedFilters?.bedrooms !== null && extractedFilters?.bedrooms !== undefined) ||
      (extractedFilters?.bathrooms !== null && extractedFilters?.bathrooms !== undefined) ||
      (extractedFilters?.minPrice !== null && extractedFilters?.minPrice !== undefined) ||
      (extractedFilters?.maxPrice !== null && extractedFilters?.maxPrice !== undefined) ||
      (extractedFilters?.minSize !== null && extractedFilters?.minSize !== undefined) ||
      (extractedFilters?.maxSize !== null && extractedFilters?.maxSize !== undefined)
    );

    let properties = [];
    let isExactMatch = true;
    let isFallback = false;
    let fallbackType = null;
    let fallbackLocation = null;

    if (hasFilters) {
      console.log('Generated MongoDB Query (Strict Exact Match):', JSON.stringify(mongoQuery, null, 2));

      // Execute query in MongoDB (only Active properties) with lean, projection, and candidate pool optimization
      let propertyQuery = Property.find(mongoQuery)
        .select('title description price propertyType listingType location bedrooms bathrooms size sizeUnit images agency agent status createdAt')
        .populate({
          path: 'agency',
          select: 'name logo website isFoundingSponsor tier brandColorHex corporateCallCenterPhone corporateWhatsapp masterPortalUrl corporateEmail',
          populate: {
            path: 'tier',
          },
        })
        .populate({
          path: 'agent',
          select: 'name phone email profileImage tier whatsapp isCoveredByAgency',
          populate: { path: 'tier' }
        })
        .sort({ createdAt: -1 })
        .lean();

      // For AI chat, we only ever present top 3 recommendations.
      // Limit candidate retrieval pool to 30 (or user-specified limit) so MongoDB doesn't transfer 1000+ docs into RAM.
      const candidateLimit = req.body?.limit ? Math.min(Number(req.body.limit), 50) : 30;
      propertyQuery = propertyQuery.limit(candidateLimit);

      properties = await propertyQuery;
      console.log(`Strict Exact Match found ${properties.length} matching properties.`);

      // Strict Exact Match Rule:
      // If 0 properties match the exact criteria (e.g. house, apartment, price, location),
      // we strictly return empty results (do NOT substitute other property types or relax filters).
      isExactMatch = properties.length > 0;
      isFallback = false;
      fallbackType = null;
      fallbackLocation = null;
    } else {
      console.log('No search criteria detected (casual message / greeting). Skipping database property search.');
    }


    // =========================================================================
    // 3-TIER COMMERCIAL SORTING & TIER DATA INJECTION
    // =========================================================================

    const defaultTier1 = await getDefaultTier1();

    // 1. Har property me uska exact Tier, uiStyle, aur ctaAction assign karein
    const enrichedProperties = properties.map(doc => {
      const prop = formatPropertyData(doc, lang);
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
    // =========================================================================
    // TIER-BASED SORT: Tier 3 -> Tier 2 -> Tier 1
    // =========================================================================
    enrichedProperties.sort((a, b) => {
      const tierA = a.tier?.tierLevel || 1;
      const tierB = b.tier?.tierLevel || 1;

      if (tierA !== tierB) {
        return tierB - tierA; // 3 first, then 2, then 1
      }

      // Same tier me latest property pehle
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    const formattedProperties = enrichedProperties;
    const totalFound = formattedProperties.length;

    // =========================================================================
    // TOP 3 RECOMMENDATIONS: sorted list se direct top 3
    // =========================================================================
    let finalProperties = [];
    let topRecommendations = [];

    if (hasFilters && totalFound > 0) {
      // Tier-based sorting ke baad top 3 properties
      const topCandidates = formattedProperties.slice(0, 3);

      // Baaki properties response me nahi bhejni
      // Use instant 3-tier contextual templates by default (forceAIPitch=false saves ~3.7s)
      const forceAIPitch = req.body?.aiPitch === true || req.query?.aiPitch === 'true';
      topRecommendations = await generateWhyThisProperty(
        topCandidates,
        userQuery,
        extractedFilters,
        lang,
        forceAIPitch
      );

      finalProperties = topRecommendations;
    } else {
      finalProperties = [];
    }

    let searchMessage;
    if (!hasFilters) {
      // User sent greeting or casual message (0% search filter match)
      if (lang === 'es') {
        searchMessage = '¡Hola! Soy tu asistente de bienes raíces con IA. Puedo ayudarte a encontrar apartamentos, casas, villas, terrenos o locales comerciales según tu presupuesto y ubicación preferida. ¿Qué tipo de propiedad estás buscando?';
      } else {
        searchMessage = "Hello! I am your AI Real Estate Assistant. I can help you find Flats, Houses, Villas, Plots, or Commercial shops based on your budget and preferred location. Please let me know what kind of property you are looking for!";
      }
    } else if (totalFound === 0) {
      // Search criteria was provided but 0 properties match in DB - Instant localized response in 0ms
      searchMessage = generateNoResultsMessage(userQuery, extractedFilters, lang);
    } else if (isFallback) {
      const locName = fallbackLocation || extractedFilters?.location || '';
      if (lang === 'es') {
        searchMessage = totalFound === 1
          ? `No se encontraron coincidencias exactas para sus filtros. Mostrando 1 propiedad disponible en ${locName}.`
          : `No se encontraron coincidencias exactas para sus filtros. Mostrando ${totalFound} propiedades disponibles en ${locName}.`;
      } else {
        searchMessage = totalFound === 1
          ? `No exact matches found for your criteria. Showing 1 available property in ${locName}.`
          : `No exact matches found for your criteria. Showing ${totalFound} available properties in ${locName}.`;
      }
    } else {
      const recCount = topRecommendations.length;
      if (lang === 'es') {
        searchMessage = recCount === 1
          ? 'Aquí está la mejor propiedad recomendada según tu búsqueda.'
          : `Aquí están las ${recCount} mejores propiedades recomendadas según tu búsqueda.`;
      } else {
        searchMessage = recCount === 1
          ? 'Here is the top recommended property based on your search.'
          : `Here are the top ${recCount} recommended properties based on your search.`;
      }
    }

    // Automatically save user search in ChatSession and sync with legacy history
    let savedSearchDoc = null;
    let activeChatId = null;
    let sessionTitle = null;

    if (userId) {
      const recommendedPropertyIds = (topRecommendations || []).map((p) => p._id).filter(Boolean);
      const recommendedCount = recommendedPropertyIds.length;
      const recDetails = (topRecommendations || []).map((p, idx) => ({
        propertyId: p._id,
        whyThisProperty: p.whyThisProperty || null,
        recommendationRank: p.recommendationRank || (idx + 1),
        isTopRecommendation: p.isTopRecommendation !== undefined ? p.isTopRecommendation : true,
      }));

      try {
        if (existingSession) {
          // Append user query and model response to existing chat session
          existingSession.messages.push({
            role: 'user',
            content: userQuery,
            createdAt: new Date(),
          });

          existingSession.messages.push({
            role: 'model',
            content: searchMessage,
            extractedFilters: extractedFilters || {},
            properties: recommendedPropertyIds,
            recommendations: recDetails,
            totalFound: recommendedCount,
            isExactMatch,
            isFallback,
            fallbackType,
            fallbackLocation: isFallback ? (fallbackLocation || extractedFilters?.location) : null,
            createdAt: new Date(),
          });

          existingSession.currentFilters = extractedFilters || {};
          existingSession.lastMessageAt = new Date();
          await existingSession.save();

          activeChatId = existingSession._id.toString();
          sessionTitle = existingSession.title;
          console.log(`Existing ChatSession updated for chatId: ${activeChatId}`);
        } else {
          // Create new chat session
          let titleSnippet = userQuery.trim();
          if (titleSnippet.length > 35) {
            titleSnippet = titleSnippet.substring(0, 32) + '...';
          }
          sessionTitle = titleSnippet;

          const newSession = await ChatSession.create({
            user: userId,
            title: sessionTitle,
            currentFilters: extractedFilters || {},
            lastMessageAt: new Date(),
            messages: [
              {
                role: 'user',
                content: userQuery,
                createdAt: new Date(),
              },
              {
                role: 'model',
                content: searchMessage,
                extractedFilters: extractedFilters || {},
                properties: recommendedPropertyIds,
                recommendations: recDetails,
                totalFound: recommendedCount,
                isExactMatch,
                isFallback,
                fallbackType,
                fallbackLocation: isFallback ? (fallbackLocation || extractedFilters?.location) : null,
                createdAt: new Date(),
              },
            ],
          });

          activeChatId = newSession._id.toString();
          console.log(`New ChatSession created for user: ${userId} with ID: ${activeChatId}`);
        }
      } catch (sessionErr) {
        console.warn(`Could not save ChatSession: ${sessionErr.message}`);
      }

      // User AI search history sync in background (non-blocking)
      const historyEntry = {
        query: userQuery,
        extractedFilters: extractedFilters || {},
        totalFound: recommendedCount,
        properties: recommendedPropertyIds,
        searchedAt: new Date(),
      };

      User.findByIdAndUpdate(userId, {
        $push: {
          aiSearchHistory: {
            $each: [historyEntry],
            $position: 0,
            $slice: 50,
          },
        },
      }).catch(userHistErr => console.warn(`Could not save AI search to user model: ${userHistErr.message}`));
    }

    SearchLog.create({
      query: userQuery,
      location: extractedFilters?.location ? extractedFilters.location.trim().toLowerCase() : '',
      filters: {
        bedrooms: (extractedFilters?.bedrooms !== null && extractedFilters?.bedrooms !== undefined) ? Number(extractedFilters.bedrooms) : null,
        minPrice: extractedFilters?.minPrice ? Number(extractedFilters.minPrice) : null,
        maxPrice: extractedFilters?.maxPrice ? Number(extractedFilters.maxPrice) : null,
        propertyType: extractedFilters?.propertyType || null,
        subType: extractedFilters?.subType || null,
        minSize: extractedFilters?.minSize ? Number(extractedFilters.minSize) : null,
        maxSize: extractedFilters?.maxSize ? Number(extractedFilters.maxSize) : null,
      },
      resultsCount: formattedProperties.length, // AI query par mili properties ki sankhya
      userId: userId || null,
      searchType: 'ai',
    }).catch(err => console.error('AI Search Activity log error:', err.message));

    console.log(extractedFilters)

    return res.status(200).json({
      success: true,
      message: searchMessage,
      data: {
        chatId: activeChatId,
        title: sessionTitle || (existingSession ? existingSession.title : 'Property Search'),
        langInput: lang,
        language: lang === 'es' ? 'Spanish' : 'English',
        savedSearchId: savedSearchDoc ? savedSearchDoc._id : null,
        message: userQuery,
        isExactMatch,
        isFallback,
        fallbackType,
        fallbackLocation: isFallback ? (fallbackLocation || extractedFilters.location) : null,
        extractedFilters: {
          langInput: lang,
          ...extractedFilters,
        },
        totalFound: topRecommendations.length,
        topRecommendations: topRecommendations,
        ...(agentQuotaInfo ? { aiChatQuota: agentQuotaInfo } : {}),
      },
    });
  } catch (err) {
    console.error(`AI Search Error: ${err.message}`);
    next(err);
  }
};

const getRecentlyAISearch = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const lang = resolveLanguage(req);
    const defaultTier1 = await Tier.findOne({ tierLevel: 1 });

    const user = await User.findById(userId)
      .select('aiSearchHistory')
      .populate({
        path: 'aiSearchHistory.properties',
        populate: [
          {
            path: 'agency',
            select: 'name logo website isFoundingSponsor tier agentSeatsLimit coveredAgentsCount',
            populate: {
              path: 'tier'
            }
          },
          { path: 'agent', select: 'name phone email profileImage' }
        ],
      });

    if (!user) {
      const error = new Error(lang === 'es' ? 'Usuario no encontrado' : 'User not found');
      error.statusCode = 404;
      return next(error);
    }

    const history = (user.aiSearchHistory || []).map(item => {
      const obj = item.toObject ? item.toObject() : { ...item };
      if (Array.isArray(obj.properties)) {
        obj.properties = obj.properties.map(p => {
          if (!p) return null;
          const prop = formatPropertyData(p, lang);
          if (prop) {
            let assignedTier = defaultTier1;
            if (p.agency && p.agency.tier && typeof p.agency.tier === 'object') {
              assignedTier = p.agency.tier;
            } else if (p.agency && p.agency.isFoundingSponsor) {
              assignedTier = {
                tierLevel: 3,
                name: 'Tier 3 — Founding Sponsor',
                uiAppearance: { badgeType: 'GOLDEN_STAR', enableShimmerAnimation: true, hasCardHighlight: true },
                conversionAndLeads: { external_webview: false, whatapps_button: true, enableNativeLeadNotifications: true }
              };
            }
            prop.tier = assignedTier;
            if (prop.agency && typeof prop.agency === 'object') {
              prop.agency.tier = assignedTier;
            }
          }
          return prop;
        }).filter(Boolean);
      }
      return obj;
    });
    const total = history.length;

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('aiHistoryRetrieved', lang),
      data: {
        language: lang === 'es' ? 'Spanish' : 'English',
        total,
        history,
      },
    });
  } catch (err) {
    console.error(`Get recent AI search history error: ${err.message}`);
    next(err);
  }
};

const deleteAISearchHistory = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const lang = resolveLanguage(req);

    // Clear all search history
    await User.findByIdAndUpdate(userId, {
      $set: { aiSearchHistory: [] },
    });

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('aiHistoryDeleted', lang),
      data: {
        remainingCount: 0,
      },
    });
  } catch (err) {
    console.error(`Delete AI search history error: ${err.message}`);
    next(err);
  }
};

const deleteAISearchHistoryById = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const lang = resolveLanguage(req);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error(lang === 'es' ? 'Formato de ID no válido' : 'Invalid ID format');
      error.statusCode = 400;
      return next(error);
    }

    const user = await User.findById(userId);
    if (!user) {
      const error = new Error(lang === 'es' ? 'Usuario no encontrado' : 'User not found');
      error.statusCode = 404;
      return next(error);
    }

    user.aiSearchHistory = (user.aiSearchHistory || []).filter(item => item._id.toString() !== id);
    await user.save();

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('aiHistoryItemDeleted', lang),
      data: {
        id,
      },
    });
  } catch (err) {
    console.error(`Delete single AI search error: ${err.message}`);
    next(err);
  }
};

const getChatSessions = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const lang = resolveLanguage(req);

    const sessions = await ChatSession.find({ user: userId })
      .sort({ lastMessageAt: -1 })
      .select('title currentFilters lastMessageAt createdAt messages');

    const formattedSessions = sessions.map((s) => {
      const msgs = s.messages || [];
      const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      return {
        chatId: s._id,
        title: s.title,
        lastMessage: lastMsg ? lastMsg.content : '',
        lastMessageRole: lastMsg ? lastMsg.role : null,
        totalMessages: msgs.length,
        currentFilters: s.currentFilters || {},
        lastMessageAt: s.lastMessageAt || s.updatedAt,
        createdAt: s.createdAt,
      };
    });

    res.status(200).json({
      success: true,
      message: lang === 'es' ? 'Sesiones de chat recuperadas con éxito' : 'Chat sessions retrieved successfully',
      data: {
        total: formattedSessions.length,
        chats: formattedSessions,
      },
    });
  } catch (err) {
    console.error(`Get chat sessions error: ${err.message}`);
    next(err);
  }
};

const getChatSessionById = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { chatId } = req.params;
    const lang = resolveLanguage(req);

    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      const error = new Error(lang === 'es' ? 'Formato de ID de chat no válido' : 'Invalid chatId format');
      error.statusCode = 400;
      return next(error);
    }

    const defaultTier1 = await Tier.findOne({ tierLevel: 1 });

    const session = await ChatSession.findOne({ _id: chatId, user: userId }).populate({
      path: 'messages.properties',
      populate: [
        {
          path: 'agency',
          select: 'name logo website isFoundingSponsor tier agentSeatsLimit coveredAgentsCount',
          populate: {
            path: 'tier'
          }
        },
        { path: 'agent', select: 'name phone email profileImage' }
      ],
    });

    if (!session) {
      const error = new Error(lang === 'es' ? 'Sesión de chat no encontrada' : 'Chat session not found');
      error.statusCode = 404;
      return next(error);
    }

    const formattedMessages = session.messages.map((msg) => {
      const msgObj = msg.toObject ? msg.toObject() : { ...msg };
      const recMap = new Map();
      if (Array.isArray(msgObj.recommendations)) {
        msgObj.recommendations.forEach((r) => {
          if (r && r.propertyId) {
            recMap.set(r.propertyId.toString(), r);
          }
        });
      }

      if (Array.isArray(msgObj.properties)) {
        const topSlice = msgObj.properties.slice(0, 3);
        msgObj.properties = topSlice.map((p, index) => {
          if (!p) return null;
          const prop = formatPropertyData(p, lang);
          if (prop) {
            let assignedTier = defaultTier1;
            if (p.agency && p.agency.tier && typeof p.agency.tier === 'object') {
              assignedTier = p.agency.tier;
            } else if (p.agency && p.agency.isFoundingSponsor) {
              assignedTier = {
                tierLevel: 3,
                name: 'Tier 3 — Founding Sponsor',
                uiAppearance: { badgeType: 'GOLDEN_STAR', enableShimmerAnimation: true, hasCardHighlight: true },
                conversionAndLeads: { external_webview: false, whatapps_button: true, enableNativeLeadNotifications: true }
              };
            }
            prop.tier = assignedTier;
            if (prop.agency && typeof prop.agency === 'object') {
              prop.agency.tier = assignedTier;
            }

            // Retrieve saved whyThisProperty or generate contextual fallback
            const propIdStr = (p._id || prop._id || '').toString();
            const rec = recMap.get(propIdStr);
            if (rec && rec.whyThisProperty) {
              prop.isTopRecommendation = rec.isTopRecommendation !== undefined ? rec.isTopRecommendation : true;
              prop.recommendationRank = rec.recommendationRank || (index + 1);
              prop.whyThisProperty = rec.whyThisProperty;
            } else {
              const isSpanish = (lang === 'es');
              const loc = [prop.location?.area, prop.location?.city].filter(Boolean).join(', ') || prop.location?.address || (isSpanish ? 'esta ubicación' : 'this location');
              const beds = prop.bedrooms ? (isSpanish ? `${prop.bedrooms} hab.` : `${prop.bedrooms} beds`) : '';
              const priceStr = prop.price?.usd ? `$${prop.price.usd.toLocaleString()}` : (prop.price?.dop ? `RD$${prop.price.dop.toLocaleString()}` : '');

              let reason = '';
              if (isSpanish) {
                if (index === 0) reason = `Excelente opción en ${loc}${beds ? ` con ${beds}` : ''}${priceStr ? ` dentro de tu presupuesto (${priceStr})` : ''}.`;
                else if (index === 1) reason = `Gran alternativa en ${loc} que se adapta muy bien a tus preferencias${priceStr ? ` a ${priceStr}` : ''}.`;
                else reason = `Opción destacada en ${loc} con excelente relación calidad-precio y comodidades.`;
              } else {
                if (index === 0) reason = `Top match in ${loc}${beds ? ` with ${beds}` : ''}${priceStr ? ` fitting your budget (${priceStr})` : ''}.`;
                else if (index === 1) reason = `Great alternative in ${loc} matching your criteria${priceStr ? ` at ${priceStr}` : ''}.`;
                else reason = `Featured option in ${loc} offering great value and prime amenities.`;
              }

              prop.isTopRecommendation = true;
              prop.recommendationRank = index + 1;
              prop.whyThisProperty = reason;
            }
          }
          return prop;
        }).filter(Boolean);
        msgObj.totalFound = msgObj.properties.length;
      }
      return msgObj;
    });

    res.status(200).json({
      success: true,
      message: lang === 'es' ? 'Historial de chat recuperado con éxito' : 'Chat history retrieved successfully',
      data: {
        chatId: session._id,
        title: session.title,
        currentFilters: session.currentFilters || {},
        totalMessages: session.messages.length,
        messages: formattedMessages,
        lastMessageAt: session.lastMessageAt,
        createdAt: session.createdAt,
      },
    });
  } catch (err) {
    console.error(`Get chat session by ID error: ${err.message}`);
    next(err);
  }
};

const deleteChatSession = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { chatId } = req.params;
    const lang = resolveLanguage(req);

    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      const error = new Error(lang === 'es' ? 'Formato de ID de chat no válido' : 'Invalid chatId format');
      error.statusCode = 400;
      return next(error);
    }

    const deletedSession = await ChatSession.findOneAndDelete({ _id: chatId, user: userId });
    if (!deletedSession) {
      const error = new Error(lang === 'es' ? 'Sesión de chat no encontrada' : 'Chat session not found');
      error.statusCode = 404;
      return next(error);
    }

    res.status(200).json({
      success: true,
      message: lang === 'es' ? 'Sesión de chat eliminada con éxito' : 'Chat session deleted successfully',
      data: {
        chatId,
      },
    });
  } catch (err) {
    console.error(`Delete chat session error: ${err.message}`);
    next(err);
  }
};

const clearAllChatSessions = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const lang = resolveLanguage(req);

    const result = await ChatSession.deleteMany({ user: userId });

    res.status(200).json({
      success: true,
      message: lang === 'es' ? 'Todas las sesiones de chat eliminadas con éxito' : 'All chat sessions deleted successfully',
      data: {
        deletedCount: result.deletedCount,
      },
    });
  } catch (err) {
    console.error(`Clear all chat sessions error: ${err.message}`);
    next(err);
  }
};

module.exports = {
  chatSearch,
  getRecentlyAISearch,
  deleteAISearchHistory,
  deleteAISearchHistoryById,
  getChatSessions,
  getChatSessionById,
  deleteChatSession,
  clearAllChatSessions,
};