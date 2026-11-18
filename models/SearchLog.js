const mongoose = require('mongoose');

const searchLogSchema = new mongoose.Schema({
    query: { type: String, trim: true }, // e.g. "2bhk in Noida"
    location: { type: String, trim: true, lowercase: true }, // e.g. "noida"
    filters: {
        bedrooms: { type: Number, default: null }, // 1, 2, 3
        minPrice: { type: Number, default: null },
        maxPrice: { type: Number, default: null },
        propertyType: { type: String, default: null }, // APARTMENT, HOUSE, etc.
        subType: { type: String, default: null }, // PENTHOUSE, VILLA, STUDIO, etc.
        minSize: { type: Number, default: null },
        maxSize: { type: Number, default: null },
    },
    resultsCount: { type: Number, default: 0 }, // Kitne results mile (0 ya >0)
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    searchType: { type: String, enum: ['manual', 'ai'], default: 'manual' }, // 'manual' for filter search, 'ai' for chat search
    createdAt: { type: Date, default: Date.now },
});

// Fast querying ke liye compound index
searchLogSchema.index({ location: 1, createdAt: -1, resultsCount: 1 });

// TTL Index: 30 din baad documents automatically delete ho jayenge (30 days = 2592000 seconds)
// searchLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('SearchLog', searchLogSchema);
