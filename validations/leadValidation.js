const Joi = require('joi');

const sendLeadSchema = Joi.object({
  property: Joi.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  propertyId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  agent: Joi.string().regex(/^[0-9a-fA-F]{24}$/).optional().allow('', null),
  agentId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).optional().allow('', null),
  agentID: Joi.string().regex(/^[0-9a-fA-F]{24}$/).optional().allow('', null),
  agentEmail: Joi.string().email().allow('', null).optional(),
  description: Joi.string().allow('', null).optional().default(''),
  name: Joi.string().allow('', null).optional(),
  email: Joi.string().email().allow('', null).optional(),
  phone: Joi.string().allow('', null).optional(),
  chatId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).allow('', null).optional(),
})
  .or('property', 'propertyId')
  .custom((value, helpers) => {
    const hasChatId = value.chatId && String(value.chatId).trim() !== '';
    const hasDescription = value.description && String(value.description).trim() !== '';
    if (!hasChatId && !hasDescription) {
      return helpers.message('Either chatId or description is required');
    }
    return value;
  })
  .messages({
    'object.missing': 'Please provide property or propertyId',
  })
  .unknown(true);

const updateLeadStatusSchema = Joi.object({
  status: Joi.string()
    .valid('pending', 'approved', 'completed', 'rejected', 'closed')
    .required()
    .messages({
      'string.empty': 'Status cannot be empty',
      'any.only': 'Status must be one of: pending, approved, completed, rejected, closed',
      'any.required': 'Status is required',
    }),
  reason: Joi.string().trim().allow('', null).optional(),
  closedReason: Joi.string().trim().allow('', null).optional(),
  preferredLanguage: Joi.string().valid('en', 'es', 'english', 'spanish').optional(),
})
  .custom((value, helpers) => {
    if (value.status === 'closed') {
      const reasonVal = (value.reason || value.closedReason || '').trim();
      if (!reasonVal) {
        return helpers.message('Reason is required when status is closed');
      }
    }
    return value;
  })
  .unknown(true);

module.exports = {
  sendLeadSchema,
  updateLeadStatusSchema,
};

