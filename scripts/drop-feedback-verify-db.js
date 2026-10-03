// Drop the throwaway verification database created during the feedback build.
//
// Targets grab_feedback_verify ONLY, and refuses to run unless the URI names
// that exact database — so a mis-set MONGODB_URI cannot wipe production.
//
// Drops collections individually rather than via dropDatabase(): against Atlas
// the driver's dropDatabase(dbName) call misparses its argument as a write
// concern and fails with "No write concern mode named '<dbname>' found". The
// same failure is known to leave collections half-dropped, so this lists what
// is actually there, drops each collection, and re-verifies afterwards.
require('dotenv').config();
const mongoose = require('mongoose');

const TARGET_DB = 'grab_feedback_verify';

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  // Hard guard: only ever drop the scratch db.
  const named = uri.match(/mongodb\+srv:\/\/[^/]+\/([^?]+)/);
  const dbName = named ? named[1] : '';
  if (dbName !== TARGET_DB) {
    throw new Error(
      `Refusing to drop: MONGODB_URI points at "${dbName || '<default>'}", not "${TARGET_DB}". ` +
      `This script only drops the scratch verification database.`
    );
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();

  if (collections.length === 0) {
    console.log(`${TARGET_DB} has no collections — nothing to drop.`);
  } else {
    console.log(`Dropping ${collections.length} collection(s) in ${TARGET_DB}:`);
    for (const c of collections) {
      const count = await db.collection(c.name).countDocuments({});
      console.log(`  ${c.name}: ${count} documents`);
      await db.collection(c.name).drop();
      console.log(`  dropped ${c.name}`);
    }
  }

  // Re-verify: the database must now be empty of collections.
  const after = await db.listCollections().toArray();
  console.log(`\n${TARGET_DB} collections remaining: ${after.length}`);
  if (after.length !== 0) {
    throw new Error(`Drop incomplete — still present: ${after.map(c => c.name).join(', ')}`);
  }

  const dbs = await db.admin().listDatabases();
  console.log('Databases on this cluster now:');
  dbs.databases.forEach(d => console.log(`  ${d.name} (${d.sizeOnDisk} bytes)`));

  await mongoose.disconnect();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
