const swaggerJSDoc = require('swagger-jsdoc');

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'KleverProp Real Estate & AI Search API',
    version: '1.0.0',
    description: `### Production API Documentation for KleverProp in the Dominican Republic.
Features:
- **AI Natural Language Property Search**: Conversational multi-turn search supporting Spanish, English, Hindi, and Hinglish.
- **REMAX RD Real-Time Ingestion**: Automated live synchronization of 5,900+ verified properties with CloudFront CDN photos and direct agent WhatsApp links.
- **3-Tier Commercial Promotion System**: Prioritizes Official Founding Sponsors (Tier 3) and Premium Agencies (Tier 2).
- **Property & Agency Management**: Full CRUD, analytics, and inquiry logging.`,
    tags: [
      { name: 'AI Natural Language Search', description: 'Conversational property search powered by Gemini AI' },
      { name: 'Auth & Account', description: 'User & Agent authentication, registration, OTP password reset, and tokens' },
      { name: 'User Profile & Settings', description: 'Profile management, KYC resubmission, language, and currency preferences' },
      { name: 'Properties (Public)', description: 'Public property listing, advanced filtering, comparison, and detail view' },
      { name: 'Recently Viewed', description: 'User recently viewed properties history' },
      { name: 'Favorites', description: 'User favorite properties / wishlist' },
      { name: 'Saved Searches', description: 'Saved search queries and notifications' },
      { name: 'Agencies & Tiers (Public)', description: 'Public agency profiles, subscription tier options, and agents directory' },
      { name: 'Agent Reviews & Claims', description: 'Agent reviews, ratings, and profile claiming' },
      { name: 'Leads & Inquiries', description: 'Property lead submission and agent lead management' },
      { name: 'Notifications', description: 'User and agent in-app notification alerts' },
      { name: 'AI Chat & History', description: 'Multi-turn conversational chat sessions and AI search history' },
      { name: 'AI Realtor Copilot', description: 'Automated social media and marketing content generation for listings' },
      { name: 'Admin - Properties', description: 'Admin property management and CSV/Excel batch imports' },
      { name: 'Admin - REMAX Live Sync', description: 'REMAX RD live synchronization controls and status tracking' },
      { name: 'Admin - Amenities', description: 'Admin amenities management' },
      { name: 'Admin - Dashboard & Logs', description: 'Admin dashboard metrics, search analytics, and audit logs' },
      { name: 'Admin - User Management', description: 'Admin user accounts, status toggles, and user reports' },
      { name: 'Admin - Agent Management', description: 'Admin agent verification, approvals, and profile management' },
      { name: 'Admin - Agency Management', description: 'Real estate agency CRUD and tier assignments' },
      { name: 'Admin - Tier Plans', description: 'Commercial subscription tier configuration' },
      { name: 'Admin - Platform Settings', description: 'Global platform settings and contact configurations' },
      { name: 'Admin - Reports & Analytics', description: 'Comprehensive platform activity reports and analytics' },
    ],
    contact: {
      name: 'KleverProp Development Team',
      email: 'support@kleverprop.com',
    },
  },
  servers: [
    {
      url: 'http://localhost:5002',
      description: 'Local Development Server (Port 5002)',
    },
    {
      url: 'https://mobappssolutiondevelopment.com/kleverProp',
      description: 'Production / Staging Server',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT token in the format: Bearer <token>',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Error description message' },
        },
      },
      AISearchRequest: {
        type: 'object',
        required: ['query'],
        properties: {
          query: {
            type: 'string',
            example: 'Busco apartamento en alquiler en Bella Vista de 3 hab under 2500',
            description: 'Natural language search query in Spanish, English, Hindi, or Hinglish',
          },
          chatId: {
            type: 'string',
            example: '6ae856f7c2f47cdfef242620',
            description: 'Optional ChatSession ID to continue an ongoing conversation',
          },
        },
      },
      SyncRemaxRequest: {
        type: 'object',
        properties: {
          pages: {
            type: 'integer',
            example: 2,
            description: 'Number of pages to synchronize (default: 1)',
          },
          pageSize: {
            type: 'integer',
            example: 50,
            description: 'Listings per page (5-50, default: 50)',
          },
          syncAll: {
            type: 'boolean',
            example: false,
            description: 'If true, loops through all 119 pages to sync all 5,900+ properties in the background',
          },
          fetchDetails: {
            type: 'boolean',
            example: true,
            description: 'Whether to fetch full bedrooms, bathrooms, and CloudFront photos',
          },
        },
      },
      SyncStatusResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              isSyncing: { type: 'boolean', example: true },
              status: { type: 'string', example: 'IN_PROGRESS' },
              currentPage: { type: 'integer', example: 4 },
              totalPages: { type: 'integer', example: 10 },
              processed: { type: 'integer', example: 180 },
              totalEstimated: { type: 'integer', example: 500 },
              progressPercent: { type: 'string', example: '36%' },
              inserted: { type: 'integer', example: 140 },
              updated: { type: 'integer', example: 40 },
              errorsCount: { type: 'integer', example: 0 },
              elapsedSeconds: { type: 'integer', example: 28 },
              lastSyncedProperty: { type: 'string', example: 'APARTAMENTO EN NACO' },
            },
          },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', example: 'admin@kleverprop.com' },
          password: { type: 'string', example: 'AdminPassword123!' },
          preferredLanguage: { type: 'string', example: 'en' },
        },
      },
      RegisterUserRequest: {
        type: 'object',
        required: ['name', 'email', 'password', 'phone'],
        properties: {
          name: { type: 'string', example: 'John Doe' },
          email: { type: 'string', example: 'buyer@example.com' },
          password: { type: 'string', example: 'Secure@123' },
          phone: { type: 'string', example: '+18095551234' },
          role: { type: 'string', enum: ['buyer'], example: 'buyer' },
          language: { type: 'string', enum: ['english', 'spanish', 'en', 'es'], example: 'en' },
        },
      },
      RegisterAgentRequest: {
        type: 'object',
        required: ['name', 'email', 'password', 'phone', 'licenseNumber'],
        properties: {
          name: { type: 'string', example: 'Carlos Rodriguez' },
          email: { type: 'string', example: 'agent@kleverprop.com' },
          password: { type: 'string', example: 'Secure@123' },
          phone: { type: 'string', example: '+18095559876' },
          licenseNumber: { type: 'string', example: 'LIC-RD-2024-9988' },
          agency: { type: 'string', example: '66e1b6a1e345b6f728901234' },
          language: { type: 'string', enum: ['english', 'spanish', 'en', 'es'], example: 'es' },
        },
      },
      ChangePasswordRequest: {
        type: 'object',
        required: ['oldPassword', 'newPassword', 'confirmPassword'],
        properties: {
          oldPassword: { type: 'string', example: 'OldPassword123!' },
          newPassword: { type: 'string', example: 'NewPassword@2026' },
          confirmPassword: { type: 'string', example: 'NewPassword@2026' },
        },
      },
      ForgotPasswordSendOTPRequest: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', example: 'user@example.com' },
          language: { type: 'string', example: 'en' },
        },
      },
      ForgotPasswordVerifyOTPRequest: {
        type: 'object',
        required: ['email', 'otp'],
        properties: {
          email: { type: 'string', example: 'user@example.com' },
          otp: { type: 'string', example: '123456' },
        },
      },
      ForgotPasswordResetRequest: {
        type: 'object',
        required: ['email', 'newPassword', 'confirmPassword'],
        properties: {
          email: { type: 'string', example: 'user@example.com' },
          newPassword: { type: 'string', example: 'NewPassword@2026' },
          confirmPassword: { type: 'string', example: 'NewPassword@2026' },
          resetToken: { type: 'string', example: 'optional_reset_token' },
        },
      },
      RefreshTokenRequest: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
        },
      },
      SendLeadRequest: {
        type: 'object',
        required: ['propertyId'],
        properties: {
          propertyId: { type: 'string', example: '66e1b6a1e345b6f728901234' },
          agentId: { type: 'string', example: '66e1b6a1e345b6f728905678' },
          description: { type: 'string', example: 'I am interested in scheduling a viewing this Saturday.' },
          chatId: { type: 'string', example: '6ae856f7c2f47cdfef242620' },
          name: { type: 'string', example: 'John Doe' },
          email: { type: 'string', example: 'buyer@example.com' },
          phone: { type: 'string', example: '+18095551234' },
        },
      },
      UpdateLeadStatusRequest: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['pending', 'approved', 'completed', 'rejected', 'closed'], example: 'completed' },
          reason: { type: 'string', example: 'Client successfully signed rental contract' },
        },
      },
      CreateReviewRequest: {
        type: 'object',
        properties: {
          agentId: { type: 'string', example: '66e1b6a1e345b6f728905678' },
          propertyId: { type: 'string', example: '66e1b6a1e345b6f728901234' },
          rating: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
          comment: { type: 'string', example: 'Exceptional service, very responsive and helpful!' },
        },
      },
      SavedSearchRequest: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'Apartment in Piantini under 2000' },
          listingType: { type: 'string', enum: ['RENT', 'BUY'], example: 'RENT' },
          location: { type: 'string', example: 'Piantini, Santo Domingo' },
          minPrice: { type: 'number', example: 1000 },
          maxPrice: { type: 'number', example: 2500 },
          propertyType: { type: 'string', enum: ['APARTMENT', 'HOUSE', 'PLOT', 'COMMERCIAL'], example: 'APARTMENT' },
          bedrooms: { type: 'number', example: 3 },
          bathrooms: { type: 'number', example: 2 },
          furnishedStatus: { type: 'string', enum: ['FULLY_FURNISHED', 'SEMI_FURNISHED', 'UNFURNISHED'], example: 'FULLY_FURNISHED' },
        },
      },
      AgencyRequest: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', example: 'REMAX RD Metropolitan' },
          description: { type: 'string', example: 'Premier real estate agency in Santo Domingo' },
          website: { type: 'string', example: 'https://remaxrd.com' },
          tier: { type: 'string', example: '66e1b6a1e345b6f728904321' },
          isActive: { type: 'boolean', example: true },
          isVerified: { type: 'boolean', example: true },
        },
      },
      TierRequest: {
        type: 'object',
        required: ['name', 'tierLevel', 'price'],
        properties: {
          name: { type: 'string', example: 'Official Founding Sponsor (Tier 3)' },
          tierLevel: { type: 'integer', example: 3 },
          price: { type: 'number', example: 299 },
          currency: { type: 'string', example: 'USD' },
          durationDays: { type: 'integer', example: 30 },
          features: { type: 'array', items: { type: 'string' }, example: ['Top AI Recommendation Priority', 'Unlimited Agent Profiles', 'Featured Badge'] },
        },
      },
      GeneralSettingRequest: {
        type: 'object',
        properties: {
          siteName: { type: 'string', example: 'KleverProp' },
          supportEmail: { type: 'string', example: 'support@kleverprop.com' },
          supportPhone: { type: 'string', example: '+18095550000' },
          defaultCurrency: { type: 'string', example: 'USD' },
          defaultLanguage: { type: 'string', example: 'es' },
        },
      },
    },
  },
  security: [
    {
      BearerAuth: [],
    },
  ],
};

const options = {
  swaggerDefinition,
  apis: [
    './routes/*.js',
  ],
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = swaggerSpec;