const User = require('../models/User');
const Lead = require('../models/Lead');
const Property = require('../models/Property');
const Notification = require('../models/Notification');
const ChatSession = require('../models/ChatSession');
const sendEmail = require('../utils/sendEmail');
const mongoose = require('mongoose');
const { resolveLanguage, getLocalizedMessage } = require('../utils/languageHelper');
const { generateStructuredJson } = require('../services/aiService');
const Tier = require('../models/Tier');

// Helper to determine agent tier level (defaults to 1 if no tier or basic tier)
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

const parseDescriptionFallback = (text) => {
  if (!text || typeof text !== 'string') return {};
  const lower = text.toLowerCase();
  const normalizedText = lower.replace(/,/g, '');

  const filters = {
    maxPrice: null,
    minPrice: null,
    paymentMethod: null,
    timeline: null,
    location: null,
    propertyType: null,
    bedrooms: null,
  };

  // 1. Budget extraction
  const priceCrMatch = normalizedText.match(/(\d+(?:\.\d+)?)\s*(cr|crore)/i);
  const priceMillionMatch = normalizedText.match(/(\d+(?:\.\d+)?)\s*(mill[oó]n(?:es)?|m)\b/i);
  const priceLakhMatch = normalizedText.match(/(\d+(?:\.\d+)?)\s*(lakh|lac|l)\b/i);
  const priceKMatch = normalizedText.match(/(\d+)\s*(k|hazar|thousand)/i);
  const priceMilMatch = normalizedText.match(/(\d+)\s*(mil)\b/i);
  const budgetPrefixMatch = normalizedText.match(/(?:budget|presupuesto|under|upto|menos de|hasta|max|máximo|precio)\s*[:=]?\s*(?:\$|rd\$|usd)?\s*(\d{3,9})/i);
  const rawDollarMatch = normalizedText.match(/\$\s*(\d{3,9})/);
  const rawNumberMatch = normalizedText.match(/\b(\d{4,9})\b/);

  if (priceCrMatch) {
    filters.maxPrice = parseFloat(priceCrMatch[1]) * 10000000;
  } else if (priceMillionMatch) {
    filters.maxPrice = parseFloat(priceMillionMatch[1]) * 1000000;
  } else if (priceLakhMatch) {
    filters.maxPrice = parseFloat(priceLakhMatch[1]) * 100000;
  } else if (priceKMatch) {
    filters.maxPrice = parseInt(priceKMatch[1], 10) * 1000;
  } else if (priceMilMatch) {
    filters.maxPrice = parseInt(priceMilMatch[1], 10) * 1000;
  } else if (budgetPrefixMatch) {
    filters.maxPrice = parseInt(budgetPrefixMatch[1], 10);
  } else if (rawDollarMatch) {
    filters.maxPrice = parseInt(rawDollarMatch[1], 10);
  } else if (rawNumberMatch) {
    filters.maxPrice = parseInt(rawNumberMatch[1], 10);
  }

  // 2. Payment Method
  if (lower.match(/\b(cash|contado|efectivo|de contado)\b/i)) {
    filters.paymentMethod = 'CASH';
  } else if (lower.match(/\b(mortgage|loan|financiamiento|banco|prestamo|préstamo|hipoteca|cr[eé]dito)\b/i)) {
    filters.paymentMethod = 'MORTGAGE';
  } else if (lower.match(/\b(cuotas|plan de pago|inicial|installment|down payment)\b/i)) {
    filters.paymentMethod = 'PAYMENT_PLAN';
  }

  // 3. Purchase Timeline
  if (lower.match(/\b(now|ya|de una vez|inmediato|urgente|ready|este mes|urgent|immediately|asap)\b/i)) {
    filters.timeline = 'IMMEDIATE';
  } else if (lower.match(/\b(1\s*mes|2\s*meses|3\s*meses|1-3\s*months?|en unos meses|next month)\b/i)) {
    filters.timeline = '1_TO_3_MONTHS';
  } else if (lower.match(/\b(3-6\s*meses|3-6\s*months?|este a[nñ]o|this year)\b/i)) {
    filters.timeline = '3_TO_6_MONTHS';
  } else if (lower.match(/\b(solo viendo|explorando|just looking|curioseando|exploring)\b/i)) {
    filters.timeline = 'EXPLORING';
  }

  // 4. Property Type
  if (lower.match(/\b(flat|apartment|apartamento|piso|departamento|depa|condo|penthouse|estudio)\b/i)) {
    filters.propertyType = 'APARTMENT';
  } else if (lower.match(/\b(house|home|makan|makaan|villa|kothi|ghar|casa|vivienda|chalet|townhouse)\b/i)) {
    filters.propertyType = 'HOUSE';
  } else if (lower.match(/\b(plot|land|zameen|solar|terreno|parcela|lote)\b/i)) {
    filters.propertyType = 'LAND';
  } else if (lower.match(/\b(office|oficina)\b/i)) {
    filters.propertyType = 'OFFICE';
  } else if (lower.match(/\b(commercial|shop|dukaan|local|tienda|nave)\b/i)) {
    filters.propertyType = 'COMMERCIAL';
  } else if (lower.match(/\b(property|propiedad)\b/i)) {
    filters.propertyType = 'PROPERTY';
  }

  // 5. Bedrooms
  const bhkMatch = lower.match(/(\d+)\s*[-]?\s*(bhk|bedrooms?|beds?|kamre?|rooms?|habitaci[oó]n(?:es)?|dormitorios?|cuartos?|hab)\b/i);
  if (bhkMatch) {
    filters.bedrooms = parseInt(bhkMatch[1], 10);
  }

  // 6. Location
  if (lower.includes('santo domingo') || lower.match(/\b(santo)\b/i)) {
    filters.location = 'Santo Domingo';
  } else if (lower.includes('punta cana') || lower.match(/\b(punta)\b/i)) {
    filters.location = 'Punta Cana';
  } else {
    const knownLocations = [
      'mirador del oeste', 'punta cana', 'santo domingo', 'gazcue',
      'santiago', 'la romana', 'puerto plata', 'las terrenas', 'samana', 'samaná',
      'cap cana', 'boca chica', 'jarabacoa', 'arroyo hondo', 'costa caribe',
      'brisas de punta cana', 'white sands', 'piantini', 'naco', 'bella vista',
      'los cacicazgos', 'mirador sur', 'mirador norte', 'evaristo morales'
    ];
    for (const loc of knownLocations) {
      if (lower.includes(loc)) {
        filters.location = loc.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        break;
      }
    }
  }

  // Hindi pattern: "... me" / "... mein" (e.g. "santo me", "delhi me")
  if (!filters.location) {
    const meMatch = lower.match(/([a-z0-9\s,]+?)\s+\b(?:me|mein)\b/i);
    if (meMatch && meMatch[1]) {
      const stopWords = ['muje', 'mujhe', 'humko', 'hume', 'payment', 'loan', 'property', 'chahiye', 'chaiye'];
      const words = meMatch[1].trim().split(/\s+/).filter(w => !stopWords.includes(w));
      if (words.length > 0) {
        const rawLoc = words.join(' ');
        if (rawLoc.toLowerCase() === 'santo') filters.location = 'Santo Domingo';
        else if (rawLoc.toLowerCase() === 'punta') filters.location = 'Punta Cana';
        else filters.location = rawLoc.charAt(0).toUpperCase() + rawLoc.slice(1);
      }
    }
  }

  if (!filters.location) {
    const inMatch = lower.match(/\b(?:in|en|at|near|cerca de)\s+([a-zA-Z\s]{3,30})(?:[,\.]|$|\s+(?:under|with|for|budget))/i);
    if (inMatch && inMatch[1]) {
      const candidate = inMatch[1].trim();
      const stopWords = ['a', 'the', 'my', 'cash', 'loan', 'urgent', 'buy', 'rent', 'house', 'apartment', 'un', 'una', 'el', 'la', 'payment'];
      if (!stopWords.includes(candidate.toLowerCase())) {
        if (candidate.toLowerCase() === 'santo') filters.location = 'Santo Domingo';
        else if (candidate.toLowerCase() === 'punta') filters.location = 'Punta Cana';
        else filters.location = candidate.charAt(0).toUpperCase() + candidate.slice(1);
      }
    }
  }

  return filters;
};

const extractFiltersFromText = async (text) => {
  if (!text || typeof text !== 'string') return {};

  const prompt = `Analyze user inquiry description:
"${text}"

Extract the following JSON fields:
- maxPrice: integer or null
- minPrice: integer or null
- paymentMethod: string enum ('CASH', 'MORTGAGE', 'PAYMENT_PLAN', 'UNDECIDED') or null
- timeline: string enum ('IMMEDIATE', '1_TO_3_MONTHS', '3_TO_6_MONTHS', 'EXPLORING', 'UNDECIDED') or null
- location: string (normalized e.g. Santo Domingo, Punta Cana) or null
- propertyType: string ('APARTMENT', 'HOUSE', 'LAND', 'COMMERCIAL', 'PROPERTY') or null
- bedrooms: integer or null

Return ONLY a valid JSON object matching these fields.`;

  try {
    const aiRes = await generateStructuredJson({
      prompt,
      systemInstruction: 'You are an expert real estate AI lead analyst. Analyze user description in English, Spanish, Hindi, or Hinglish. Normalize location (e.g. santo -> Santo Domingo, punta -> Punta Cana). Map paymentMethod (loan/prestamo/hipoteca/karz -> MORTGAGE, cash/efectivo -> CASH, cuotas/installments -> PAYMENT_PLAN). Extract propertyType, bedrooms, budget, and timeline.',
      maxTokens: 300,
      temperature: 0.1,
      timeoutMs: 8000
    });

    if (aiRes.data && typeof aiRes.data === 'object') {
      return aiRes.data;
    }
  } catch (err) {
    console.warn(`Lead AI extraction fallback: ${err.message}`);
  }

  return parseDescriptionFallback(text);
};

const sendLead = async (req, res, next) => {
  try {
    const propertyId = req.body.property || req.body.propertyId;
    const rawAgentId = req.body.agentId || req.body.agentID || req.body.agent || null;
    const rawAgentEmail = (req.body.agentEmail || req.body.email) ? String(req.body.agentEmail || req.body.email).trim().toLowerCase() : null;
    const description = (req.body.description || '').trim();
    const chatId = req.body.chatId ? String(req.body.chatId).trim() : null;
    const userId = req.user._id;

    const lang = resolveLanguage(req);

    // Rule: Either chatId OR description is required
    const hasChatId = Boolean(chatId && chatId !== '');
    const hasDescription = Boolean(description && description !== '');

    if (!hasChatId && !hasDescription) {
      const error = new Error(
        lang === 'es'
          ? 'Se requiere chatId o descripción para enviar una consulta'
          : 'Either chatId or description is required to submit an inquiry'
      );
      error.statusCode = 400;
      return next(error);
    }

    if (!propertyId || !mongoose.Types.ObjectId.isValid(propertyId)) {
      const error = new Error(lang === 'es' ? 'Se requiere un ID de propiedad válido' : 'Valid property ID is required');
      error.statusCode = 400;
      return next(error);
    }

    // Fetch Property details
    const propDoc = await Property.findById(propertyId);
    if (!propDoc) {
      const error = new Error(lang === 'es' ? 'Propiedad no encontrada' : 'Property not found');
      error.statusCode = 404;
      return next(error);
    }

    // Resolve target agent email fallback from body or property details
    let targetAgentEmail = rawAgentEmail;
    if (!targetAgentEmail && propDoc?.agentDetails?.email) {
      targetAgentEmail = String(propDoc.agentDetails.email).trim().toLowerCase();
    }
    if (!targetAgentEmail && propDoc?.contactEmail) {
      targetAgentEmail = String(propDoc.contactEmail).trim().toLowerCase();
    }

    // Temporary override: All leads and notifications routed to agent 
    const OVERRIDE_AGENT_ID = '6ad8a94cb28aaec8c976d21c';
    let agentUser = await User.findById(OVERRIDE_AGENT_ID).populate('tier');

    if (!agentUser) {
      // Fallback to normal agent resolution if override agent not found
      if (rawAgentId && mongoose.Types.ObjectId.isValid(rawAgentId)) {
        agentUser = await User.findById(rawAgentId).populate('tier');
      }

      if (!agentUser && propDoc?.agent) {
        const propAgentId = propDoc.agent._id || propDoc.agent;
        if (mongoose.Types.ObjectId.isValid(propAgentId)) {
          agentUser = await User.findById(propAgentId).populate('tier');
        }
      }

      if (!agentUser && targetAgentEmail) {
        agentUser = await User.findOne({ email: targetAgentEmail, role: 'agent' }).populate('tier');
        if (!agentUser) {
          agentUser = await User.findOne({ email: targetAgentEmail }).populate('tier');
        }
      }
    }
    // All leads are allowed to be sent to the target agent without blocking Tier 1

    // --- AI-Qualified Lead Sheet Packaging ---
    let session = null;
    let filters = null;

    if (hasChatId && mongoose.Types.ObjectId.isValid(chatId)) {
      session = await ChatSession.findOne({ _id: chatId, user: userId });
      if (!session) session = await ChatSession.findById(chatId);
      if (session && session.currentFilters) {
        filters = session.currentFilters;
      }
    }

    if (!filters && hasDescription) {
      filters = await extractFiltersFromText(description);
    }

    const aiLeadSheet = {
      verifiedBudget: {
        amount: null,
        currency: 'USD',
        formatted: 'Budget not specified',
      },
      paymentMethod: 'UNDECIDED',
      timeline: 'UNDECIDED',
      areasOfInterest: [],
      preferredPropertyType: null,
      preferredBedrooms: null,
      leadQuality: 'WARM',
      chatSessionRef: session ? session._id : null,
      extractedAt: new Date(),
    };

    if (filters) {
      const budgetVal = filters.maxPrice || filters.minPrice;
      if (budgetVal && !isNaN(Number(budgetVal))) {
        const num = Number(budgetVal);
        aiLeadSheet.verifiedBudget.amount = num;
        aiLeadSheet.verifiedBudget.currency = 'USD';
        aiLeadSheet.verifiedBudget.formatted = `$${num.toLocaleString()} USD`;
      }

      if (filters.paymentMethod && ['CASH', 'MORTGAGE', 'PAYMENT_PLAN'].includes(filters.paymentMethod)) {
        aiLeadSheet.paymentMethod = filters.paymentMethod;
      }

      if (filters.timeline && ['IMMEDIATE', '1_TO_3_MONTHS', '3_TO_6_MONTHS', 'EXPLORING'].includes(filters.timeline)) {
        aiLeadSheet.timeline = filters.timeline;
      }

      if (filters.location && typeof filters.location === 'string' && filters.location.trim() !== '') {
        aiLeadSheet.areasOfInterest = [filters.location.trim()];
      }

      if (filters.propertyType) {
        aiLeadSheet.preferredPropertyType = filters.propertyType;
      }
      if (filters.bedrooms !== null && filters.bedrooms !== undefined && !isNaN(Number(filters.bedrooms))) {
        aiLeadSheet.preferredBedrooms = Number(filters.bedrooms);
      }

      if (aiLeadSheet.verifiedBudget.amount && aiLeadSheet.areasOfInterest.length > 0 && ['IMMEDIATE', '1_TO_3_MONTHS'].includes(aiLeadSheet.timeline)) {
        aiLeadSheet.leadQuality = 'HOT';
      } else if (aiLeadSheet.verifiedBudget.amount || aiLeadSheet.areasOfInterest.length > 0 || aiLeadSheet.timeline !== 'UNDECIDED') {
        aiLeadSheet.leadQuality = 'WARM';
      } else {
        aiLeadSheet.leadQuality = 'COLD';
      }
    }

    const buyerName = req.user?.name || req.body.name || 'Interested Buyer';
    const buyerPhone = req.user?.phone || req.body.phone || '';
    const buyerEmail = req.user?.email || req.body.email || '';

    // Property display details
    const propTitle = propDoc?.title?.es || propDoc?.title?.en || (typeof propDoc?.title === 'string' ? propDoc.title : 'Propiedad en KleverProp');
    const propLocation = [
      propDoc?.location?.address,
      propDoc?.location?.area,
      propDoc?.location?.city,
      propDoc?.location?.state,
      propDoc?.location?.country
    ].filter(Boolean).join(', ') || 'República Dominicana';
    const propPrice = propDoc?.price?.usd
      ? `$${propDoc.price.usd.toLocaleString()} USD`
      : (propDoc?.price?.dop ? `RD$${propDoc.price.dop.toLocaleString()} DOP` : 'Consultar precio');

    let lead;

    if (agentUser) {
      // --------------------------------------------------------------
      // CASE 1: Agent ID is provided and Agent is Tier 2 or Tier 3
      // - Lead sent to agent (isClaimed: true)
      // - Notifications sent to BOTH user (buyer) and agent
      // - NO EMAILS sent to anyone
      // --------------------------------------------------------------
      lead = new Lead({
        user: userId,
        agent: agentUser._id,
        agentEmail: agentUser.email ? agentUser.email.toLowerCase() : (targetAgentEmail || null),
        isClaimed: true,
        property: propertyId,
        description,
        aiLeadSheet,
        status: 'pending',
      });

      await lead.save();

      // In-app Notification for Buyer (User)
      try {
        await Notification.create({
          recipient: userId,
          sender: agentUser._id,
          title: {
            en: 'Inquiry Sent Successfully',
            es: 'Consulta enviada con éxito',
          },
          message: {
            en: `Your inquiry has been sent successfully to ${agentUser.name || 'the agent'}. You can track its status under My Inquiries.`,
            es: `Su consulta ha sido enviada con éxito a ${agentUser.name || 'el asesor'}. Puede seguir su estado en Mis Consultas.`,
          },
          type: 'LEAD_SENT',
          data: {
            lead: lead._id,
            property: propertyId,
            link: '/my-leads',
            metadata: {
              agentId: agentUser._id,
              agentName: agentUser.name || 'Asesor KleverProp',
              description,
            },
          },
        });
      } catch (notifErr) {
        console.error(`Failed to create lead confirmation notification for user: ${notifErr.message}`);
      }

      // In-app Notification for Agent
      try {
        const qualityIcon = aiLeadSheet.leadQuality === 'HOT' ? '🔥 ' : (aiLeadSheet.leadQuality === 'WARM' ? '⚡ ' : '');
        const budgetText = aiLeadSheet.verifiedBudget.amount ? ` (${aiLeadSheet.verifiedBudget.formatted})` : '';

        await Notification.create({
          recipient: agentUser._id,
          sender: userId,
          title: {
            en: `${qualityIcon}New Inquiry Received`,
            es: `${qualityIcon}Nueva consulta recibida`,
          },
          message: {
            en: `New ${aiLeadSheet.leadQuality} inquiry received from ${buyerName}${budgetText}`,
            es: `Nueva consulta ${aiLeadSheet.leadQuality} recibida de ${buyerName}${budgetText}`,
          },
          type: 'LEAD_RECEIVED',
          data: {
            lead: lead._id,
            property: propertyId,
            link: '/agent/leads',
          },
        });
      } catch (agentNotifErr) {
        console.error(`Failed to create lead notification for agent: ${agentNotifErr.message}`);
      }

    } else {
      // --------------------------------------------------------------
      // CASE 2: No registered agent found (agentId is NULL)
      // - Lead generated with agent: null (isClaimed: false)
      // - In-app notification sent to Buyer (User)
      // - Email sent ONLY to mobappssolutions124@gmail.com in English (NO USER INFO)
      // --------------------------------------------------------------
      lead = new Lead({
        user: userId,
        agent: null,
        agentEmail: targetAgentEmail || null,
        isClaimed: false,
        property: propertyId,
        description,
        aiLeadSheet,
        status: 'pending',
      });

      await lead.save();

      // In-app Notification for Buyer (User)
      try {
        await Notification.create({
          recipient: userId,
          sender: null,
          title: {
            en: 'Inquiry Sent Successfully',
            es: 'Consulta enviada con éxito',
          },
          message: {
            en: 'Your inquiry has been sent successfully. You can track its status under My Inquiries.',
            es: 'Su consulta ha sido enviada con éxito. Puede seguir su estado en Mis Consultas.',
          },
          type: 'LEAD_SENT',
          data: {
            lead: lead._id,
            property: propertyId,
            link: '/my-leads',
            metadata: {
              agentEmail: targetAgentEmail || null,
              description,
            },
          },
        });
      } catch (notifErr) {
        console.error(`Failed to create lead confirmation notification for user: ${notifErr.message}`);
      }

      // Email sent ONLY to mobappssolutions124@gmail.com in English, with NO user information
      try {
        const emailHtml = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.06);">
          <div style="background: linear-gradient(135deg, #002B49 0%, #004b7a 100%); padding: 30px 25px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 24px; font-weight: bold;">KleverProp</h1>
            <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.95;">A user is interested in your property!</p>
          </div>

          <div style="padding: 25px; color: #1e293b;">
            <p style="font-size: 16px; margin-top: 0;">Hello,</p>
            <p style="font-size: 14px; color: #475569; line-height: 1.6;">
              A user is interested in your property listed on KleverProp.
            </p>

            <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 15px 0;">
              <h4 style="margin: 0 0 8px 0; color: #0f172a;">🏠 Property Details:</h4>
              <p style="margin: 2px 0; font-size: 14px;"><strong>${propTitle}</strong></p>
              <p style="margin: 2px 0; font-size: 13px; color: #64748b;">📍 ${propLocation} | 💰 ${propPrice}</p>
            </div>

            <div style="background: #eff6ff; border: 1px dashed #3b82f6; border-radius: 8px; padding: 20px; margin: 25px 0; text-align: center;">
              <h3 style="margin: 0 0 8px 0; font-size: 17px; color: #1e40af;">Register on KleverProp Real Estate App</h3>
              <p style="margin: 0 0 16px 0; font-size: 14px; color: #1e3a8a;">
                Please register on the KleverProp Real Estate App to view this inquiry and connect with interested clients.
              </p>
              <a href="https://kleverprop.com/register" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 28px; font-size: 14px; font-weight: 600; border-radius: 6px; box-shadow: 0 2px 6px rgba(37,99,235,0.3);">
                Register on KleverProp App
              </a>
            </div>
          </div>
          <div style="background: #f1f5f9; padding: 15px; text-align: center; font-size: 12px; color: #64748b;">
            © ${new Date().getFullYear()} KleverProp Real Estate Platform.
          </div>
        </div>
        `;

        await sendEmail({
          to: 'Klever.correa17@gmail.com',
          subject: `[KleverProp] A user is interested in your property - ${propTitle}`,
          html: emailHtml,
          text: `Hello, A user is interested in your property "${propTitle}". Please register on the KleverProp Real Estate App to view this inquiry.`,
        });
      } catch (mailErr) {
        console.error(`Failed to send lead alert email: ${mailErr.message}`);
      }
    }

    await lead.populate([
      { path: 'property', select: 'title location price images propertyType listingType' },
      { path: 'agent', select: 'name email phone profileImage' },
    ]);

    const leadData = lead.toObject ? lead.toObject({ virtuals: false }) : { ...lead };
    delete leadData.userId;
    delete leadData.agentId;
    delete leadData.propertyId;
    delete leadData.id;

    return res.status(201).json({
      success: true,
      message: getLocalizedMessage('leadSent', lang) || (lang === 'es' ? 'Consulta enviada con éxito' : 'Inquiry sent successfully'),
      data: leadData,
    });
  } catch (err) {
    console.error(`Send lead error: ${err.message}`);
    next(err);
  }
};

const getMyLeads = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const lang = resolveLanguage(req);

    // Calculate tier level & isBlur (true if Tier 1, false otherwise)
    const tierLevel = await getAgentTierLevel(req.user);
    const isBlur = tierLevel === 1;

    // If authenticated user is an agent, fetch leads assigned to them or created by them
    const query = req.user.role === 'agent'
      ? { $or: [{ agent: userId }, { user: userId }] }
      : { user: userId };

    const leads = await Lead.find(query)
      .populate('user', 'name email phone profileImage')
      .populate('agent', 'name email phone profileImage')
      .populate('property', 'title location price images propertyType listingType')
      .sort({ createdAt: -1 })
      .lean();

    const cleanedLeads = leads.map((item) => {
      const leadObj = item && typeof item.toObject === 'function' ? item.toObject({ virtuals: false }) : { ...item };
      delete leadObj.userId;
      delete leadObj.agentId;
      delete leadObj.propertyId;
      delete leadObj.id;
      leadObj.isBlur = isBlur;
      return leadObj;
    });

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('leadsRetrieved', lang),
      isBlur,
      data: cleanedLeads,
    });
  } catch (err) {
    console.error(`Get my leads error: ${err.message}`);
    next(err);
  }
};

const deleteLead = async (req, res, next) => {
  try {
    // Both :leadId or :id parameter handle karta hai
    const { leadId } = req.params;
    const userId = req.user._id;
    const lang = resolveLanguage(req);

    // 1. Check if ID exists
    if (!leadId) {
      const error = new Error(
        lang === 'es' ? 'Se requiere el ID de la consulta' : 'Inquiry ID is required'
      );
      error.statusCode = 400;
      return next(error);
    }

    // 2. Validate MongoDB ObjectId format
    if (!mongoose.Types.ObjectId.isValid(leadId)) {
      const error = new Error(getLocalizedMessage('invalidLeadId', lang));
      error.statusCode = 400;
      return next(error);
    }

    // 3. Find the Lead
    const lead = await Lead.findById(leadId);
    if (!lead) {
      const error = new Error(getLocalizedMessage('leadNotFound', lang));
      error.statusCode = 404;
      return next(error);
    }

    // 4. Status check: Sirf completed ya rejected leads hi delete ho sakti hain
    if (!['completed', 'rejected','closed'].includes(lead.status)) {
      const error = new Error(
        lang === 'es'
          ? 'Solo se pueden eliminar consultas completadas o rechazadas'
          : 'Only completed, rejected and closed inquiries can be deleted'
      );
      error.statusCode = 400;
      return next(error);
    }

    // 5. Delete Lead from DB
    await Lead.findByIdAndDelete(leadId);

    return res.status(200).json({
      success: true,
      message:
        lang === 'es'
          ? 'Consulta eliminada con éxito'
          : 'Inquiry deleted successfully',
      data: {
        id: leadId,
      },
    });
  } catch (error) {
    console.error(`Delete lead error: ${error.message}`);
    next(error);
  }
};

const getLeadById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const lang = resolveLanguage(req);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error(getLocalizedMessage('invalidLeadId', lang));
      error.statusCode = 400;
      return next(error);
    }

    const lead = await Lead.findById(id)
      .populate('agent', 'name email phone profileImage')
      .populate('user', 'name email phone profileImage')
      .populate('property', 'title location price images propertyType listingType');

    if (!lead) {
      const error = new Error(getLocalizedMessage('leadNotFound', lang));
      error.statusCode = 404;
      return next(error);
    }

    // Ensure only the user who created it, the assigned agent, or an admin can access it
    const isOwner = lead.user && lead.user._id.toString() === userId.toString();
    const isAgent = lead.agent && lead.agent._id.toString() === userId.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAgent && !isAdmin) {
      const error = new Error(lang === 'es' ? 'No está autorizado para acceder a esta consulta' : 'Not authorized to access this inquiry');
      error.statusCode = 403;
      return next(error);
    }

    const tierLevel = await getAgentTierLevel(req.user);
    const isBlur = tierLevel === 1;

    const leadObj = lead && typeof lead.toObject === 'function' ? lead.toObject({ virtuals: false }) : { ...lead };
    delete leadObj.userId;
    delete leadObj.agentId;
    delete leadObj.propertyId;
    delete leadObj.id;
    leadObj.isBlur = isBlur;

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('leadRetrieved', lang),
      isBlur,
      data: leadObj,
    });
  } catch (err) {
    console.error(`Get Lead by ID error: ${err.message}`);
    next(err);
  }
};

const getAgentLeads = async (req, res, next) => {
  try {
    const agentId = req.user._id;

    // Verify user has 'agent' or 'admin' role
    if (req.user.role !== 'agent' && req.user.role !== 'admin') {
      const error = new Error('Access denied. Only registered agents can view agent leads.');
      error.statusCode = 403;
      return next(error);
    }

    // Auto-claim any unlinked leads matching this agent's email
    const agentEmail = req.user.email ? req.user.email.toLowerCase() : null;
    if (agentEmail) {
      try {
        await Lead.updateMany(
          { agentEmail: agentEmail, isClaimed: false },
          { $set: { agent: agentId, isClaimed: true } }
        );
      } catch (claimErr) {
        console.error(`Auto-claim in getAgentLeads error: ${claimErr.message}`);
      }
    }

    const {
      status,
      search,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const query = { agent: agentId };

    // Filter by lead status if provided
    if (status) {
      query.status = status;
    }

    // Search by customer name, email, or phone
    if (search) {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      query.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const skip = (pageNum - 1) * limitNum;

    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Fetch leads and status metrics in parallel
    const [leads, totalMatching, totalAll, pendingCount, approvedCount, completedCount, rejectedCount, closedCount] =
      await Promise.all([
        Lead.find(query)
          .populate('user', 'name email phone profileImage')
          .populate('property', 'title location price images propertyType listingType')
          .sort(sortObj)
          .skip(skip)
          .limit(limitNum),
        Lead.countDocuments(query),
        Lead.countDocuments({ agent: agentId }),
        Lead.countDocuments({ agent: agentId, status: 'pending' }),
        Lead.countDocuments({ agent: agentId, status: 'approved' }),
        Lead.countDocuments({ agent: agentId, status: 'completed' }),
        Lead.countDocuments({ agent: agentId, status: 'rejected' }),
        Lead.countDocuments({ agent: agentId, status: 'closed' }),
      ]);

    const tierLevel = await getAgentTierLevel(req.user);
    const isBlur = tierLevel === 1;

    const cleanedLeads = leads.map((item) => {
      const itemObj = item && typeof item.toObject === 'function' ? item.toObject({ virtuals: false }) : { ...item };
      delete itemObj.userId;
      delete itemObj.agentId;
      delete itemObj.propertyId;
      delete itemObj.id;
      itemObj.isBlur = isBlur;
      return itemObj;
    });

    const lang = resolveLanguage(req);

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('leadsRetrieved', lang),
      isBlur,
      data: {
        isBlur,
        leads: cleanedLeads,
        stats: {
          total: totalAll,
          pending: pendingCount,
          approved: approvedCount,
          completed: completedCount,
          rejected: rejectedCount,
          closed: closedCount,
        },
        pagination: {
          total: totalMatching,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(totalMatching / limitNum) || 1,
        },
      },
    });
  } catch (err) {
    console.error(`Get agent leads error: ${err.message}`);
    next(err);
  }
};

const updateAgentLeadStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, reason, closedReason } = req.body;
    const agentId = req.user._id;
    const lang = resolveLanguage(req);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error(lang === 'es' ? 'Formato de ID de consulta no válido' : 'Invalid Inquiry ID format');
      error.statusCode = 400;
      return next(error);
    }

    const allowedStatuses = ['pending', 'approved', 'completed', 'rejected', 'closed'];
    if (!status || !allowedStatuses.includes(status)) {
      const error = new Error(lang === 'es' ? `Estado no válido. Debe ser uno de: ${allowedStatuses.join(', ')}` : `Invalid status. Must be one of: ${allowedStatuses.join(', ')}`);
      error.statusCode = 400;
      return next(error);
    }

    // Reason is mandatory when status is 'closed'
    const finalReason = (reason || closedReason || '').trim();
    if (status === 'closed' && !finalReason) {
      const error = new Error(
        lang === 'es'
          ? 'Se requiere una razón para cerrar la consulta'
          : 'Reason is required when status is closed'
      );
      error.statusCode = 400;
      return next(error);
    }

    const query = req.user.role === 'admin' ? { _id: id } : { _id: id, agent: agentId };
    const lead = await Lead.findOne(query);

    if (!lead) {
      const error = new Error(lang === 'es' ? 'Consulta no encontrada o no está autorizado' : 'Inquiry not found or you are not authorized to update this inquiry');
      error.statusCode = 404;
      return next(error);
    }

    const previousStatus = lead.status;
    lead.status = status;
    if (status === 'closed') {
      lead.closedReason = finalReason;
      lead.reason = finalReason;
    }

    await lead.save();

    // Send notification to the user who submitted the lead
    if (lead.user) {
      try {
        const agentName = req.user.name || 'Your agent';
        const agentNameEs = req.user.name || 'Su asesor';
        const statusMapEs = {
          pending: 'pendiente',
          approved: 'aprobado',
          completed: 'completado',
          rejected: 'rechazado',
          closed: 'cerrado',
        };
        const statusEs = statusMapEs[status.toLowerCase()] || status;

        const reasonTextEn = status === 'closed' && finalReason ? ` Reason: ${finalReason}` : '';
        const reasonTextEs = status === 'closed' && finalReason ? ` Razón: ${finalReason}` : '';

        await Notification.create({
          recipient: lead.user,
          sender: agentId,
          title: {
            en: 'Inquiry Status Updated',
            es: 'Estado de la consulta actualizado',
          },
          message: {
            en: `${agentName} has updated your inquiry status to "${status}".${reasonTextEn}`,
            es: `${agentNameEs} ha actualizado el estado de su consulta a "${statusEs}".${reasonTextEs}`,
          },
          type: 'LEAD_UPDATE',
          data: {
            lead: lead._id,
            link: `/my-leads`,
            metadata: {
              previousStatus,
              newStatus: status,
              reason: status === 'closed' ? finalReason : null,
              agentName,
            },
          },
        });
      } catch (notifErr) {
        console.error(`Failed to send lead status update notification to user: ${notifErr.message}`);
      }
    }

    const leadObj = lead && typeof lead.toObject === 'function' ? lead.toObject({ virtuals: false }) : { ...lead };
    delete leadObj.userId;
    delete leadObj.agentId;
    delete leadObj.propertyId;
    delete leadObj.id;

    res.status(200).json({
      success: true,
      message: lang === 'es' ? `Estado de la consulta actualizado de '${previousStatus}' a '${status}'` : `Inquiry status updated from '${previousStatus}' to '${status}'`,
      data: leadObj,
    });
  } catch (err) {
    console.error(`Update agent lead status error: ${err.message}`);
    next(err);
  }
};

module.exports = {
  sendLead,
  getMyLeads,
  getLeadById,
  deleteLead,
  getAgentLeads,
  updateAgentLeadStatus,
  extractFiltersFromText,
};