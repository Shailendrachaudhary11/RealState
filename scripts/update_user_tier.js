require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');
const Tier = require('../models/Tier');
const Agency = require('../models/Agency');

async function updateUserTier() {
  try {
    await connectDB();
    const userId = '6acf190fa70ee353099075d7';
    const tier1 = await Tier.findOne({ tierLevel: 1 });
    if (!tier1) {
      throw new Error('Tier 1 document not found in database');
    }

    console.log(`Found Tier 1: ID=${tier1._id}, Name="${tier1.name}"`);

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: { tier: tier1._id, isCoveredByAgency: false } },
      { new: true }
    ).populate('tier').populate('agency');

    if (!updatedUser) {
      throw new Error(`User with ID ${userId} not found`);
    }

    console.log('--- USER UPDATED SUCCESSFULLY ---');
    console.log('ID:', updatedUser._id);
    console.log('Name:', updatedUser.name);
    console.log('Email:', updatedUser.email);
    console.log('isCoveredByAgency:', updatedUser.isCoveredByAgency);
    console.log('Tier:', {
      _id: updatedUser.tier?._id,
      tierLevel: updatedUser.tier?.tierLevel,
      name: updatedUser.tier?.name,
      description: updatedUser.tier?.description,
      uiAppearance: updatedUser.tier?.uiAppearance,
    });

    process.exit(0);
  } catch (err) {
    console.error('Update failed:', err);
    process.exit(1);
  }
}

updateUserTier();
