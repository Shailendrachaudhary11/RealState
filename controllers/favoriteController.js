const FavoriteProperty = require('../models/FavoriteProperty');
const Property = require('../models/Property');
const Tier = require('../models/Tier');
const mongoose = require('mongoose');
const { resolveLanguage, formatPropertyData, getLocalizedMessage } = require('../utils/languageHelper');

const toggleFavorite = async (req, res, next) => {
  try {
    const { propertyId } = req.body;
    const lang = resolveLanguage(req);

    // 1. Validate propertyId presence and formatting
    if (!propertyId) {
      const error = new Error(lang === 'es' ? 'Se requiere el ID de la propiedad' : 'Property ID is required');
      error.statusCode = 400;
      return next(error);
    }

    if (!mongoose.Types.ObjectId.isValid(propertyId)) {
      const error = new Error(lang === 'es' ? 'Formato de ID de propiedad no válido' : 'Invalid Property ID format');
      error.statusCode = 400;
      return next(error);
    }

    // 2. Ensure property exists and is Active
    const propertyExists = await Property.findOne({ _id: propertyId, status: 'Active' });
    if (!propertyExists) {
      const error = new Error(getLocalizedMessage('propertyNotFound', lang));
      error.statusCode = 404;
      return next(error);
    }

    const userId = req.user._id;

    // 3. Check if already favorited
    const existingFavorite = await FavoriteProperty.findOne({
      user: userId,
      property: propertyId,
    });

    if (existingFavorite) {
      // Toggle Off: Remove favorite
      await FavoriteProperty.deleteOne({ _id: existingFavorite._id });
      return res.status(200).json({
        success: true,
        message: getLocalizedMessage('favoriteRemoved', lang),
        data: {
          isFavorited: false
        }
      });
    } else {
      // Toggle On: Add favorite
      const newFavorite = new FavoriteProperty({
        user: userId,
        property: propertyId,
      });
      await newFavorite.save();
      return res.status(201).json({
        success: true,
        message: getLocalizedMessage('favoriteAdded', lang),
        data: {
          isFavorited: true
        }
      });
    }
  } catch (err) {
    console.error(`Toggle Favorite Error: ${err.message}`);
    next(err);
  }
};

const getFavorites = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const lang = resolveLanguage(req);
    const defaultTier1 = await Tier.findOne({ tierLevel: 1 });

    // Retrieve favorites, populate properties (only Active), agency with tier, agent, and amenities
    const favorites = await FavoriteProperty.find({ user: userId })
      .populate({
        path: 'property',
        match: { status: 'Active' },
        populate: [
          {
            path: 'agency',
            select: 'name logo website isFoundingSponsor tier agentSeatsLimit coveredAgentsCount',
            populate: { path: 'tier' }
          },
          { path: 'agent', select: 'name phone email profileImage' },
          { path: 'amenities', select: 'name' }
        ]
      });

    // Clean up response: Filter out any deleted or Inactive properties and extract property subdocuments directly
    const favoriteProperties = favorites
      .filter((fav) => fav.property !== null)
      .map((fav) => fav.property);

    // Format & translate favorite properties and enrich with tier
    const formattedProperties = favoriteProperties.map(doc => {
      const prop = formatPropertyData(doc, lang, true);
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
      message: getLocalizedMessage('favoritesRetrieved', lang),
      data: {
        language: lang === 'es' ? 'Spanish' : 'English',
        count: formattedProperties.length,
        favorites: formattedProperties,
      }
    });
  } catch (err) {
    console.error(`Get Favorites Error: ${err.message}`);
    next(err);
  }
};

module.exports = {
  toggleFavorite,
  getFavorites,
};
