# GitHub Pages deployment folder

Upload the contents of this directory to a **separate website/Pages repository or deployment target**. Do not put the private `supabase/` directory or any secrets in this folder.

1. Configure `js/config.js` with the Supabase project URL and public publishable key only.
2. Confirm the Content-Security-Policy meta tag allows the configured Supabase HTTPS host. The current policy allows `https://*.supabase.co` and the GitHub Releases API.
3. Deploy the matching Supabase migrations and Edge Functions from the private deployment package first.
4. Publish the contents of this directory and test the exact live origin.
5. The main Mulvakun application repository can remain binary-only; avoid placing this folder in the binary application's public repo unless you accept that Pages source is visible there.

The page works as a static page without Supabase configured: download links remain real release URLs, no fake counters are shown, and analytics remains unavailable until configured and explicitly accepted.
