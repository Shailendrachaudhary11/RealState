const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { resolveLanguage, getLocalizedMessage } = require('../utils/languageHelper');

const protect = async (req, res, next) => {
  let token;
  const lang = resolveLanguage(req);

  // Check for token in Authorization header (Bearer token)
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // console.log(decoded)

      // Get user from the token (exclude password) and attach to request
      const user = await User.findById(decoded.id).select('-password');
      if (!user) {
        const error = new Error(getLocalizedMessage('userNotFound', lang));
        error.statusCode = 401;
        return next(error);
      }

      const userLang = resolveLanguage(req, user);

      // Check if user is active
      if (user.isActive === false) {
        const error = new Error(getLocalizedMessage('accountDeactivatedAuth', userLang));
        error.statusCode = 403;
        return next(error);
      }

      req.user = user;
      next();
    } catch (err) {
      console.error(`Auth middleware error: ${err.message}`);
      const error = new Error(getLocalizedMessage('tokenFailed', lang));
      error.statusCode = 401;
      return next(error);
    }
  }

  if (!token) {
    const error = new Error(getLocalizedMessage('noTokenProvided', lang));
    error.statusCode = 401;
    return next(error);
  }
};

const optionalAuth = async (req, res, next) => {
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];
      if (token && token !== 'null' && token !== 'undefined') {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password');
        if (user && user.isActive !== false) {
          req.user = user;
        }
      }
    } catch (err) {
      req.user = null;
    }
  }
  next();
};

const admin = (req, res, next) => {
  const lang = resolveLanguage(req, req.user);
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    const error = new Error(getLocalizedMessage('adminUnauthorized', lang));
    error.statusCode = 403;
    return next(error);
  }
};

const requireApprovedAgent = (req, res, next) => {
  const lang = resolveLanguage(req, req.user);
  if (req.user && req.user.role === 'agent') {
    if (req.user.status === 'pending') {
      const error = new Error(getLocalizedMessage('kycPendingApproval', lang));
      error.statusCode = 403;
      return next(error);
    }
    if (req.user.status === 'rejected') {
      const error = new Error(getLocalizedMessage('kycRejectedActionBlocked', lang));
      error.statusCode = 403;
      return next(error);
    }
    if (req.user.status !== 'approved') {
      const error = new Error(getLocalizedMessage('agentPendingApproval', lang));
      error.statusCode = 403;
      return next(error);
    }
  }
  next();
};

module.exports = { protect, admin, optionalAuth, requireApprovedAgent };