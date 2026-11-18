const mongoose = require("mongoose");

const generalSettingSchema = new mongoose.Schema(
    {
        appName: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
        },

        defaultCurrency: {
            type: String,
            enum: ["USD", "DOP"],
            required: true,
            default: "USD",
        },

        supportEmail: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },

        supportNumber: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },

        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("GeneralSetting", generalSettingSchema);