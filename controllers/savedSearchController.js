const SavedSearch = require('../models/SavedSearch');
const mongoose = require('mongoose');
const { resolveLanguage, getLocalizedMessage } = require('../utils/languageHelper');

const addSavedSearch = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const lang = resolveLanguage(req);
    const {
      message,
      query,
      langInput,
      listingType,
      location,
      minPrice,
      maxPrice,
      propertyType,
      bedrooms,
      bathrooms,
      furnishedStatus,
      amenities,
      minSize,
      maxSize,
    } = req.body;

    const payload = {
      user: userId,
      message: message || query || undefined,
      langInput: langInput || lang,
      listingType: listingType || undefined,
      location: location !== undefined ? location : undefined,
      minPrice: minPrice !== undefined ? minPrice : undefined,
      maxPrice: maxPrice !== undefined ? maxPrice : undefined,
      propertyType: propertyType || undefined,
      bedrooms: bedrooms !== undefined ? bedrooms : undefined,
      bathrooms: bathrooms !== undefined ? bathrooms : undefined,
      furnishedStatus: furnishedStatus || undefined,
      amenities: Array.isArray(amenities) ? amenities.filter(a => a && a.trim() !== '') : [],
      minSize: minSize !== undefined ? minSize : undefined,
      maxSize: maxSize !== undefined ? maxSize : undefined,
    };

    // Always create a new saved search record
    const newSavedSearch = await SavedSearch.create(payload);

    return res.status(201).json({
      success: true,
      message: getLocalizedMessage('savedSearchAdded', lang),
      data: newSavedSearch,
    });
  } catch (err) {
    console.error(`Add Saved Search Error: ${err.message}`);
    next(err);
  }
};

const getSavedSearches = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const lang = resolveLanguage(req);

    // Fetch all saved searches for the user, latest first
    const savedSearches = await SavedSearch.find({ user: userId }).sort({ createdAt: -1 }).select("message");

    return res.status(200).json({
      success: true,
      message: getLocalizedMessage('savedSearchesRetrieved', lang),
      count: savedSearches.length,
      data: savedSearches,
    });
  } catch (err) {
    console.error(`Get Saved Searches Error: ${err.message}`);
    next(err);
  }
};

const deleteSavedSearch = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const lang = resolveLanguage(req);

    // 1. Validate ID format 
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error(lang === 'es' ? 'Formato de ID de búsqueda guardada no válido' : 'Invalid saved search ID format');
      error.statusCode = 400;
      return next(error);
    }

    // 2. Find and delete only if it belongs to the authenticated user
    const deletedSearch = await SavedSearch.findOneAndDelete({
      _id: id,
      user: userId,
    });

    if (!deletedSearch) {
      const error = new Error(lang === 'es' ? 'Búsqueda guardada no encontrada o no autorizada' : 'Saved search not found or unauthorized');
      error.statusCode = 404;
      return next(error);
    }

    return res.status(200).json({
      success: true,
      message: getLocalizedMessage('savedSearchDeleted', lang),
      data: {
        id: deletedSearch._id,
      },
    });
  } catch (err) {
    console.error(`Delete Saved Search Error: ${err.message}`);
    next(err);
  }
};

module.exports = {
  addSavedSearch,
  getSavedSearches,
  deleteSavedSearch,
};
