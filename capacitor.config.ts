import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.ummatfoundation.app',
  appName: 'Ummat Foundation',
  webDir: 'dist',
  // Load the live deployed site instead of bundling static assets: content
  // updates ship instantly via Vercel with no app-store re-review, and the
  // webview's origin matches the domain already approved in Razorpay's
  // live-mode website whitelist (a bundled capacitor://localhost origin
  // would otherwise trip the same "website does not match registered
  // website(s)" block hit on the web donate page).
  server: {
    url: 'https://ummat-app-ummat1.vercel.app',
    androidScheme: 'https',
  },
};

export default config;
