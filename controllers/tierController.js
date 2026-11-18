const mongoose = require('mongoose');
const Tier = require('../models/Tier');

// ==========================================
// 1. ADD TIER (POST /api/admin/tiers or /api/admin/tiers/add)
// ==========================================
const addTier = async (req, res, next) => {
  try {
    const {
      tierLevel,
      name,
      description,
      price,
      discountPercentage,
      currency,
      pricing, // Fallback if sent inside pricing object
      searchAndAI,
      uiAppearance,
      conversionAndLeads,
      isActive
    } = req.body;

    // 1. Tier level validation: 1, 2, ya 3 
    const parsedTierLevel = Number(tierLevel);
    if (!tierLevel || isNaN(parsedTierLevel) || ![1, 2, 3].includes(parsedTierLevel)) {
      return res.status(400).json({
        success: false,
        message: 'Valid Tier Level (1, 2, or 3) is required.'
      });
    }

    // 2. Name validation
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Tier name is required.'
      });
    }

    // 3. Unique check for tierLevel
    const existingTier = await Tier.findOne({ tierLevel: parsedTierLevel });
    if (existingTier) {
      return res.status(400).json({
        success: false,
        message: `Tier Level ${parsedTierLevel} already exists. You can edit it instead.`
      });
    }

    // 4. Price resolution & validation (min: 0, default: 0)
    const rawPrice = price !== undefined
      ? price
      : (pricing?.price !== undefined ? pricing.price : pricing?.monthlyPrice);
    let resolvedPrice = 0;
    if (rawPrice !== undefined && rawPrice !== null) {
      resolvedPrice = Number(rawPrice);
      if (isNaN(resolvedPrice) || resolvedPrice < 0) {
        return res.status(400).json({
          success: false,
          message: 'Price must be a valid non-negative number.'
        });
      }
    }

    // 5. Discount Percentage resolution & validation (min: 0, max: 100, default: 0)
    const rawDiscount = discountPercentage !== undefined
      ? discountPercentage
      : pricing?.discountPercentage;
    let resolvedDiscount = 0;
    if (rawDiscount !== undefined && rawDiscount !== null) {
      resolvedDiscount = Number(rawDiscount);
      if (isNaN(resolvedDiscount) || resolvedDiscount < 0 || resolvedDiscount > 100) {
        return res.status(400).json({
          success: false,
          message: 'Discount percentage must be between 0 and 100.'
        });
      }
    }

    // 6. Currency (default: USD)
    const resolvedCurrency = (currency || pricing?.currency || 'USD').toString().trim().toUpperCase();

    // 7. searchAndAI (searchPriorityWeight enum: [1, 2, 3], default: 1)
    let searchPriorityWeight = searchAndAI?.searchPriorityWeight !== undefined
      ? Number(searchAndAI.searchPriorityWeight)
      : parsedTierLevel;
    if (![1, 2, 3].includes(searchPriorityWeight)) {
      return res.status(400).json({
        success: false,
        message: 'searchPriorityWeight must be 1, 2, or 3.'
      });
    }

    // 8. uiAppearance (badgeType: 'NONE' | 'BLUE_CHECKMARK' | 'GOLDEN_STAR')
    const allowedBadges = ['NONE', 'BLUE_CHECKMARK', 'GOLDEN_STAR'];
    let badgeType = 'NONE';
    if (uiAppearance?.badgeType) {
      const upperBadge = String(uiAppearance.badgeType).trim().toUpperCase();
      if (!allowedBadges.includes(upperBadge)) {
        return res.status(400).json({
          success: false,
          message: `badgeType must be one of: ${allowedBadges.join(', ')}`
        });
      }
      badgeType = upperBadge;
    }

    const enableShimmerAnimation = uiAppearance?.enableShimmerAnimation !== undefined
      ? Boolean(uiAppearance.enableShimmerAnimation)
      : (parsedTierLevel === 3);
    const hasCardHighlight = uiAppearance?.hasCardHighlight !== undefined
      ? Boolean(uiAppearance.hasCardHighlight)
      : (parsedTierLevel >= 2);

    // 9. conversionAndLeads
    const externalWebview = conversionAndLeads?.external_webview !== undefined
      ? Boolean(conversionAndLeads.external_webview)
      : false;
    const whatsappBtn = conversionAndLeads?.whatapps_button !== undefined
      ? Boolean(conversionAndLeads.whatapps_button)
      : (conversionAndLeads?.whatsapp_button !== undefined ? Boolean(conversionAndLeads.whatsapp_button) : false);
    const nativeLeads = conversionAndLeads?.enableNativeLeadNotifications !== undefined
      ? Boolean(conversionAndLeads.enableNativeLeadNotifications)
      : (parsedTierLevel >= 2);

    // Create Tier (TierSchema.pre('validate') hook will automatically calculate finalPrice)
    const newTier = await Tier.create({
      tierLevel: parsedTierLevel,
      name: name.trim(),
      description: description !== undefined ? String(description).trim() : '',
      price: resolvedPrice,
      discountPercentage: resolvedDiscount,
      currency: resolvedCurrency,
      searchAndAI: {
        searchPriorityWeight
      },
      uiAppearance: {
        badgeType,
        enableShimmerAnimation,
        hasCardHighlight
      },
      conversionAndLeads: {
        external_webview: externalWebview,
        whatapps_button: whatsappBtn,
        enableNativeLeadNotifications: nativeLeads
      },
      isActive: isActive !== undefined ? Boolean(isActive) : true
    });

    return res.status(201).json({
      success: true,
      message: 'Tier created successfully.',
      data: newTier
    });
  } catch (error) {
    console.error(`Add Tier Error: ${error.message}`);
    next(error);
  }
};

// ==========================================
// 2. GET ALL TIERS (GET /api/admin/tiers or /api/admin/tiers/get-all)
// ==========================================
const getAllTiers = async (req, res, next) => {
  try {
    // Tiers ko level ke hisab se sort karein (Tier 1 -> Tier 2 -> Tier 3)
    const tiers = await Tier.find({}).sort({ tierLevel: 1 });

    return res.status(200).json({
      success: true,
      count: tiers.length,
      message: 'Tiers fetched successfully.',
      data: tiers
    });
  } catch (error) {
    console.error(`Get All Tiers Error: ${error.message}`);
    next(error);
  }
};

// ==========================================
// 3. GET TIER BY ID (GET /api/admin/tiers/:id)
// ==========================================
const getTierById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Tier ID format.'
      });
    }

    const tier = await Tier.findById(id);
    if (!tier) {
      return res.status(404).json({
        success: false,
        message: 'Tier not found. Please provide a valid ID.'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Tier fetched successfully.',
      data: tier
    });
  } catch (error) {
    console.error(`Get Tier By Id Error: ${error.message}`);
    next(error);
  }
};

// ==========================================
// 4. EDIT TIER BY ID (PUT /api/admin/tiers/edit/:id or /api/admin/tiers/:id)
// ==========================================
const updateTierById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Tier ID format.'
      });
    }

    // Check: Kya Tier exist karta hai?
    const tier = await Tier.findById(id);
    if (!tier) {
      return res.status(404).json({
        success: false,
        message: 'Tier not found. Please provide a valid ID.'
      });
    }

    const {
      tierLevel,
      name,
      description,
      price,
      discountPercentage,
      currency,
      pricing,
      searchAndAI,
      uiAppearance,
      conversionAndLeads,
      isActive
    } = req.body;

    // 1. Agar tierLevel change karne ki koshish ho rahi hai toh validate aur unique check karein
    if (tierLevel !== undefined) {
      const parsedTierLevel = Number(tierLevel);
      if (isNaN(parsedTierLevel) || ![1, 2, 3].includes(parsedTierLevel)) {
        return res.status(400).json({
          success: false,
          message: 'Tier level must be 1, 2, or 3.'
        });
      }

      if (parsedTierLevel !== tier.tierLevel) {
        const duplicateCheck = await Tier.findOne({
          tierLevel: parsedTierLevel,
          _id: { $ne: id }
        });
        if (duplicateCheck) {
          return res.status(400).json({
            success: false,
            message: `Tier Level ${parsedTierLevel} is already in use by another tier.`
          });
        }
        tier.tierLevel = parsedTierLevel;
      }
    }

    // 2. Name update
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Tier name cannot be empty.'
        });
      }
      tier.name = name.trim();
    }

    // 3. Description update
    if (description !== undefined) {
      tier.description = String(description).trim();
    }

    // 4. Price update
    const rawPrice = price !== undefined
      ? price
      : (pricing?.price !== undefined ? pricing.price : pricing?.monthlyPrice);
    if (rawPrice !== undefined && rawPrice !== null) {
      const parsedPrice = Number(rawPrice);
      if (isNaN(parsedPrice) || parsedPrice < 0) {
        return res.status(400).json({
          success: false,
          message: 'Price must be a valid non-negative number.'
        });
      }
      tier.price = parsedPrice;
    }

    // 5. Discount Percentage update
    const rawDiscount = discountPercentage !== undefined
      ? discountPercentage
      : pricing?.discountPercentage;
    if (rawDiscount !== undefined && rawDiscount !== null) {
      const parsedDiscount = Number(rawDiscount);
      if (isNaN(parsedDiscount) || parsedDiscount < 0 || parsedDiscount > 100) {
        return res.status(400).json({
          success: false,
          message: 'Discount percentage must be between 0 and 100.'
        });
      }
      tier.discountPercentage = parsedDiscount;
    }

    // 6. Currency update
    const rawCurrency = currency || pricing?.currency;
    if (rawCurrency !== undefined) {
      tier.currency = String(rawCurrency).trim().toUpperCase();
    }

    // 7. searchAndAI update
    if (searchAndAI) {
      if (!tier.searchAndAI) {
        tier.searchAndAI = {};
      }
      if (searchAndAI.searchPriorityWeight !== undefined) {
        const weight = Number(searchAndAI.searchPriorityWeight);
        if (![1, 2, 3].includes(weight)) {
          return res.status(400).json({
            success: false,
            message: 'searchPriorityWeight must be 1, 2, or 3.'
          });
        }
        tier.searchAndAI.searchPriorityWeight = weight;
      }
    }

    // 8. uiAppearance update
    if (uiAppearance) {
      if (!tier.uiAppearance) {
        tier.uiAppearance = {};
      }
      if (uiAppearance.badgeType !== undefined) {
        const badge = String(uiAppearance.badgeType).trim().toUpperCase();
        const allowedBadges = ['NONE', 'BLUE_CHECKMARK', 'GOLDEN_STAR'];
        if (!allowedBadges.includes(badge)) {
          return res.status(400).json({
            success: false,
            message: `badgeType must be one of: ${allowedBadges.join(', ')}`
          });
        }
        tier.uiAppearance.badgeType = badge;
      }
      if (uiAppearance.enableShimmerAnimation !== undefined) {
        tier.uiAppearance.enableShimmerAnimation = Boolean(uiAppearance.enableShimmerAnimation);
      }
      if (uiAppearance.hasCardHighlight !== undefined) {
        tier.uiAppearance.hasCardHighlight = Boolean(uiAppearance.hasCardHighlight);
      }
    }

    // 9. conversionAndLeads update
    if (conversionAndLeads) {
      if (!tier.conversionAndLeads) {
        tier.conversionAndLeads = {};
      }
      if (conversionAndLeads.external_webview !== undefined) {
        tier.conversionAndLeads.external_webview = Boolean(conversionAndLeads.external_webview);
      }
      const whatsappVal = conversionAndLeads.whatapps_button !== undefined
        ? conversionAndLeads.whatapps_button
        : conversionAndLeads.whatsapp_button;
      if (whatsappVal !== undefined) {
        tier.conversionAndLeads.whatapps_button = Boolean(whatsappVal);
      }
      if (conversionAndLeads.enableNativeLeadNotifications !== undefined) {
        tier.conversionAndLeads.enableNativeLeadNotifications = Boolean(conversionAndLeads.enableNativeLeadNotifications);
      }
    }

    // 10. isActive update
    if (isActive !== undefined) {
      tier.isActive = Boolean(isActive);
    }

    // tier.save() triggers TierSchema.pre('validate') hook which auto calculates finalPrice
    const updatedTier = await tier.save();

    return res.status(200).json({
      success: true,
      message: 'Tier updated successfully.',
      data: updatedTier
    });
  } catch (error) {
    console.error(`Update Tier Error: ${error.message}`);
    next(error);
  }
};

// ==========================================
// 5. DELETE TIER BY ID (DELETE /api/admin/tiers/:id or /api/admin/tiers/delete/:id)
// ==========================================
const deleteTierById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Tier ID format.'
      });
    }

    const tier = await Tier.findByIdAndDelete(id);
    if (!tier) {
      return res.status(404).json({
        success: false,
        message: 'Tier not found.'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Tier deleted successfully.',
      data: tier
    });
  } catch (error) {
    console.error(`Delete Tier Error: ${error.message}`);
    next(error);
  }
};

module.exports = {
  addTier,
  getAllTiers,
  getTierById,
  updateTierById,
  editTier: updateTierById,
  deleteTierById,
  deleteTier: deleteTierById
};