const fs = require('fs');
const { resolveLanguage, translateJoiError, getLocalizedMessage } = require('../utils/languageHelper');

// Helper to delete any files uploaded by multer if validation fails
const deleteUploadedFiles = (req) => {
  if (req.file && req.file.path) {
    try {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (err) {
      console.error(`Failed to delete uploaded file on validation error: ${err.message}`);
    }
  }

  if (req.files) {
    const filesList = Array.isArray(req.files)
      ? req.files
      : Object.values(req.files).flat();

    filesList.forEach((file) => {
      try {
        if (file && file.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } catch (err) {
        console.error(`Failed to delete uploaded file on validation error: ${err.message}`);
      }
    });
  }
};

// Middleware to validate request body using a Joi schema
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false, // Return all errors, not just the first one
      stripUnknown: true, // Remove unknown fields from req.body
    });

    if (error) {
      // Clean up any uploaded files on validation error to prevent storage leaks
      deleteUploadedFiles(req);

      const lang = resolveLanguage(req, req.user);
      const errorMessages = error.details.map((detail) => translateJoiError(detail, lang));

      return res.status(400).json({
        success: false,
        message: getLocalizedMessage('validationFailed', lang),
        errors: errorMessages,
      });
    }

    // Override req.body with validated and sanitized values (strips unknown fields)
    req.body = value;
    next();
  };
};

module.exports = validate;