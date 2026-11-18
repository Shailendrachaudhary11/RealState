const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'model', 'assistant'],
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  extractedFilters: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  properties: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
    },
  ],
  recommendations: [
    {
      propertyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
      },
      whyThisProperty: {
        type: String,
        default: null,
      },
      recommendationRank: {
        type: Number,
        default: null,
      },
      isTopRecommendation: {
        type: Boolean,
        default: true,
      },
    },
  ],
  totalFound: {
    type: Number,
    default: 0,
  },
  isExactMatch: {
    type: Boolean,
    default: true,
  },
  isFallback: {
    type: Boolean,
    default: false,
  },
  fallbackType: {
    type: String,
    default: null,
  },
  fallbackLocation: {
    type: String,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const chatSessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      trim: true,
      default: 'New Property Search',
    },
    currentFilters: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    messages: [chatMessageSchema],
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for sorting user's chats by latest activity
chatSessionSchema.index({ user: 1, lastMessageAt: -1 });

module.exports = mongoose.model('ChatSession', chatSessionSchema);
