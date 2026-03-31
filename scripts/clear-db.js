require('dotenv').config();
const mongoose = require('mongoose');

async function clearDatabase() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error('MONGODB_URI environment variable is not set');
      process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('Connected successfully');

    const collections = await mongoose.connection.db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);

    console.log('\nAvailable collections:');
    collectionNames.forEach(name => console.log(`  - ${name}`));

    if (collectionNames.includes('orders')) {
      const result = await mongoose.connection.collection('orders').deleteMany({});
      console.log(`\nDeleted ${result.deletedCount} orders from 'orders' collection`);
    } else {
      console.log('\nNo "orders" collection found');
    }

    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
    console.log('Database cleared successfully');
  } catch (error) {
    console.error('Error clearing database:', error);
    process.exit(1);
  }
}

clearDatabase();
