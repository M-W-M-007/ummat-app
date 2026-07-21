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
  // Public Play Store app opens straight to the donate page — not the
  // staff-only "/" admin login. DonatePage links to /my for the donor
  // portal, so both donor-facing flows stay reachable without ever
  // surfacing the staff login screen to the public.
  server: {
    url: 'https://ummat-app-ummat1.vercel.app/donate',
    androidScheme: 'https',
  },
};

export default config;
