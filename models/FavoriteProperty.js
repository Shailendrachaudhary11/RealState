const mongoose = require('mongoose');

const FavoritePropertySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: [true, 'Property reference is required'],
    },
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate favorites by creating a compound unique index
FavoritePropertySchema.index({ user: 1, property: 1 }, { unique: true });

module.exports = mongoose.model('FavoriteProperty', FavoritePropertySchema);
