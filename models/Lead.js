const mongoose = require('mongoose');

const LeadSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Please specify the user who sent this lead'],
    },
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    agentEmail: {
      type: String,
      lowercase: true,
      trim: true,
      default: null,
      index: true,
    },
    isClaimed: {
      type: Boolean,
      default: false,
      index: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: [true, 'Please specify the property for this lead'],
    },

    description: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'completed', 'rejected', 'closed'],
      default: 'pending',
    },
    closedReason: {
      type: String,
      trim: true,
      default: null,
    },
    reason: {
      type: String,
      trim: true,
      default: null,
    },
    aiLeadSheet: {
      verifiedBudget: {
        amount: { type: Number, default: null },
        currency: { type: String, default: 'USD' },
        formatted: { type: String, default: 'Not specified' },
      },
      paymentMethod: {
        type: String,
        enum: ['CASH', 'MORTGAGE', 'PAYMENT_PLAN', 'NOT_SPECIFIED', 'UNDECIDED'],
        default: 'NOT_SPECIFIED',
      },
      timeline: {
        type: String,
        enum: ['IMMEDIATE', '1_TO_3_MONTHS', '3_TO_6_MONTHS', 'EXPLORING', 'NOT_SPECIFIED', 'UNDECIDED'],
        default: 'NOT_SPECIFIED',
      },
      areasOfInterest: [{ type: String, trim: true }],
      preferredPropertyType: { type: String, default: null },
      preferredBedrooms: { type: Number, default: null },
      leadQuality: {
        type: String,
        enum: ['HOT', 'WARM', 'COLD'],
        default: 'WARM',
      },
      chatSessionRef: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ChatSession',
        default: null,
      },
      extractedAt: { type: Date, default: Date.now },
    },
  },
  {
    timestamps: true,
    id: false,
    toJSON: { virtuals: false },
    toObject: { virtuals: false },
  }
);

LeadSchema.index({ agent: 1, status: 1 });
LeadSchema.index({ user: 1, createdAt: -1 });
LeadSchema.index({ property: 1 });

module.exports = mongoose.model('Lead', LeadSchema);