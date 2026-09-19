import { asyncHandler } from '../utils/asyncHandler.js';
import { getSettings } from '../models/Settings.js';

// What the Android app needs that a feature flag cannot express: who to credit,
// and which version is current.
//
// Public and unauthenticated, on the same footing as GET /auth/settings — the
// app reads it before anyone has signed in (and the credits screen is reachable
// from the signed-out overflow menu), and none of it is private. Deliberately
// narrow: it exposes these five values and nothing else from the settings
// document.

export const getAppInfo = asyncHandler(async (req, res) => {
  const settings = await getSettings();

  res.json({
    success: true,
    data: {
      // `!== false` matches every other flag: an unset value means ON for a
      // switch whose entry declares a default of true.
      contributorsEnabled: settings.contributorsEnabled !== false,
      contributors: Array.isArray(settings.contributors) ? settings.contributors : [],

      // An empty version means no release has been published, and no app is
      // ever told to update (see the app's UpdatePrompt).
      latestVersion: settings.appLatestVersion || '',
      updateMessage: settings.appUpdateMessage || '',
      updateUrl: settings.appUpdateUrl || '',
      updateRequired: settings.appUpdateRequired === true,
    },
  });
});

export default { getAppInfo };
