const mongoose = require('mongoose');

const PropertySchema = new mongoose.Schema(
  {
    title: {
      en: {
        type: String,
        trim: true,
        default: '',
      },
      es: {
        type: String,
        trim: true,
        default: '',
      },
    },
    description: {
      en: {
        type: String,
        trim: true,
        default: '',
      },
      es: {
        type: String,
        trim: true,
        default: '',
      },
    },
    location: {
      address: {
        type: String,
        trim: true,
        default: '',
      },
      area: {
        type: String,
        trim: true,
        index: true,
        default: '',
      },
      city: {
        type: String,
        required: [true, 'Please specify the city'],
        trim: true,
        index: true,
        default: 'Santo Domingo',
      },
      state: {
        type: String,
        trim: true,
        default: '',
      },
      country: {
        type: String,
        default: 'Dominican Republic',
        trim: true,
      },
    },
    propertyType: {
      type: String,
      required: [true, 'Please specify the property type'],
      enum: {
        values: ['APARTMENT', 'HOUSE', 'LAND', 'OFFICE', 'COMMERCIAL'],
        message: 'Property type must be APARTMENT, HOUSE, LAND, OFFICE, or COMMERCIAL',
      },
      default: 'HOUSE',
    },
    listingType: {
      type: String,
      required: [true, 'Please specify listing type (RENT or BUY)'],
      enum: {
        values: ['RENT', 'BUY'],
        message: 'Listing type must be RENT or BUY',
      },
      default: 'BUY',
      index: true,
    },
    price: {
      dop: {
        type: Number,
        default: 0,
      },
      usd: {
        type: Number,
        default: 0,
      },
    },
    bedrooms: {
      type: Number,
      default: null,
    },
    bathrooms: {
      type: Number,
      default: null,
    },
    size: {
      type: Number,
      default: 0,
    },
    sizeUnit: {
      type: String,
      default: 'sq meters',
      enum: ['sq ft', 'sq yards', 'sq meters'],
    },
    maintenanceFee: {
      amount: {
        type: Number,
        default: 0,
      },
      currency: {
        type: String,
        default: 'DOP',
      },
    },
    images: {
      type: [String],
      default: [],
    },
    amenities: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Amenity',
      },
    ],
    source: {
      type: String,
      required: [true, 'Please specify the source of the property'],
      default: 'REMAX',
    },
    sourceUrl: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    agency: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Agency',
      default: null,
      index: true,
    },
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    agentDetails: {
      name: { type: String, default: '' },
      phone: { type: String, default: '' },
      email: { type: String, default: '' },
      profileImage: { type: String, default: null },
      office: { type: String, default: null },
      whatsapp: { type: String, default: null },
    },
    status: {
      type: String,
      enum: {
        values: ['Active', 'Inactive'],
        message: 'Status must be either Active or Inactive',
      },
      default: 'Active',
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for search and AI query optimization
PropertySchema.index({ status: 1, listingType: 1, propertyType: 1, 'location.city': 1 });
PropertySchema.index({ status: 1, listingType: 1, 'location.area': 1 });
PropertySchema.index({ status: 1, listingType: 1, 'price.usd': 1, propertyType: 1 });
PropertySchema.index({ status: 1, listingType: 1, 'price.dop': 1, propertyType: 1 });
PropertySchema.index({ status: 1, 'location.city': 1, bedrooms: 1, bathrooms: 1 });
PropertySchema.index({ status: 1, agency: 1, agent: 1 });
PropertySchema.index({ agent: 1, status: 1 });
PropertySchema.index({ status: 1, createdAt: -1 });
PropertySchema.index({ status: 1, propertyType: 1, createdAt: -1 });
PropertySchema.index({ status: 1, listingType: 1, createdAt: -1 });
PropertySchema.index({ status: 1, 'location.city': 1, createdAt: -1 });
PropertySchema.index({ status: 1, 'price.usd': 1, createdAt: -1 });
PropertySchema.index({ status: 1, bedrooms: 1, createdAt: -1 });

// Text Index for full-text search across locations and titles
PropertySchema.index(
  {
    'title.en': 'text',
    'title.es': 'text',
    'location.city': 'text',
    'location.area': 'text',
    'location.address': 'text',
  },
  {
    weights: {
      'location.area': 5,
      'location.city': 4,
      'title.es': 2,
      'title.en': 2,
      'location.address': 1,
    },
    name: 'PropertyTextIndex',
  }
);

module.exports = mongoose.model('Property', PropertySchema);