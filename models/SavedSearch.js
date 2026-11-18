const mongoose = require('mongoose');

const SavedSearchSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null, // Allows saving search for registered users as well as guest sessions
    },
    message: {
      type: String,
      trim: true,
      default: null, // Raw user prompt / natural query (e.g. "muje sector 59 noida me 2bhk flat chaiye 10,000 me")
    },
    langInput: {
      type: String,
      default: 'en',
      trim: true,
    },
    listingType: {
      type: String,
      enum: {
        values: ['RENT', 'BUY'],
        message: 'Listing type must be RENT or BUY',
      },
      trim: true,
    },
    location: {
      type: String,
      trim: true,
    },
    minPrice: {
      type: Number,
      min: [0, 'Minimum price cannot be negative'],
    },
    maxPrice: {
      type: Number,
      min: [0, 'Maximum price cannot be negative'],
    },
    propertyType: {
      type: String,
      enum: {
        values: ['APARTMENT', 'HOUSE', 'PLOT', 'COMMERCIAL'],
        message: 'Property type must be APARTMENT, HOUSE, PLOT, or COMMERCIAL',
      },
    },
    bedrooms: {
      type: Number,
      default: null,
      min: 0,
    },
    bathrooms: {
      type: Number,
      default: null,
      min: 0,
    },
    furnishedStatus: {
      type: String,
      enum: {
        values: ['FULLY_FURNISHED', 'SEMI_FURNISHED', 'UNFURNISHED'],
        message: 'Furnished status must be FULLY_FURNISHED, SEMI_FURNISHED, or UNFURNISHED',
      },
    },
    amenities: {
      type: [String],
      default: [],
    },
    minSize: {
      type: Number,
      min: [0, 'Minimum size cannot be negative'],
    },
    maxSize: {
      type: Number,
      min: [0, 'Maximum size cannot be negative'],
    },
  },
  {
    timestamps: true,
  }
);

// Index on user and createdAt for fast retrieval of search history
SavedSearchSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('SavedSearch', SavedSearchSchema);
