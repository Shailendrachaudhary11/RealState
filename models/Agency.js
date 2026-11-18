const mongoose = require('mongoose');

const AgencySchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true
        },
        logo: {
            type: String
        },
        description: {
            type: String,
            default: null
        },
        isActive: {
            type: Boolean,
            default: true
        },
        isVerified: {
            type: Boolean,
            default: true
        },
        isFoundingSponsor: {
            type: Boolean,
            default: false
        },
        website: {
            type: String,
            default: null
        },

        // models/Agency.js me yeh field add karein:

        tier: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Tier',
            default: null,
            index: true
        },

        // models/Agency.js me: 
        agentSeatsLimit: {
            type: Number,
            default: 0 // Agency ne kitne agents ka plan khareeda hai (e.g., 5 ya 10)
        },
        coveredAgentsCount: {
            type: Number,
            default: 0 // Abhi tak kitne agents jud chuke hain
        },

        // ================= 3. FOUNDING SPONSOR BRANDING & FIREWALL =================
        brandColorHex: {
            type: String,
            default: '#002B49' // Dynamic HEX code for official sponsor badges/banners
        },
        corporateCallCenterPhone: {
            type: String,
            default: null // Official call center phone for brand lead rerouting
        },
        corporateWhatsapp: {
            type: String,
            default: null // Official corporate WhatsApp for brand lead rerouting
        },
        masterPortalUrl: {
            type: String,
            default: null // Master portal URL fallback
        },
        corporateEmail: {
            type: String,
            default: null // Corporate lead desk email
        }

    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model('Agency', AgencySchema);