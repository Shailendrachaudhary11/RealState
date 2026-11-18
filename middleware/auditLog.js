const Log = require('../models/Log');
const os = require('os');

// Helper to get machine's real LAN IPv4 (e.g. 192.168.1.38) when request is from localhost
const getMachineLanIp = () => {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch (e) {}
  return '127.0.0.1';
};

// Helper to extract clean IPv4/IPv6 address without ::ffff: and resolve localhost to real LAN IP
const getClientIp = (req) => {
  let ip =
    req.headers['x-forwarded-for'] ||
    req.headers['x-real-ip'] ||
    req.ip ||
    (req.socket && req.socket.remoteAddress) ||
    null;

  if (typeof ip === 'string') {
    if (ip.includes(',')) {
      ip = ip.split(',')[0].trim();
    }
    ip = ip.replace('::ffff:', '');
    if (ip === '::1' || ip === '127.0.0.1') {
      ip = getMachineLanIp();
    }
  }
  return ip;
};

const auditLog = (moduleName, actionType) => {
  return (req, res, next) => {
    let capturedUserId = null;

    // Intercept res.send to capture newly generated userId from response body (for registerUser, registerAgent)
    const originalSend = res.send;
    res.send = function (body) {
      try {
        const parsed = typeof body === 'string' ? JSON.parse(body) : body;
        if (parsed && parsed.data) {
          capturedUserId =
            parsed.data.id ||
            parsed.data._id ||
            (parsed.data.user && (parsed.data.user.id || parsed.data.user._id)) ||
            null;
        }
      } catch (e) {}
      return originalSend.apply(this, arguments);
    };

    res.on('finish', async () => {
      // Only log successful responses (HTTP 2xx)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const userId = req.user
          ? req.user._id
          : (res.locals && res.locals.userId ? res.locals.userId : capturedUserId);

        if (userId) {
          try {
            await Log.create({
              userId,
              module: moduleName,
              action: actionType,
              endpoint: req.originalUrl || req.baseUrl + req.path,
              statusCode: res.statusCode,
              ipAddress: getClientIp(req),
            });
          } catch (err) {
            console.warn(`Audit log creation failed for ${moduleName} [${actionType}]: ${err.message}`);
          }
        }
      }
    });

    next();
  };
};

module.exports = auditLog;