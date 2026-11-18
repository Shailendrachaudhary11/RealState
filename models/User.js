const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a name'],
  },
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please add a valid email',
    ],
  },
  password: {
    type: String,
    required: [true, 'Please add a password'],
  },
  phone: {
    type: String,
    required: true,
    trim: true,
  },
  profileImage: {
    type: String,
    default: null,
  },
  role: {
    type: String,
    enum: {
      values: ['buyer', 'agent', 'admin'],
      message: 'Role must be buyer, agent, or admin',
    },
    default: 'buyer',
    required: true,
  },
  recentlyViewed: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property'
    }
  ],
  isActive: {
    type: Boolean,
    default: true
  },
  status: {
    type: String,
    enum: {
      values: ['pending', 'approved', 'rejected', 'suspended'],
      message: 'Status must be pending, approved, rejected, or suspended',
    },
    default: 'approved',
  },
  refreshToken: {
    type: String,
    default: null
  },
  lastFetchNotification: {
    type: Date,
    default: null
  },
  resetPasswordOTP: {
    type: String,
    default: null
  },
  resetPasswordOTPExpires: {
    type: Date,
    default: null
  },
  isResetOTPVerified: {
    type: Boolean,
    default: false
  },
  resetPasswordToken: {
    type: String,
    default: null
  },
  verificationToken: {
    type: String,
    default: null
  },
  verificationTokenExpires: {
    type: Date,
    default: null
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  aiSearchHistory: [
    {
      query: {
        type: String,
        required: true,
      },
      extractedFilters: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
      totalFound: {
        type: Number,
        default: 0,
      },
      properties: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Property',
        },
      ],
      searchedAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],

  // agent 
  agency: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Agency',
    default: null
  },

  // liceneseNumber: {
  //   type: String,
  //   trim: true
  // },

  licenseNumber: {
    type: String,
    trim: true
  },

  document: {
    type: String
  },

  preferredLanguage: {
    type: String,
    enum: ['english', 'spanish'],
    default: 'english'
  },

  preferredCurrency: {
    type: String,
    enum: ['Pesos', 'Dollar', "Euros"],
    default: 'Dollar'
  },

  // models/User.js me:
  isCoveredByAgency: {
    type: Boolean,
    default: false // Kya yeh agency ke free plan me cover hai ya nahi
  },

  tier:{
     type: mongoose.Schema.Types.ObjectId,
    ref: 'Tier',
    default: null
  },

  aiChatUsage: {
    count: {
      type: Number,
      default: 0
    },
    lastUsedDate: {
      type: String,
      default: null
    }
  }

},
  {
    timestamps: true,
  });

module.exports = mongoose.model('User', UserSchema);