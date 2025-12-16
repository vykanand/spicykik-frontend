# JSONBin.io Integration Guide

This guide explains how to use JSONBin.io as persistent storage for your app, solving read-only filesystem issues on Vercel and other serverless platforms.

## 🎯 Problem Solved

When deployed to Vercel or similar serverless platforms:

- The filesystem is **read-only** at runtime
- You get errors like: `"could not persist config (read-only FS?)"`
- Config changes, site data, and mappings cannot be saved

**Solution:** Use JSONBin.io as external persistent storage for all JSON data.

## 📋 Prerequisites

1. **JSONBin.io Account** (free tier available)
   - Sign up at: https://jsonbin.io
   - Get your API keys from: https://jsonbin.io/api-keys

2. **Your API Keys:**
   - `X-Master-Key`: `$2a$10$Fc5T8KVSWawgZnQ6dclo7O8RXtsBEt.k2v57q0eNdYeqIskqdFDt2`
   - `X-Access-Key`: `$2a$10$nX1Het5hM.pkIx8SiLvAc.f/KDMN.zNleV7cCnC7yUZjRxyqc2Ryq`

## 🚀 Quick Setup

### Step 1: Test JSONBin API

1. Open `jsonbin.html` in your browser:

   ```
   http://localhost:3000/jsonbin
   ```

2. Run the **"Full CRUD Workflow"** test to verify your API keys work

3. Create three bins for your app:
   - **Config Bin**: Stores `app-config.json` data
   - **Database Bin**: Stores `api-repo.json` data (sites/APIs)
   - **Mappings Bin**: Stores `mappings.json` data

4. **Save the Bin IDs** returned by JSONBin (you'll need these in Step 2)

### Step 2: Configure Environment Variables

#### For Local Development

1. Copy `.env.example` to `.env`:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Edit `.env` and add your bin IDs:

   ```env
   JSONBIN_MASTER_KEY=$2a$10$Fc5T8KVSWawgZnQ6dclo7O8RXtsBEt.k2v57q0eNdYeqIskqdFDt2
   JSONBIN_ACCESS_KEY=$2a$10$nX1Het5hM.pkIx8SiLvAc.f/KDMN.zNleV7cCnC7yUZjRxyqc2Ryq

   # Replace these with your actual bin IDs from Step 1
   JSONBIN_CONFIG_BIN_ID=67495e9ead19ca34f8d90aab
   JSONBIN_DB_BIN_ID=67495f2aad19ca34f8d90abc
   JSONBIN_MAPPINGS_BIN_ID=67495f5cad19ca34f8d90def
   ```

3. Restart your server:

   ```powershell
   node server.js
   ```

4. You should see:
   ```
   ✓ JSONBin.io client initialized (remote storage enabled)
   ```

#### For Vercel Deployment

1. Go to your Vercel project → Settings → Environment Variables

2. Add these variables:

   ```
   JSONBIN_MASTER_KEY = $2a$10$Fc5T8KVSWawgZnQ6dclo7O8RXtsBEt.k2v57q0eNdYeqIskqdFDt2
   JSONBIN_ACCESS_KEY = $2a$10$nX1Het5hM.pkIx8SiLvAc.f/KDMN.zNleV7cCnC7yUZjRxyqc2Ryq
   JSONBIN_CONFIG_BIN_ID = [your-config-bin-id]
   JSONBIN_DB_BIN_ID = [your-db-bin-id]
   JSONBIN_MAPPINGS_BIN_ID = [your-mappings-bin-id]
   ```

3. Optional: Set production prototype directly via env var:

   ```
   ACTIVE_PROTOTYPE = snack
   ```

4. Redeploy your app

## 📁 What Gets Stored in JSONBin?

### Config Bin (`JSONBIN_CONFIG_BIN_ID`)

Stores `app-config.json`:

```json
{
  "productionFolder": "production",
  "activePrototype": "snack"
}
```

### Database Bin (`JSONBIN_DB_BIN_ID`)

Stores `api-repo.json`:

```json
{
  "sites": [
    {
      "name": "demo",
      "apis": [
        {
          "name": "products",
          "url": "https://api.example.com/products",
          "method": "GET"
        }
      ]
    }
  ]
}
```

### Mappings Bin (`JSONBIN_MAPPINGS_BIN_ID`)

Stores `mappings.json`:

```json
{
  "sites": {
    "demo": {
      "actions": [],
      "mappings": [],
      "pageMappings": []
    }
  }
}
```

## 🔄 How It Works

1. **Automatic Fallback:**
   - If JSONBin env vars are set → uses JSONBin for all storage
   - If not set → falls back to local file storage (for dev)

2. **Caching:**
   - JSONBin responses are cached for 30 seconds to reduce API calls
   - Cache is auto-invalidated on writes

3. **No Code Changes Needed:**
   - All existing API endpoints work the same way
   - Server automatically detects and uses JSONBin when configured

## 🧪 Testing

### Test JSONBin Integration

1. Start your server with JSONBin configured
2. Open admin: `http://localhost:3000/admin`
3. Try these operations:
   - **Save production config** → Should succeed (no more "read-only FS" error!)
   - **Create a new site** → Saved to JSONBin DB
   - **Add an API endpoint** → Saved to JSONBin DB
   - **Create a mapping** → Saved to JSONBin Mappings

4. Verify in `jsonbin.html`:
   - Use "Read Bin" to check your bins contain the updated data

### Test Full Workflow

```powershell
# Run the test page
Start-Process "http://localhost:3000/jsonbin"
```

Click **"Run Full Test"** to execute:

1. Create bin
2. Read bin
3. Update bin
4. Read updated data
5. Delete bin

## 📊 Monitoring

### Check What's Using JSONBin

The server logs will show:

```
✓ JSONBin.io client initialized (remote storage enabled)
JSONBin config read failed, falling back to file: ...
JSONBin DB write failed: ...
```

### View Bin Contents

Use the test page at `/jsonbin` to:

- List all bins in your account
- Read any bin by ID
- See what data is stored

## 🔐 Security Notes

1. **Never commit `.env` file** to git (already in `.gitignore`)
2. **API Keys** have full access to your bins - keep them secret
3. **Access Keys** can be used for additional security (optional)
4. Use Vercel's environment variable encryption for production

## 🚨 Troubleshooting

### "could not persist config" error still appears

**Check:**

1. Are all 3 bin IDs set in environment variables?
2. Are the bin IDs correct (24-character hex strings)?
3. Did you restart the server after setting env vars?
4. Check server logs for "JSONBin.io client initialized"

### JSONBin API errors

**Check:**

1. Master Key is correct and active
2. Bins exist (use "List All Bins" in test page)
3. Not hitting rate limits (free tier: 10,000 requests/month)

### Data not persisting

**Check:**

1. Server logs for "JSONBin ... write failed" messages
2. Bin permissions (should allow your master key to write)
3. Try reading the bin directly in test page

## 📈 Rate Limits & Performance

- **Free Tier:** 10,000 API calls/month
- **Caching:** Reduces API calls by ~90% for read operations
- **Best Practice:** Use JSONBin for production, local files for dev

## 🔄 Migration from File Storage

If you have existing data in files:

1. **Backup your files:**

   ```powershell
   Copy-Item api-repo.json api-repo.json.backup
   Copy-Item mappings.json mappings.json.backup
   Copy-Item app-config.json app-config.json.backup
   ```

2. **Create bins with existing data:**
   - Open `jsonbin.html`
   - For each file, use "Create New Bin"
   - Paste file contents as initial JSON data
   - Save the bin ID

3. **Set env vars** with the new bin IDs

4. **Test** - your app now uses JSONBin!

## 💡 Tips

1. **Development:** Don't set JSONBin env vars - use local files (faster)
2. **Staging:** Use separate bins for staging environment
3. **Production:** Always use JSONBin on Vercel/serverless platforms
4. **Backup:** Export bins regularly using the test page

## 📚 Additional Resources

- JSONBin.io Documentation: https://jsonbin.io/api-reference
- JSONBin.io Pricing: https://jsonbin.io/pricing
- GitHub Issues: Report problems in this repo

---

**Questions?** Open an issue or check the test page at `/jsonbin` for live testing!
