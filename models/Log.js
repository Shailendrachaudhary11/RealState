const mongoose = require('mongoose');
const os = require('os');

// Helper to get machine's real LAN IPv4 (e.g. 192.168.1.38) when request is from localhost
const getMachineLanIp = () => {
    try {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
    } catch (e) {}
    return '127.0.0.1';
};

const logSchema = new mongoose.Schema(
    {
        // Kis user/admin ne action perform kiya
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'User ID is required'],
            index: true,
        },

        // Kis feature/section par action hua (e.g., 'Property', 'Agent', 'Lead', 'User', 'Settings')
        module: {
            type: String,
            required: [true, 'Module name is required'],
            trim: true,
            index: true,
        },

        // Action ka type (Sirf create, edit, delete allowed)
        action: {
            type: String,
            enum: {
                values: ['create', 'edit', 'delete'],
                message: 'Action must be create, edit, or delete',
            },
            required: [true, 'Action is required'],
            lowercase: true,
            index: true,
        },

        // Kis API URL / endpoint par request aayi (e.g., '/api/properties/65fa...', '/api/admin/agents/status')
        endpoint: {
            type: String,
            required: [true, 'Endpoint is required'],
            trim: true,
        },

        // Request ka outcome (Success ya Failed)
        statusCode: {
            type: Number,
            required: [true, 'Status code is required']
        },

        // (Optional): Kis IP address se request aayi (Auto-clean IPv6 prefix & resolve loopback)
        ipAddress: {
            type: String,
            default: null,
            trim: true,
            set: (ip) => {
                if (!ip || typeof ip !== 'string') return ip;
                let clean = ip.trim();
                if (clean.includes(',')) {
                    clean = clean.split(',')[0].trim();
                }
                clean = clean.replace('::ffff:', '');
                if (clean === '::1' || clean === '127.0.0.1') {
                    clean = getMachineLanIp();
                }
                return clean;
            },
        },
    },
    {
        timestamps: true, // Automatically `createdAt` aur `updatedAt` add kar dega
    }
);

// Dashboard me fast filtering aur sorting ke liye Compound Index
logSchema.index({ createdAt: -1, module: 1, action: 1 });

module.exports = mongoose.model('Log', logSchema);