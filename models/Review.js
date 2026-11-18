const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema(
  {
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    unclaimedAgentEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      default: null,
    },
    rating: {
      type: Number,
      required: [true, 'Rating is required (1 to 5)'],
      min: [1, 'Rating must be at least 1 star'],
      max: [5, 'Rating cannot exceed 5 stars'],
    },
    comment: {
      type: String,
      trim: true,
      default: '',
      maxlength: [1000, 'Comment cannot exceed 1000 characters'],
    },
    isVerifiedBuyer: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['approved', 'flagged', 'hidden'],
      default: 'approved',
    },
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate reviews by the same user for the same agent (sparse index so null values don't collide)
ReviewSchema.index({ agent: 1, user: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Review', ReviewSchema);
