const https = require('https');
const mongoose = require('mongoose');
const Property = require('../models/Property');
const Agency = require('../models/Agency');
const User = require('../models/User');
const Tier = require('../models/Tier');

const REMAX_API_BASE = 'https://api-do.redremax.com/remaxweb-do/api';
const CLOUDFRONT_BASE = 'https://d2wmn85efv2gey.cloudfront.net';

/**
 * Global In-Memory Sync Progress State
 * Can be inspected anytime via getSyncStatus()
 */
let syncState = {
  isSyncing: false,
  status: 'IDLE', // 'IDLE' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'FAILED'
  jobId: null,
  syncAll: false,
  currentPage: 0,
  totalPages: 0,
  totalItemsEstimated: 0,
  processed: 0,
  inserted: 0,
  updated: 0,
  errorsCount: 0,
  progressPercent: '0%',
  startedAt: null,
  completedAt: null,
  elapsedSeconds: 0,
  lastSyncedProperty: null,
  errors: [],
};

let cancelRequested = false;

/**
 * Helper to make HTTPS requests to REMAX REST API
 */
const fetchRemaxJson = (url, timeoutMs = 12000) => {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://www.remaxrd.com',
        'Referer': 'https://www.remaxrd.com/',
      },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.on('error', () => {
      resolve(null);
    });
  });
};

/**
 * Detect Dominican Republic City and Area from address text
 */
const parseDRLocation = (addressInfo, title, coordinates) => {
  const combined = `${addressInfo || ''} ${title || ''}`.toLowerCase();
  const tokens = String(addressInfo || '').split(',').map(t => t.trim()).filter(Boolean);
  let rawArea = tokens[0] || '';

  // Clean area string from cabecera annotations
  rawArea = rawArea.replace(/\(cabecera\)/gi, '').trim();

  let city = 'Santo Domingo';
  let area = rawArea || 'Distrito Nacional';
  let state = 'Distrito Nacional';

  if (combined.includes('punta cana') || combined.includes('bávaro') || combined.includes('bavaro') || combined.includes('cap cana') || combined.includes('el cortecito')) {
    city = 'Punta Cana';
    area = rawArea || 'Punta Cana';
    state = 'La Altagracia';
  } else if (combined.includes('santiago') || combined.includes('los álamos') || combined.includes('los alamos')) {
    city = 'Santiago';
    area = rawArea || 'Santiago';
    state = 'Santiago';
  } else if (combined.includes('sosúa') || combined.includes('sosua') || combined.includes('puerto plata') || combined.includes('cabarete')) {
    city = 'Puerto Plata';
    area = rawArea || 'Sosúa';
    state = 'Puerto Plata';
  } else if (combined.includes('la romana') || combined.includes('casa de campo') || combined.includes('bayahibe')) {
    city = 'La Romana';
    area = rawArea || 'La Romana';
    state = 'La Romana';
  } else if (combined.includes('juan dolio') || combined.includes('san pedro')) {
    city = 'Juan Dolio';
    area = rawArea || 'Metro Country Club';
    state = 'San Pedro de Macorís';
  } else if (combined.includes('las terrenas') || combined.includes('samaná') || combined.includes('samana')) {
    city = 'Las Terrenas';
    area = rawArea || 'Las Terrenas';
    state = 'Samaná';
  } else if (combined.includes('santo domingo este')) {
    city = 'Santo Domingo Este';
    area = rawArea || 'Santo Domingo Este';
    state = 'Santo Domingo';
  } else if (combined.includes('santo domingo oeste')) {
    city = 'Santo Domingo Oeste';
    area = rawArea || 'Santo Domingo Oeste';
    state = 'Santo Domingo';
  } else if (combined.includes('piantini')) {
    city = 'Santo Domingo';
    area = 'Piantini';
    state = 'Distrito Nacional';
  } else if (combined.includes('naco')) {
    city = 'Santo Domingo';
    area = 'Naco';
    state = 'Distrito Nacional';
  } else if (combined.includes('bella vista')) {
    city = 'Santo Domingo';
    area = 'Bella Vista';
    state = 'Distrito Nacional';
  } else if (combined.includes('evaristo morales')) {
    city = 'Santo Domingo';
    area = 'Evaristo Morales';
    state = 'Distrito Nacional';
  } else if (combined.includes('gazcue')) {
    city = 'Santo Domingo';
    area = 'Gazcue';
    state = 'Distrito Nacional';
  } else if (combined.includes('los cacicazgos')) {
    city = 'Santo Domingo';
    area = 'Los Cacicazgos';
    state = 'Distrito Nacional';
  } else if (combined.includes('serralles') || combined.includes('serrallés')) {
    city = 'Santo Domingo';
    area = 'Serrallés';
    state = 'Distrito Nacional';
  } else if (combined.includes('la julia')) {
    city = 'Santo Domingo';
    area = 'La Julia';
    state = 'Distrito Nacional';
  }

  return {
    address: addressInfo || area,
    area,
    city,
    state,
    country: 'Dominican Republic',
    coordinates: Array.isArray(coordinates) && coordinates.length === 2 ? coordinates : null,
  };
};

/**
 * Map REMAX property type to KleverProp Schema Enum
 * ['APARTMENT', 'HOUSE', 'LAND', 'OFFICE', 'COMMERCIAL']
 */
const mapPropertyType = (remaxTypeVal, title) => {
  const str = `${remaxTypeVal || ''} ${title || ''}`.toLowerCase();
  if (str.includes('apartamento') || str.includes('apartment') || str.includes('apto') || str.includes('condo') || str.includes('penthouse') || str.includes('piso') || str.includes('estudio')) {
    return 'APARTMENT';
  }
  if (str.includes('terreno') || str.includes('solar') || str.includes('finca') || str.includes('lote') || str.includes('parcela')) {
    return 'LAND';
  }
  if (str.includes('oficina') || str.includes('office')) {
    return 'OFFICE';
  }
  if (str.includes('comercial') || str.includes('local') || str.includes('nave') || str.includes('edificio') || str.includes('bodega') || str.includes('tienda')) {
    return 'COMMERCIAL';
  }
  return 'HOUSE';
};

/**
 * Map REMAX operation to KleverProp Schema Enum ('RENT' or 'BUY')
 * with 30K Price Rule enforcement
 */
const mapListingType = (operationVal, title, usdPrice) => {
  const str = `${operationVal || ''} ${title || ''}`.toLowerCase();
  let detected = 'BUY';
  if (str.includes('rent') || str.includes('alquiler') || str.includes('alq') || str.includes('rentar') || str.includes('temporal') || str.includes('lease')) {
    detected = 'RENT';
  }

  // 30K Rule alignment
  if (detected === 'RENT' && usdPrice >= 30000) {
    if (str.includes('sale') || str.includes('venta')) {
      detected = 'BUY';
    }
  } else if (detected === 'BUY' && usdPrice > 0 && usdPrice < 30000) {
    if (str.includes('alquiler') || str.includes('rent') || str.includes('alq')) {
      detected = 'RENT';
    }
  }

  return detected;
};

/**
 * Extract bedrooms count from title or item specs
 */
const parseBedrooms = (title, rooms, totalRooms) => {
  if (rooms && !isNaN(Number(rooms)) && Number(rooms) > 0) return Number(rooms);
  if (totalRooms && !isNaN(Number(totalRooms)) && Number(totalRooms) > 0) return Number(totalRooms);

  const t = String(title || '').toLowerCase();
  const match = t.match(/(\d+)\s*(?:habs?|habitaci[oó]n|dormitorios?|cuartos?|beds?|bhk)/i);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return null;
};

/**
 * Fast bilingual title translator
 */
const translateTitle = (spanishTitle) => {
  if (!spanishTitle) return { en: '', es: '' };
  const es = String(spanishTitle).trim();
  let en = es;

  en = en
    .replace(/Apartamento en alquiler/gi, 'Apartment for rent')
    .replace(/Apartamento en venta/gi, 'Apartment for sale')
    .replace(/Casa en alquiler/gi, 'House for rent')
    .replace(/Casa en venta/gi, 'House for sale')
    .replace(/Local en alquiler/gi, 'Commercial space for rent')
    .replace(/Local en venta/gi, 'Commercial space for sale')
    .replace(/Oficina en alquiler/gi, 'Office for rent')
    .replace(/Oficina en venta/gi, 'Office for sale')
    .replace(/Terreno en venta/gi, 'Land for sale')
    .replace(/Apto Alq/gi, 'Apartment for rent')
    .replace(/Apto Venta/gi, 'Apartment for sale')
    .replace(/\bhabs?\b/gi, 'beds')
    .replace(/\bhabitaciones\b/gi, 'bedrooms')
    .replace(/\bdormitorios\b/gi, 'bedrooms')
    .replace(/\bamueblado\b/gi, 'furnished')
    .replace(/\blinea blanca\b/gi, 'appliances included')
    .replace(/\blínea blanca\b/gi, 'appliances included')
    .replace(/\ben\b/gi, 'in');

  return { es, en };
};

/**
 * Clean international phone number and generate WhatsApp click-to-chat URL
 */
const buildWhatsAppUrl = (phone, agentName, propertyTitle, sourceUrl) => {
  if (!phone) return null;
  const digits = String(phone).replace(/[^0-9]/g, '');
  if (digits.length < 10) return null;

  const text = `Hola ${agentName || ''}, te contacto por la siguiente propiedad en KleverProp: ${propertyTitle || ''} ${sourceUrl || ''}`.trim();
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
};

/**
 * Non-blocking delay helper to yield the Node.js event loop
 * Ensures other user searches (AI or manual) never experience lag
 */
const yieldEventLoop = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Synchronize listings from REMAX RD API into KleverProp MongoDB Atlas
 * @param {Object} options - { pages: number, pageSize: number, fetchDetails: boolean, syncAll: boolean }
 */
const syncRemaxProperties = async (options = {}) => {
  const syncAll = options.syncAll === true;
  let targetPages = syncAll ? 9999 : Math.max(1, Number(options.pages) || 1);
  const pageSize = Math.min(50, Math.max(5, Number(options.pageSize) || 50));
  const fetchDetails = options.fetchDetails !== false;

  cancelRequested = false;

  // Initialize live progress state
  syncState.isSyncing = true;
  syncState.status = 'IN_PROGRESS';
  syncState.syncAll = syncAll;
  syncState.currentPage = 0;
  syncState.totalPages = syncAll ? 120 : targetPages;
  syncState.totalItemsEstimated = syncAll ? 5935 : (targetPages * pageSize);
  syncState.processed = 0;
  syncState.inserted = 0;
  syncState.updated = 0;
  syncState.errorsCount = 0;
  syncState.progressPercent = '0%';
  syncState.startedAt = new Date();
  syncState.completedAt = null;
  syncState.lastSyncedProperty = null;
  syncState.errors = [];

  console.log(`\n================================================================`);
  console.log(`[REMAX SYNC] Background Ingestion Started (SyncAll: ${syncAll}, Target Pages: ${targetPages})...`);
  console.log(`================================================================`);

  // Cache default Tier 1
  let defaultTier1 = await Tier.findOne({ tierLevel: 1 });
  if (!defaultTier1) {
    defaultTier1 = await Tier.create({
      name: 'Tier 1 Standard',
      tierLevel: 1,
      dailyQuota: 5,
      features: ['Basic search', 'Standard contact'],
    });
  }

  // Cache agency objects by office name
  const agencyCache = new Map();

  try {
    for (let page = 0; page < targetPages; page++) {
      if (cancelRequested) {
        console.log(`[REMAX SYNC] Cancellation requested by user/admin. Stopping at page ${page}.`);
        syncState.status = 'CANCELLED';
        break;
      }

      syncState.currentPage = page + 1;
      const listUrl = `${REMAX_API_BASE}/listings/findAll?page=${page}&pageSize=${pageSize}&sort=-createdAt`;

      const feedData = await fetchRemaxJson(listUrl);
      const listings = feedData?.data?.data || [];

      // Update dynamic total pages from REMAX API response
      if (feedData?.data?.totalItems && syncAll) {
        syncState.totalItemsEstimated = feedData.data.totalItems;
        syncState.totalPages = feedData.data.totalPages || Math.ceil(feedData.data.totalItems / pageSize);
        targetPages = syncState.totalPages;
      }

      if (!listings || listings.length === 0) {
        console.log(`[REMAX SYNC] No more listings on page ${page + 1}. Sync complete.`);
        break;
      }

      for (let i = 0; i < listings.length; i++) {
        if (cancelRequested) break;

        const item = listings[i];
        try {
          const slug = item.slug || item.id;
          const sourceUrl = `https://www.remaxrd.com/listings/${slug}`;

          // 1. Fetch detailed specs (bedrooms, description) if slug is available
          let detailData = null;
          if (fetchDetails && slug) {
            const detailUrl = `${REMAX_API_BASE}/listings/findBySlug/${encodeURIComponent(slug)}`;
            const detailRes = await fetchRemaxJson(detailUrl, 8000);
            detailData = detailRes?.data || null;
          }

          const titleEs = item.title || detailData?.title || 'Propiedad en República Dominicana';
          const titles = translateTitle(titleEs);

          const descEs = detailData?.description || item.description || titleEs;
          const descriptions = {
            es: descEs,
            en: descEs,
          };

          // 2. Price calculation & Smart DR Currency Correction
          let currencyVal = item.currency?.value || detailData?.currency?.value || 'USD';
          const rawPrice = Number(detailData?.price !== undefined ? detailData.price : item.price) || 0;
          let usdPrice = 0;
          let dopPrice = 0;

          // Check if agent accidentally selected USD when entering DOP for rentals
          const textCheck = `${titleEs} ${descEs}`.toLowerCase();
          const hasDopIndicator = textCheck.includes('rd$') || textCheck.includes('dop') || textCheck.includes('pesos') || textCheck.includes('rd $');

          if (currencyVal === 'DOP' || (currencyVal === 'USD' && rawPrice >= 10000 && hasDopIndicator)) {
            dopPrice = rawPrice;
            usdPrice = Math.round(rawPrice / 58);
          } else if (currencyVal === 'USD' && rawPrice >= 25000 && (titleEs.toLowerCase().includes('habitacion') || titleEs.toLowerCase().includes('estudiante') || titleEs.toLowerCase().includes('estud'))) {
            dopPrice = rawPrice;
            usdPrice = Math.round(rawPrice / 58);
          } else {
            usdPrice = rawPrice;
            dopPrice = Math.round(rawPrice * 58);
          }

          // 3. Location
          const coordinates = item.location?.coordinates || null;
          const locInfo = parseDRLocation(item.addressInfo, titleEs, coordinates);

          // 4. Specs
          const propType = mapPropertyType(item.type?.value, titleEs);
          const listType = mapListingType(item.operation?.value, titleEs, usdPrice);
          const bedrooms = parseBedrooms(titleEs, detailData?.bedrooms || detailData?.rooms, item.totalRooms);
          const bathrooms = (detailData?.bathrooms !== undefined && detailData?.bathrooms !== null)
            ? Number(detailData.bathrooms)
            : (item.bathrooms !== undefined ? Number(item.bathrooms) : null);

          const sizeM2 = Number(detailData?.dimensionTotalBuilt || detailData?.dimensionCovered || item.dimensionTotalBuilt || item.dimensionCovered || 0);

          // 5. Photos (CloudFront CDN)
          const rawPhotos = (detailData?.photos && detailData.photos.length > 0) ? detailData.photos : (item.photos || []);
          const images = rawPhotos
            .map(p => {
              const path = p.value || p.rawValue || '';
              if (!path) return null;
              return path.startsWith('http') ? path : `${CLOUDFRONT_BASE}/${path}`;
            })
            .filter(Boolean);

          // 6. Agency resolution
          const officeName = item.associate?.office?.name || 'RE/MAX República Dominicana';
          let agencyDoc = agencyCache.get(officeName.toLowerCase());
          if (!agencyDoc) {
            agencyDoc = await Agency.findOne({
              name: { $regex: new RegExp(`^${officeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
            });

            if (!agencyDoc) {
              agencyDoc = await Agency.create({
                name: officeName,
                logo: `${CLOUDFRONT_BASE}/assets/logo/remax-logo.svg`,
                tier: defaultTier1._id,
                isFoundingSponsor: true,
                isVerified: true,
                description: `${officeName} - Agente Inmobiliario Verificado en República Dominicana`,
                website: 'https://www.remaxrd.com',
              });
            }
            agencyCache.set(officeName.toLowerCase(), agencyDoc);
          }

          // 7. Agent resolution & WhatsApp URL
          const agentName = item.associate?.name || 'RE/MAX Agent';
          const agentEmail = item.associate?.emails?.[0]?.value || '';
          const agentPhone = item.associate?.phones?.[0]?.value || '';
          const agentPhotoRaw = item.associate?.photo || '';
          const agentPhoto = agentPhotoRaw
            ? (agentPhotoRaw.startsWith('http') ? agentPhotoRaw : `${CLOUDFRONT_BASE}/${agentPhotoRaw}`)
            : null;

          const whatsappUrl = buildWhatsAppUrl(agentPhone, agentName, titleEs, sourceUrl);

          let matchedAgentId = null;
          if (agentEmail) {
            const registeredAgent = await User.findOne({ email: agentEmail.toLowerCase() });
            if (registeredAgent) matchedAgentId = registeredAgent._id;
          }

          // 8. Build full property payload
          const propertyPayload = {
            title: titles,
            description: descriptions,
            location: {
              address: locInfo.address,
              area: locInfo.area,
              city: locInfo.city,
              state: locInfo.state,
              country: locInfo.country,
            },
            propertyType: propType,
            listingType: listType,
            price: {
              usd: usdPrice,
              dop: dopPrice,
            },
            bedrooms: isNaN(bedrooms) ? null : bedrooms,
            bathrooms: isNaN(bathrooms) ? null : bathrooms,
            size: sizeM2,
            sizeUnit: 'sq meters',
            maintenanceFee: {
              amount: Number(item.expensesPrice) || 0,
              currency: item.expensesCurrency?.value || 'DOP',
            },
            images,
            source: 'REMAX',
            sourceUrl,
            agency: agencyDoc ? agencyDoc._id : null,
            agent: matchedAgentId,
            agentDetails: {
              name: agentName,
              phone: agentPhone,
              email: agentEmail,
              profileImage: agentPhoto,
              office: officeName,
              whatsapp: whatsappUrl,
            },
            status: 'Active',
          };

          // 9. Upsert by sourceUrl
          const existing = await Property.findOne({ sourceUrl });
          if (existing) {
            await Property.findByIdAndUpdate(
              existing._id,
              { $set: propertyPayload },
              { returnDocument: 'after', runValidators: false }
            );
            syncState.updated++;
          } else {
            await Property.create(propertyPayload);
            syncState.inserted++;
          }

          syncState.processed++;
          syncState.lastSyncedProperty = titleEs;

          // Update percentage
          const targetTotal = syncState.totalItemsEstimated || 1;
          const pct = Math.min(100, Math.round((syncState.processed / targetTotal) * 1000) / 10);
          syncState.progressPercent = `${pct}%`;

          // Non-blocking micro pause: Yield event loop so AI Searches execute at full speed
          if (i % 3 === 0) {
            await yieldEventLoop(50);
          }

        } catch (itemErr) {
          console.error(`[REMAX SYNC ERROR] Item on page ${page + 1}: ${itemErr.message}`);
          syncState.errorsCount++;
          if (syncState.errors.length < 20) {
            syncState.errors.push({
              page: page + 1,
              id: item?.id,
              error: itemErr.message,
            });
          }
        }
      }

      // Inter-page pause (100ms) to prevent IP throttling and keep database fast
      await yieldEventLoop(100);
    }

    if (syncState.status === 'IN_PROGRESS') {
      syncState.status = 'COMPLETED';
    }

  } catch (err) {
    console.error(`[REMAX SYNC FATAL]: ${err.message}`);
    syncState.status = 'FAILED';
    syncState.errors.push({ fatal: err.message });
  } finally {
    syncState.isSyncing = false;
    syncState.completedAt = new Date();
    if (syncState.startedAt) {
      syncState.elapsedSeconds = Math.round((syncState.completedAt - syncState.startedAt) / 1000);
    }
    console.log(`[REMAX SYNC ENDED] Status: ${syncState.status} | Processed: ${syncState.processed} | Inserted: ${syncState.inserted} | Updated: ${syncState.updated} | Elapsed: ${syncState.elapsedSeconds}s\n`);
  }

  return getSyncStatus();
};

/**
 * Trigger background synchronization asynchronously
 */
const startAsyncSyncRemax = (options = {}) => {
  if (syncState.isSyncing) {
    return {
      alreadyRunning: true,
      message: `A sync job is already in progress (${syncState.progressPercent} completed).`,
      status: getSyncStatus(),
    };
  }

  const jobId = `remax_sync_${Date.now()}`;
  syncState.jobId = jobId;

  // Launch in background asynchronously (fire-and-forget, non-blocking)
  setImmediate(() => {
    syncRemaxProperties(options).catch(err => {
      console.error(`[Background Sync Uncaught Error]:`, err);
    });
  });

  return {
    alreadyRunning: false,
    jobId,
    status: 'IN_PROGRESS',
    message: 'REMAX synchronization started in background.',
    startedAt: new Date(),
    options,
  };
};

/**
 * Get the current live sync progress
 */
const getSyncStatus = () => {
  const currentElapsed = syncState.startedAt
    ? Math.round(((syncState.completedAt ? syncState.completedAt : new Date()) - syncState.startedAt) / 1000)
    : 0;

  return {
    isSyncing: syncState.isSyncing,
    status: syncState.status,
    jobId: syncState.jobId,
    syncAll: syncState.syncAll,
    currentPage: syncState.currentPage,
    totalPages: syncState.totalPages,
    processed: syncState.processed,
    totalEstimated: syncState.totalItemsEstimated,
    progressPercent: syncState.progressPercent,
    inserted: syncState.inserted,
    updated: syncState.updated,
    errorsCount: syncState.errorsCount,
    startedAt: syncState.startedAt,
    completedAt: syncState.completedAt,
    elapsedSeconds: currentElapsed,
    lastSyncedProperty: syncState.lastSyncedProperty,
    recentErrors: syncState.errors.slice(-5),
  };
};

/**
 * Cancel an ongoing sync job
 */
const cancelSync = () => {
  if (!syncState.isSyncing) {
    return { cancelled: false, message: 'No active synchronization to cancel.' };
  }
  cancelRequested = true;
  return { cancelled: true, message: 'Sync cancellation requested. It will halt shortly.' };
};

module.exports = {
  syncRemaxProperties,
  startAsyncSyncRemax,
  getSyncStatus,
  cancelSync,
  fetchRemaxJson,
  parseDRLocation,
  mapPropertyType,
  mapListingType,
};
