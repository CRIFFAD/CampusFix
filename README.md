# CampusFix (Supabase edition)

Campus maintenance reporting website. The website is plain HTML/CSS/JS (no server to run). Supabase provides the database, staff login and photo storage.

```
public/            the website  (deploy this folder)
  config.js        <- you paste your Supabase URL + public key here
supabase/schema.sql   <- you run this once in Supabase
```

## Setup (about 15 minutes)

### 1. Create the Supabase project
1. Sign in at https://supabase.com and click **New project**. Pick a region close to your students and save the database password somewhere safe.

### 2. Create the database
1. Open **SQL Editor > New query**.
2. Paste the entire contents of `supabase/schema.sql` and click **Run**. It creates the tables, security rules, the public view, the photo bucket and the helper functions. It is safe to run again.

### 3. Set up accounts
Students create their own accounts on the website (name, email, password) and must be signed in to report an issue. Anyone can still browse and search reports without an account.

1. Go to **Authentication > Sign In / Providers > Email** and make sure **Email** sign-in is on and **Allow new users to sign up** is **on**. Keep **Confirm email** on, so students must verify their address.
2. Go to **Authentication > URL Configuration**. Set **Site URL** to your live website address (for example `https://campusfix.yourschool.edu`) and add the same address, plus `http://localhost:8080` for local testing, under **Redirect URLs**. Confirmation and password-reset links will not work without this.
3. **Email sending (important for a live site):** Supabase's built-in email service is for testing only and allows just a few emails per hour. Before launch, add your own email provider under **Authentication > Emails > SMTP Settings** (for example Resend, Brevo or your school's mail server).
4. **Make your staff accounts staff.** Staff create an account on the website like everyone else (click **Sign in > Create account**) and confirm their email. Then run this in **SQL Editor**, once per staff member:
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'staff@yourschool.edu';
   ```
   They can then sign in at `/admin.html` with the same email and password. Students cannot reach any staff feature, because that access is checked in the database.

### 4. Connect the website
1. Go to **Project Settings > API**. Copy the **Project URL** and the **public key** (labelled `anon` or `publishable`).
2. Paste them into `public/config.js`.
   **Never** paste the `service_role` / secret key into the website.

### 5. Try it locally
```bash
cd public
python3 -m http.server 8080
```
Open http://localhost:8080, create an account, and submit a test report. Then make that account staff (step 3.4) and sign in at http://localhost:8080/admin.html.

### 6. Go live
Upload the project to any static host. The publish folder is `public`.
- **Netlify:** drag the folder onto https://app.netlify.com/drop, or connect a Git repo (`netlify.toml` is included).
- **Vercel:** import the repo (`vercel.json` is included).
- **Cloudflare Pages / GitHub Pages:** publish the `public` folder (`public/_headers` adds the security headers on Cloudflare/Netlify).

Then add your custom domain in the host's settings. HTTPS is automatic.

The staff page is at `your-domain/admin.html`.

## How it is secured
- Everyone can **read** reports through the `public_issues` view, which leaves out names and emails.
- Only **signed-in students** can **submit** (through the `submit_issue` function, which validates everything, records the student's name and email for staff, and limits each account and each IP to 8 reports per hour) or upload photos.
- Nobody has direct access to the tables. Only users listed in the `admins` table can read names/emails, change statuses, add notes or delete reports. This is enforced in the database, so it cannot be bypassed from the browser, even though anyone can create a student account.
- Students see a "Yours" tag and a **My reports** filter for their own reports. Other students never see who reported what.
- The public key in `config.js` is meant to be public. The security rules above are what protect your data.
- Photos: JPG/PNG/WebP only, 3 MB max, stored in a public bucket (anyone with a photo link can view it, which is how the site displays them).

## Recommended extras
- **Fake sign-ups:** email confirmation stops most abuse. If bots create accounts, turn on CAPTCHA protection under Authentication > Attack Protection.
- **Photo uploads without a report:** a signed-in user could upload photos without submitting a report. Size and type limits cap the damage; check **Storage** occasionally.
- **Backups:** on the free plan, export your data now and then (Table Editor > issues > Export). Paid plans include automatic backups.
- **Free plan limits:** free projects can pause after a period of inactivity and have storage/bandwidth caps. Check Supabase's current pricing page before launch and upgrade if the site will be busy.
- The site loads up to 1,000 reports at once. For far more than that, add paging in `public/js/common.js` (`.range()` in the Supabase queries).

## Changing things
- **Categories:** edit the `check (category in (...))` line in `schema.sql` (and the matching test inside `submit_issue`) and the `CATEGORIES` list in `public/js/common.js`.
- **Report limit per hour:** change `>= 8` in `submit_issue`.
- **Look and feel:** `public/css/style.css`.

## Opening animation
The home page plays a short hazard-tape intro (about 2.5 seconds) the first time someone opens it in a browser session. Visitors can tap to skip it, and it is skipped automatically for people who have "reduce motion" turned on. To remove it, delete the `<div class="intro" ...>` block and the `intro.js` script line in `public/index.html`.

## Mobile
The site is tested from 320px phones up to desktop: the report form and lists stack, the report dialog becomes a bottom sheet, and the staff table turns into cards on phones.

## Already ran an older schema.sql?
Run the new `supabase/schema.sql` again. It adds the account columns and replaces the old submit function. Existing reports are kept.
