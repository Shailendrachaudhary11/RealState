const { generateStructuredJson } = require('../services/aiService');
const mongoose = require('mongoose');
const Property = require('../models/Property');
const { resolveLanguage, getLocalizedMessage } = require('../utils/languageHelper');

// Normalize requested content type
const normalizeContentType = (type) => {
  if (!type) return 'all';
  const str = String(type).trim().toLowerCase();
  if (str.includes('insta') || str.includes('post') || str.includes('reel')) {
    return 'instagram';
  }
  if (str.includes('what') || str.includes('wa') || str.includes('message')) {
    return 'whatsapp';
  }
  if (str.includes('email') || str.includes('mail')) {
    return 'email';
  }
  return 'all';
};

// Fallback Dominican Republic Real Estate Marketing Copy Generator
const generateFallbackMarketingContent = ({ property, language = 'es', tone = 'professional' }) => {
  const isEs = language !== 'en';
  const title = (isEs ? property.title?.es : property.title?.en) || property.title?.es || property.title?.en || 'Propiedad Exclusiva';
  const priceFormatted = `US$ ${Number(property.price || 0).toLocaleString()}`;
  const area = property.location?.area || '';
  const city = property.location?.city || 'Santo Domingo';
  const locationStr = [property.location?.address, area, city].filter(Boolean).join(', ');
  const beds = property.bedrooms ? `${property.bedrooms} ${isEs ? 'Habitaciones' : 'Beds'}` : null;
  const baths = property.bathrooms ? `${property.bathrooms} ${isEs ? 'Baños' : 'Baths'}` : null;
  const size = property.size ? `${property.size} ${property.sizeUnit || 'm²'}` : null;
  const propertyType = property.propertyType || 'Apartamento';
  const listingType = property.listingType === 'RENT' ? (isEs ? 'Alquiler' : 'Rent') : (isEs ? 'Venta' : 'Sale');
  const agentName = property.agentDetails?.name || 'Asesor Inmobiliario';
  const agentPhone = property.agentDetails?.phone || '+1 (809) 000-0000';

  const amenitiesList = Array.isArray(property.amenities)
    ? property.amenities.map((a) => (isEs ? a.name?.es : a.name?.en) || a.name?.es || a.name?.en || a.name).filter(Boolean)
    : [];

  const topAmenitiesStr = amenitiesList.slice(0, 5).join(' • ');

  // Clean hashtag friendly strings
  const cleanTag = (str) => (str ? str.replace(/[^a-zA-Z0-9]/g, '') : '');
  const areaTag = cleanTag(area);
  const cityTag = cleanTag(city);

  // 1. Instagram Post / Reel Caption
  const instaHashtags = [
    '#BienesRaicesRD',
    '#RealEstateRD',
    '#RepublicaDominicana',
    cityTag ? `#${cityTag}` : '#SantoDomingo',
    areaTag ? `#${areaTag}` : '#Piantini',
    property.listingType === 'RENT' ? '#ApartamentoEnAlquiler' : '#ApartamentoEnVenta',
    '#InversionRD',
    '#PropiedadesRD',
    '#KleverProp',
  ].filter(Boolean);

  const instagramCaption = isEs
    ? `✨ ¡EXCLUSIVIDAD Y CONFORT EN ${area ? area.toUpperCase() : city.toUpperCase()}! ✨\n\n` +
    `Te presentamos este espectacular ${propertyType.toLowerCase()} en ${listingType.toLowerCase()}, diseñado para quienes buscan lujo, ubicación y alta plusvalía en el corazón de la ciudad.\n\n` +
    `📌 CARACTERÍSTICAS PRINCIPALES:\n` +
    `• 💵 Precio: ${priceFormatted}\n` +
    (beds ? `• 🛏️ ${beds}\n` : '') +
    (baths ? `• 🛁 ${baths}\n` : '') +
    (size ? `• 📐 ${size}\n` : '') +
    `• 📍 Ubicación: ${locationStr}\n` +
    (topAmenitiesStr ? `• 🌟 Amenidades: ${topAmenitiesStr}\n\n` : '\n') +
    `📲 ¿Listo para conocer tu próximo hogar o inversión?\n` +
    `Escríbenos por DM o contáctanos vía WhatsApp para agendar una visita privada.\n\n` +
    `📞 ${agentName}: ${agentPhone}\n\n`
    : `✨ EXCLUSIVE LUXURY LIVING IN ${area ? area.toUpperCase() : city.toUpperCase()}! ✨\n\n` +
    `Discover this stunning ${propertyType.toLowerCase()} available for ${listingType.toLowerCase()}, perfectly positioned for prime appreciation and comfortable living in the Dominican Republic.\n\n` +
    `📌 KEY HIGHLIGHTS:\n` +
    `• 💵 Price: ${priceFormatted}\n` +
    (beds ? `• 🛏️ ${beds}\n` : '') +
    (baths ? `• 🛁 ${baths}\n` : '') +
    (size ? `• 📐 ${size}\n` : '') +
    `• 📍 Location: ${locationStr}\n` +
    (topAmenitiesStr ? `• 🌟 Highlights: ${topAmenitiesStr}\n\n` : '\n') +
    `📲 Ready to schedule a private walkthrough or request the full brochure?\n` +
    `Send us a DM or message us directly on WhatsApp today!\n\n` +
    `📞 ${agentName}: ${agentPhone}\n\n`;

  const instagramFormatted = instagramCaption + instaHashtags.join(' ');

  // 2. WhatsApp Direct Pitch
  const whatsappMessage = isEs
    ? `👋 ¡Hola! Espero que estés muy bien.\n\n` +
    `Te comparto esta excelente oportunidad inmobiliaria en *${area || city}* que acaba de entrar:\n\n` +
    `🏢 *${title}*\n` +
    `💰 *Precio:* ${priceFormatted}\n` +
    `📍 *Ubicación:* ${locationStr}\n` +
    (beds || baths ? `📐 *Distribución:* ${[beds, baths, size].filter(Boolean).join(' | ')}\n` : '') +
    (topAmenitiesStr ? `✨ *Amenidades destacadas:* ${topAmenitiesStr}\n\n` : '\n') +
    `Ideal tanto para vivir como para inversión con excelente retorno de alquiler.\n\n` +
    `¿Te gustaría que te envíe el brochure con las fotos completas o coordinamos una visita esta semana?\n\n` +
    `Saludos,\n*${agentName}* | ${agentPhone}`
    : `👋 Hello! Hope you are doing well.\n\n` +
    `I wanted to share this prime property opportunity in *${area || city}* that just became available:\n\n` +
    `🏢 *${title}*\n` +
    `💰 *Price:* ${priceFormatted}\n` +
    `📍 *Location:* ${locationStr}\n` +
    (beds || baths ? `📐 *Specs:* ${[beds, baths, size].filter(Boolean).join(' | ')}\n` : '') +
    (topAmenitiesStr ? `✨ *Features:* ${topAmenitiesStr}\n\n` : '\n') +
    `Outstanding option for personal living or a high-yield rental investment.\n\n` +
    `Would you like me to send you the full brochure or schedule a private showing?\n\n` +
    `Best regards,\n*${agentName}* | ${agentPhone}`;

  // 3. Formal Email Description
  const emailSubject = isEs
    ? `Oportunidad Inmobiliaria: ${title} en ${area || city} - ${priceFormatted}`
    : `Prime Real Estate Opportunity: ${title} in ${area || city} - ${priceFormatted}`;

  const emailBody = isEs
    ? `Estimado/a cliente,\n\n` +
    `Es un placer saludarle. Por medio del presente correo, deseo presentarle una distinguida propiedad ubicada en ${locationStr}, ideal para clientes con altos estándares de calidad y visión de inversión.\n\n` +
    `RESUMEN DE LA PROPIEDAD:\n` +
    `----------------------------------------\n` +
    `• Título: ${title}\n` +
    `• Tipo de Operación: ${listingType}\n` +
    `• Tipo de Inmueble: ${propertyType}\n` +
    `• Precio de Lista: ${priceFormatted}\n` +
    (beds ? `• Habitaciones: ${beds}\n` : '') +
    (baths ? `• Baños: ${baths}\n` : '') +
    (size ? `• Metraje: ${size}\n` : '') +
    `• Ubicación: ${locationStr}\n` +
    (topAmenitiesStr ? `• Amenidades y Áreas Sociales: ${topAmenitiesStr}\n` : '') +
    `----------------------------------------\n\n` +
    `UBICACIÓN Y PLUSVALÍA:\n` +
    `Situado en una de las zonas de mayor demanda y seguridad en ${city}, este inmueble cuenta con rápido acceso a centros financieros, centros comerciales y prestigiosos restaurantes.\n\n` +
    `Quedo a su completa disposición para coordinar una presentación virtual o un recorrido presencial en el horario de su preferencia.\n\n` +
    `Atentamente,\n\n` +
    `${agentName}\n` +
    `Asesor Inmobiliario\n` +
    `Teléfono / WhatsApp: ${agentPhone}\n` +
    (property.agentDetails?.email ? `Email: ${property.agentDetails.email}\n` : '')
    : `Dear Client,\n\n` +
    `It is our pleasure to introduce you to an exceptional property situated in ${locationStr}, ideal for clients seeking premier living or high-return investment in the Dominican Republic.\n\n` +
    `EXECUTIVE PROPERTY SUMMARY:\n` +
    `----------------------------------------\n` +
    `• Title: ${title}\n` +
    `• Operation: ${listingType}\n` +
    `• Property Type: ${propertyType}\n` +
    `• List Price: ${priceFormatted}\n` +
    (beds ? `• Bedrooms: ${beds}\n` : '') +
    (baths ? `• Bathrooms: ${baths}\n` : '') +
    (size ? `• Area: ${size}\n` : '') +
    `• Location: ${locationStr}\n` +
    (topAmenitiesStr ? `• Amenities: ${topAmenitiesStr}\n` : '') +
    `----------------------------------------\n\n` +
    `PRIME LOCATION & APPRECIATION:\n` +
    `Positioned in one of the most desirable areas in ${city}, with seamless access to key commercial hubs and scenic coastal attractions.\n\n` +
    `Please let us know if you would like to schedule a private showing or request full property documentation.\n\n` +
    `Sincerely,\n\n` +
    `${agentName}\n` +
    `Real Estate Advisor\n` +
    `Phone / WhatsApp: ${agentPhone}\n` +
    (property.agentDetails?.email ? `Email: ${property.agentDetails.email}\n` : '');

  return {
    instagram: {
      caption: instagramCaption.trim(),
      hashtags: instaHashtags,
      formattedPost: instagramFormatted.trim(),
    },
    whatsapp: {
      message: whatsappMessage.trim(),
    },
    email: {
      subject: emailSubject.trim(),
      body: emailBody.trim(),
    },
  };
};

const generateMarketingContent = async (req, res, next) => {
  try {
    const propertyId = req.params.id || req.body.propertyId || req.body.property_id || req.body.id;
    const rawContentType = req.body.contentType || req.body.content_type || req.query.contentType || 'all';
    const userLang = resolveLanguage(req);
    const language = req.body.language || req.query.language || userLang;
    const tone = req.body.tone || 'professional';

    if (!propertyId) {
      const error = new Error(getLocalizedMessage('propertyIdRequired', userLang));
      error.statusCode = 400;
      return next(error);
    }

    if (!mongoose.Types.ObjectId.isValid(propertyId)) {
      const error = new Error(getLocalizedMessage('invalidPropertyId', userLang));
      error.statusCode = 400;
      return next(error);
    }

    // Fetch property with populated amenities
    const property = await Property.findById(propertyId).populate('amenities');
    if (!property) {
      const error = new Error(getLocalizedMessage('propertyNotFound', userLang));
      error.statusCode = 404;
      return next(error);
    }

    const contentType = normalizeContentType(rawContentType);

    // Fallback baseline content
    let marketingContent = generateFallbackMarketingContent({ property, language, tone });

    const isEs = language !== 'en';
    const propTitle = (isEs ? property.title?.es : property.title?.en) || property.title?.es || property.title?.en;
    const propDesc = (isEs ? property.description?.es : property.description?.en) || property.description?.es || '';
    const amenitiesText = Array.isArray(property.amenities)
      ? property.amenities.map((a) => (isEs ? a.name?.es : a.name?.en) || a.name?.es || a.name?.en || a.name).join(', ')
      : '';

    const prompt = `
You are an expert real estate copywriter specializing in the Dominican Republic (Santo Domingo, Piantini, Naco, Punta Cana, Santiago).
Create 3 high-converting marketing content pieces for the following property in ${isEs ? 'Spanish (Dominican Real Estate context)' : 'English'}:

Property Details:
- Title: ${propTitle}
- Description: ${propDesc}
- Price: US$ ${Number(property.price || 0).toLocaleString()}
- Type: ${property.propertyType} (${property.listingType})
- Location: ${property.location?.address || ''}, ${property.location?.area || ''}, ${property.location?.city || 'Santo Domingo'}
- Specs: ${property.bedrooms || 0} bedrooms, ${property.bathrooms || 0} bathrooms, ${property.size || 0} ${property.sizeUnit || 'm²'}
- Furnished: ${property.furnishedStatus}
- Key Amenities: ${amenitiesText || 'Planta Full, Piscina, Lobby, Seguridad'}
- Agent Name: ${property.agentDetails?.name || 'Agent'}
- Agent Phone: ${property.agentDetails?.phone || '+1 809 000 0000'}

Requested Tone: ${tone}

Return a valid JSON object ONLY with the following structure:
{
  "instagram": {
    "caption": "Catchy emoji-rich Instagram post/reel caption with hook, bullet points, CTA",
    "hashtags": ["#BienesRaicesRD", "#Piantini", "#ApartamentoEnVenta", "..."],
    "formattedPost": "Full post text with caption followed by hashtags"
  },
  "whatsapp": {
    "message": "Short, scannable WhatsApp pitch with bold *Price*, specs, bullet points, emojis and friendly CTA"
  },
  "email": {
    "subject": "High open-rate formal subject line",
    "body": "Formal executive presentation email with technical specs, investment overview, and professional signoff"
  }
}
`;

    // Attempt generation with Unified AI Service (Gemini Candidates + OpenAI Fallback)
    const aiRes = await generateStructuredJson({
      prompt,
      systemInstruction: 'You are an expert real estate copywriter specializing in the Dominican Republic. Return valid JSON only.',
      maxTokens: 850,
      temperature: 0.3
    });

    if (aiRes.data && aiRes.data.instagram && aiRes.data.whatsapp && aiRes.data.email) {
      marketingContent = aiRes.data;
    }

    // Prepare response depending on requested contentType
    let resultPayload = marketingContent;
    let selectedContent = null;

    if (contentType === 'instagram') {
      resultPayload = { instagram: marketingContent.instagram };
      selectedContent = marketingContent.instagram.formattedPost || marketingContent.instagram.caption;
    } else if (contentType === 'whatsapp') {
      resultPayload = { whatsapp: marketingContent.whatsapp };
      selectedContent = marketingContent.whatsapp.message;
    } else if (contentType === 'email') {
      resultPayload = { email: marketingContent.email };
      selectedContent = `${marketingContent.email.subject}\n\n${marketingContent.email.body}`;
    }

    res.status(200).json({
      success: true,
      message: language === 'es'
        ? `Contenido de marketing generado con éxito para ${contentType.toUpperCase()}`
        : `Marketing content generated successfully for ${contentType.toUpperCase()}`,
      data: {
        propertyId: property._id,
        propertyTitle: (language === 'en' ? property.title?.en : property.title?.es) || property.title?.es || property.title?.en,
        contentType,
        language,
        tone,
        selectedContent,
        content: resultPayload,
      },
    });
  } catch (err) {
    console.error(`Generate marketing content error: ${err.message}`);
    next(err);
  }
};

module.exports = {
  generateMarketingContent,
};