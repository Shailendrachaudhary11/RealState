const mongoose = require('mongoose');

const AmenitySchema = new mongoose.Schema(
  {
    name: {
      en: {
        type: String,
        required: [true, 'Please add the amenity name in English'],
        trim: true,
        unique: true,
      },
      es: {
        type: String,
        trim: true,
      },
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Amenity', AmenitySchema);