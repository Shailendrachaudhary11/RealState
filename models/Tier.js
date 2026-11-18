const mongoose = require('mongoose');

const TierSchema = new mongoose.Schema(
    {
        // ================= 1. BASIC IDENTITY =================
        tierLevel: {
            type: Number,
            required: [true, 'Tier level is required (1, 2, or 3)'],
            unique: true,
            enum: [1, 2, 3], // 1 = Basic, 2 = Pro, 3 = Founding Sponsor
            index: true
        },
        name: {
            type: String,
            required: [true, 'Please provide tier name'],
            trim: true // "Tier 1 — Basic", "Tier 2 — Pro", "Tier 3 — Founding Sponsor"
        },
        description: {
            type: String,
            default: ''
        },

        price: {
            type: Number,
            required: [true, 'Price is required'],
            min: [0, 'Price cannot be negative'],
            default: 0
        },

        // Ye field manually set nahi hogi, pre-save hook me auto calculate hogi
        finalPrice: {
            type: Number,
            default: 0
        },

        discountPercentage: {
            type: Number,
            min: [0, 'Discount cannot be negative'],
            max: [100, 'Discount cannot be greater than 100%'],
            default: 0
        },

        currency: {
            type: String,
            default: 'USD',
            uppercase: true,
            trim: true
        },

        // ================= 2. AI ENGINE & SEARCH RANKING RULES =================
        searchAndAI: {
            // 3 = Top 1 to 3 anchor spots | 2 = Immediately below | 1 = Bottom organic filler
            searchPriorityWeight: {
                type: Number,
                required: true,
                enum: [1, 2, 3],
                default: 1
            },
        },

        // ================= 3. VISUAL IDENTITY & UI RULES (FLUTTER APP) =================
        uiAppearance: {
            badgeType: {
                type: String,
                enum: ['NONE', 'BLUE_CHECKMARK', 'GOLDEN_STAR'],
                default: 'NONE'
            },

            // Screen load par shimmer effect (Sirf Tier 3 ke liye)
            enableShimmerAnimation: {
                type: Boolean,
                default: false
            },
            // Card layout me unique border ya drop shadow (BoxShadow)
            hasCardHighlight: {
                type: Boolean,
                default: false
            },
        },

        // ================= 4. CONVERSION & LEAD FLOW LOGIC =================
        conversionAndLeads: {
            external_webview: {
                type: Boolean,
                default: false
            },
            whatapps_button: {
                type: Boolean,
                default: false
            },
            // App ke andar direct native lead notification
            enableNativeLeadNotifications: {
                type: Boolean,
                default: false
            }
        },

        isActive: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true
    }
);

// ================= AUTO CALCULATE FINAL PRICE =================
TierSchema.pre('validate', function () {
    const price = this.price || 0;
    const discount = this.discountPercentage || 0;

    this.finalPrice = Number(
        (price - (price * discount) / 100).toFixed(2)
    );
});

module.exports = mongoose.model('Tier', TierSchema);