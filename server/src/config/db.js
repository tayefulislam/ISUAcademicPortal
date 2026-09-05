import mongoose from 'mongoose';
import { setServers } from 'node:dns';
import { env } from './env.js';

// mongodb+srv:// URIs (Atlas) require a DNS SRV lookup before the driver can
// even open a connection. Some ISPs/routers/VPNs don't forward SRV queries
// properly, which surfaces as "querySrv ECONNREFUSED" even though normal
// internet access works fine. Pointing Node's resolver at public DNS servers
// that do support SRV records fixes it without touching OS-level DNS
// settings or changing the connection string format.
if (env.mongodbUri.startsWith('mongodb+srv://')) {
  setServers(['1.1.1.1', '8.8.8.8']);
}

export async function connectDB() {
  mongoose.set('strictQuery', true);
  try {
    await mongoose.connect(env.mongodbUri);
    console.log(`[db] connected: ${mongoose.connection.name}`);
  } catch (err) {
    console.error('[db] connection error:', err.message);
    if (err.message?.includes('querySrv')) {
      console.error(
        '[db] Hint: this is a DNS issue, not a code/credentials issue. ' +
          'If it persists, either (a) set your system DNS to 1.1.1.1 / 8.8.8.8, or ' +
          '(b) in Atlas > Connect > Drivers, switch the driver version to get a ' +
          'non-SRV "mongodb://host1,host2,host3/..." connection string and use that instead.'
      );
    }
    process.exit(1);
  }
}
