const Joi = require('joi');

const createReviewSchema = Joi.object({
  rating: Joi.number().integer().min(1).max(5).optional().default(5).messages({
    'number.base': 'Rating must be a number',
    'number.min': 'Rating must be at least 1 star',
    'number.max': 'Rating cannot exceed 5 stars',
  }),
  comment: Joi.string().trim().max(1000).allow('', null).optional().messages({
    'string.max': 'Comment cannot exceed 1000 characters',
  }),
  propertyId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).allow('', null).optional(),
  property: Joi.string().regex(/^[0-9a-fA-F]{24}$/).allow('', null).optional(),
  agentId: Joi.string().allow('', null).optional(),
  agent: Joi.string().allow('', null).optional(),
  email: Joi.string().email().allow('', null).optional(),
  name: Joi.string().allow('', null).optional(),
  phone: Joi.string().allow('', null).optional(),
  description: Joi.string().allow('', null).optional(),
}).unknown(true);

module.exports = {
  createReviewSchema,
};
