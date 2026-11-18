const Amenity = require('../models/Amenity');
const mongoose = require('mongoose');
const { resolveLanguage, getLocalizedMessage } = require('../utils/languageHelper');

const getAllAmenities = async (req, res, next) => {
  try {
    const lang = resolveLanguage(req);

    // If "raw=true" is passed (useful for admin editing form), return full { en, es } object
    const isRaw = req.query.raw === 'true';

    const amenities = await Amenity.find({}).sort({ 'name.en': 1 });

    let formattedAmenities;
    if (isRaw) {
      formattedAmenities = amenities;
    } else {
      formattedAmenities = amenities.map(amenity => ({
        _id: amenity._id,
        id: amenity._id,
        name: amenity.name ? (amenity.name[lang] || amenity.name['en'] || '') : '',
        rawName: amenity.name,
        createdAt: amenity.createdAt,
        updatedAt: amenity.updatedAt,
      }));
    }

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('amenitiesRetrieved', lang),
      data: {
        language: lang === 'es' ? 'Spanish' : 'English',
        count: formattedAmenities.length,
        amenities: formattedAmenities,
      },
    });
  } catch (err) {
    console.error(`Get All Amenities Error: ${err.message}`);
    next(err);
  }
};

const addAmenity = async (req, res, next) => {
  try {
    let { name, enName, esName } = req.body;

    let nameObj = { en: '', es: '' };
    if (typeof name === 'object' && name !== null) {
      nameObj.en = name.en || '';
      nameObj.es = name.es || '';
    } else if (typeof name === 'string') {
      try {
        const parsed = JSON.parse(name);
        nameObj.en = parsed.en || name;
        nameObj.es = parsed.es || '';
      } catch {
        nameObj.en = name;
      }
    }

    if (enName) nameObj.en = enName;
    if (esName) nameObj.es = esName;

    if (!nameObj.en || nameObj.en.trim() === '') {
      const error = new Error('Amenity name in English is required');
      error.statusCode = 400;
      return next(error);
    }

    nameObj.en = nameObj.en.trim();
    nameObj.es = (nameObj.es || '').trim();

    // Check for duplicate amenity name in English
    const existing = await Amenity.findOne({ 'name.en': { $regex: `^${nameObj.en}$`, $options: 'i' } });
    if (existing) {
      const error = new Error(`Amenity "${nameObj.en}" already exists`);
      error.statusCode = 400;
      return next(error);
    }

    const amenity = await Amenity.create({ name: nameObj });

    res.status(201).json({
      success: true,
      message: 'Amenity added successfully',
      data: {
        amenity,
      },
    });
  } catch (err) {
    console.error(`Add Amenity Error: ${err.message}`);
    next(err);
  }
};

const deleteAmenity = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error('Invalid Amenity ID format');
      error.statusCode = 400;
      return next(error);
    }

    const amenity = await Amenity.findByIdAndDelete(id);
    if (!amenity) {
      const error = new Error('Amenity not found');
      error.statusCode = 404;
      return next(error);
    }

    res.status(200).json({
      success: true,
      message: 'Amenity deleted successfully',
      data: {
        id,
      },
    });
  } catch (err) {
    console.error(`Delete Amenity Error: ${err.message}`);
    next(err);
  }
};

module.exports = {
  getAllAmenities,
  addAmenity,
  deleteAmenity,
};