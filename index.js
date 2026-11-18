const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

// Connect to Database
connectDB();

// Connect to Redis (Non-blocking caching layer)
const { getRedisClient } = require('./config/redis');
getRedisClient();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Swagger API Documentation (OpenAPI 3.0 UI & JSON Spec)
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'KleverProp API Documentation',
}));

app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// User Routes (supports both direct and /kleverProp proxy path prefixes)
app.use('/api/users', require('./routes/userRoutes'));

// Search Routes
app.use('/api/search', require('./routes/searchRoutes'));

// Property Routes
app.use('/api/admin', require('./routes/propertyRoutes'));

// Admin User Routes
app.use('/api/admin', require('./routes/adminUserRoutes'));

// Admin Dashboard Routes

// Report Section Routes
app.use('/api/admin/reports', require('./routes/reportRoutes'));

// Lead Routes
app.use('/api/leads', require('./routes/leadRoutes'));

const { resolveLanguage, getLocalizedMessage } = require('./utils/languageHelper');

app.use((error, req, res, next) => {
  const statusCode = error.statusCode || 500;
  const lang = resolveLanguage(req, req.user);
  const rawMessage = error.message || 'Internal Server Error';
  const localizedMessage = getLocalizedMessage(rawMessage, lang);

  res.status(statusCode).json({
    success: false,
    message: localizedMessage || rawMessage,
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 