/**
 * Utility helper to resolve UI appearance, Badges, and Call-to-Action (CTA) buttons
 * strictly following the 3-Tier Commercial Hierarchy, Customer Conversion Funnel,
 * and Institutional Lead Protection Firewall rules.
 */

const resolvePropertyEngagement = (propertyDoc, lang = 'en', defaultTier1 = null) => {
  if (!propertyDoc) return { uiStyle: null, ctaAction: null, tier: null };

  const agency = propertyDoc.agency && typeof propertyDoc.agency === 'object' ? propertyDoc.agency : null;
  const agent = propertyDoc.agent && typeof propertyDoc.agent === 'object' ? propertyDoc.agent : null;

  // 1. Determine effective Tier Level (1, 2, or 3)
  let effectiveTierLevel = 1;
  let effectiveTierObj = defaultTier1 || {
    tierLevel: 1,
    name: 'Tier 1 — Basic',
    uiAppearance: { badgeType: 'NONE', enableShimmerAnimation: false, hasCardHighlight: false },
    conversionAndLeads: { external_webview: true, whatapps_button: false, enableNativeLeadNotifications: false }
  };

  // If agent is self-subscribed (not covered by agency plan) and on Tier 1, their personal tier takes precedence
  const isSelfSubscribedTier1Agent = agent && agent.isCoveredByAgency === false && agent?.tier?.tierLevel === 1;

  if (!isSelfSubscribedTier1Agent && (agency?.isFoundingSponsor || agency?.tier?.tierLevel === 3 || agent?.tier?.tierLevel === 3)) {
    effectiveTierLevel = 3;
    effectiveTierObj = (agent?.tier?.tierLevel === 3 ? agent.tier : null)
      || (agency?.tier?.tierLevel === 3 ? agency.tier : null)
      || agency?.tier
      || agent?.tier
      || {
        tierLevel: 3,
        name: 'Tier 3 — Founding Sponsor',
        uiAppearance: { badgeType: 'GOLDEN_STAR', enableShimmerAnimation: true, hasCardHighlight: true },
        conversionAndLeads: { external_webview: false, whatapps_button: true, enableNativeLeadNotifications: true }
      };
  } else if (!isSelfSubscribedTier1Agent && (agency?.tier?.tierLevel === 2 || agent?.tier?.tierLevel === 2)) {
    effectiveTierLevel = 2;
    effectiveTierObj = (agent?.tier?.tierLevel === 2 ? agent.tier : null)
      || (agency?.tier?.tierLevel === 2 ? agency.tier : null)
      || agency?.tier
      || agent?.tier
      || {
        tierLevel: 2,
        name: 'Tier 2 — Pro',
        uiAppearance: { badgeType: 'BLUE_CHECKMARK', enableShimmerAnimation: false, hasCardHighlight: false },
        conversionAndLeads: { external_webview: false, whatapps_button: true, enableNativeLeadNotifications: true }
      };
  } else if (isSelfSubscribedTier1Agent) {
    effectiveTierLevel = 1;
    effectiveTierObj = (agent?.tier && typeof agent.tier === 'object') ? agent.tier : (defaultTier1 || effectiveTierObj);
  }

  // Determine Agent's personal tier
  const agentTierLevel = agent?.tier?.tierLevel || (effectiveTierLevel === 3 && agency?.isFoundingSponsor ? 3 : (effectiveTierLevel === 3 ? 3 : 1));
  const isAgentUnregisteredOrTier1 = !agent || agentTierLevel === 1;

  // =========================================================================
  // SECTION 4: VISUAL IDENTITY & UI RULES (FLUTTER APP)
  // =========================================================================
  const isTier3 = effectiveTierLevel === 3;
  const isTier2 = effectiveTierLevel === 2;
  const isTier1 = effectiveTierLevel === 1;

  const brandHex = isTier3 ? (agency?.brandColorHex || '#002B49') : null;

  const badgeLabels = {
    3: { en: 'Official Sponsor', es: 'Patrocinador Oficial' },
    2: { en: 'Verified Agent', es: 'Asesor Verificado' },
    1: { en: '', es: '' }
  };

  const uiStyle = {
    tierLevel: effectiveTierLevel,
    badgeType: isTier3 ? 'GOLDEN_STAR' : (isTier2 ? 'BLUE_CHECKMARK' : 'NONE'),
    badgeLabel: badgeLabels[effectiveTierLevel]?.[lang] || badgeLabels[effectiveTierLevel]?.en || '',
    brandColorHex: brandHex,
    enableShimmerAnimation: isTier3,
    hasCardHighlight: isTier3, // Unique border or BoxShadow
    cardElevation: isTier3 ? 4 : (isTier2 ? 2 : 0),
    isMinimalFlat: isTier1
  };

  // =========================================================================
  // SECTION 5 & 6: CONVERSION, CTA BUTTON & INSTITUTIONAL BRAND FIREWALL
  // =========================================================================
  let ctaAction = {};

  // RULE A: SECTION 6 - INSTITUTIONAL LEAD PROTECTION (BRAND FIREWALL)
  // If property belongs to Founding Sponsor, but individual agent is unregistered or on Tier 1 (Free)
  if (isTier3 && isAgentUnregisteredOrTier1) {
    const rawCorporatePhone = agency?.corporateWhatsapp || agency?.corporateCallCenterPhone || propertyDoc?.agentDetails?.phone || '';
    const cleanPhone = rawCorporatePhone.replace(/[^0-9+]/g, '').replace(/^\+/, '');

    ctaAction = {
      type: agency?.corporateWhatsapp ? 'WHATSAPP' : (agency?.corporateCallCenterPhone ? 'CALL_CENTER' : 'EXTERNAL_PORTAL'),
      actionCategory: 'CORPORATE_FIREWALL',
      label: lang === 'es' ? 'Contactar Red Oficial' : 'Contact Official Corporate Network',
      whatsappUrl: cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(lang === 'es' ? `Hola, me interesa la propiedad oficial ${propertyDoc.title?.es || propertyDoc.title?.en || ''}` : `Hello, I am interested in the official listing ${propertyDoc.title?.en || propertyDoc.title?.es || ''}`)}` : null,
      callPhone: agency?.corporateCallCenterPhone || null,
      portalUrl: agency?.masterPortalUrl || agency?.website || propertyDoc.sourceUrl || null,
      isFirewallRerouted: true,
      firewallMessage: lang === 'es'
        ? 'Para brindarle el mejor servicio, esta consulta es atendida directamente por el centro oficial del Patrocinador.'
        : 'For your security and direct service, this inquiry is routed directly through the Sponsor Corporate Center.',
      target: 'corporate_sponsor'
    };
  }
  // RULE B: HIGH-CONVERSION FLOW (TIER 2 PRO & ACTIVE TIER 3 SPONSOR AGENT)
  else if (effectiveTierLevel >= 2 && agent) {
    const rawPhone = agent.whatsapp || agent.phone || propertyDoc?.agentDetails?.whatsapp || propertyDoc?.agentDetails?.phone || '';
    const cleanPhone = rawPhone.replace(/[^0-9+]/g, '').replace(/^\+/, '');

    ctaAction = {
      type: 'WHATSAPP',
      actionCategory: 'DIRECT_NATIVE',
      label: lang === 'es' ? 'Contactar por WhatsApp' : 'Contact via WhatsApp',
      whatsappUrl: cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(lang === 'es' ? `Hola, me interesa la propiedad ${propertyDoc.title?.es || propertyDoc.title?.en || ''}` : `Hello, I am interested in the listing ${propertyDoc.title?.en || propertyDoc.title?.es || ''}`)}` : null,
      phone: agent.phone || null,
      isFirewallRerouted: false,
      target: 'agent'
    };
  }
  // RULE C: COMMERCIAL FRICTION FLOW (TIER 1 BASIC / FREE)
  else {
    ctaAction = {
      type: 'EXTERNAL_WEBVIEW',
      actionCategory: 'EXTERNAL_REDIRECTION',
      label: lang === 'es' ? 'Ver en portal original' : 'View on Original Site',
      actionUrl: propertyDoc.sourceUrl || null,
      sourceName: propertyDoc.source || 'Original Portal',
      isFirewallRerouted: false,
      target: 'external_source'
    };
  }

  return {
    tier: effectiveTierObj,
    uiStyle,
    ctaAction
  };
};

module.exports = {
  resolvePropertyEngagement
};
