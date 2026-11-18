const Joi = require('joi');

const savedSearchSchema = Joi.object({
  message: Joi.string().trim().allow('', null),
  query: Joi.string().trim().allow('', null), // Alias for message
  langInput: Joi.string().trim().allow('', null).default('en'),
  listingType: Joi.string().valid('RENT', 'BUY').uppercase().allow(null, '').messages({
    'any.only': 'Listing type must be either RENT or BUY',
  }),
  location: Joi.string().trim().allow('', null),
  minPrice: Joi.number().min(0).allow(null).messages({
    'number.min': 'minPrice cannot be negative',
  }),
  maxPrice: Joi.number().min(0).allow(null).messages({
    'number.min': 'maxPrice cannot be negative',
  }),
  propertyType: Joi.string()
    .valid('APARTMENT', 'HOUSE', 'PLOT', 'COMMERCIAL')
    .uppercase()
    .allow(null, '')
    .messages({
      'any.only': 'Property type must be APARTMENT, HOUSE, PLOT, or COMMERCIAL',
    }),
  bedrooms: Joi.number().min(0).allow(null),
  bathrooms: Joi.number().min(0).allow(null),
  furnishedStatus: Joi.string()
    .valid('FULLY_FURNISHED', 'SEMI_FURNISHED', 'UNFURNISHED')
    .uppercase()
    .allow(null, '')
    .messages({
      'any.only': 'Furnished status must be FULLY_FURNISHED, SEMI_FURNISHED, or UNFURNISHED',
    }),
  amenities: Joi.array().items(Joi.string().allow('')).default([]),
  minSize: Joi.number().min(0).allow(null).messages({
    'number.min': 'minSize cannot be negative',
  }),
  maxSize: Joi.number().min(0).allow(null).messages({
    'number.min': 'maxSize cannot be negative',
  }),
});

module.exports = {
  savedSearchSchema,
};
