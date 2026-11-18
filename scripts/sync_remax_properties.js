const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { syncRemaxProperties } = require('../services/remaxSyncService');

(async () => {
  try {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      console.error('ERROR: MONGO_URI is missing in .env file!');
      process.exit(1);
    }

    console.log('Connecting to MongoDB Atlas...');
    await mongoose.connect(mongoUri);
    console.log('Connected successfully to MongoDB.');

    // Parse command line arguments
    const args = process.argv.slice(2);
    let pages = 1;
    let pageSize = 20;
    let fetchDetails = true;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--pages' && args[i + 1]) {
        pages = parseInt(args[i + 1], 10) || 1;
        i++;
      } else if (args[i] === '--pageSize' && args[i + 1]) {
        pageSize = parseInt(args[i + 1], 10) || 20;
        i++;
      } else if (args[i] === '--noDetails') {
        fetchDetails = false;
      }
    }

    console.log(`Starting sync with parameters: pages=${pages}, pageSize=${pageSize}, fetchDetails=${fetchDetails}`);
    const startTime = Date.now();

    const results = await syncRemaxProperties({
      pages,
      pageSize,
      fetchDetails,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Sync completed in ${elapsed}s.`);
    console.log(`Results: ${results.inserted} inserted, ${results.updated} updated, ${results.errors.length} errors.`);

    if (results.properties && results.properties.length > 0) {
      console.log('\nSample synced properties:');
      console.log(JSON.stringify(results.properties.slice(0, 3), null, 2));
    }

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
    process.exit(0);
  } catch (err) {
    console.error('Fatal sync script error:', err);
    process.exit(1);
  }
})();
