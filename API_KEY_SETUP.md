# OpenAI API Key Setup Guide

## The Problem
Your OpenAI API key wasn't being loaded correctly. This guide explains how to fix it.

## Solution

### For Local Development

1. **Get an OpenAI API Key**
   - Go to https://platform.openai.com/api-keys
   - Click "Create new secret key"
   - Copy the key (it starts with `sk-`)

2. **Add to `.env` file**
   - Open the `.env` file in the project root
   - Replace `your_openai_api_key_here` with your actual key:
   ```
   OPENAI_API_KEY=sk-proj-YOUR_ACTUAL_KEY_HERE
   ```

3. **Restart your server**
   ```bash
   npm start
   ```
   
   You should see: `✅ OpenAI API key loaded successfully`

### For Vercel Deployment

1. **Go to your Vercel project dashboard**
   - Navigate to your project
   - Click "Settings" tab
   - Click "Environment Variables" in the left sidebar

2. **Add the environment variable**
   - Name: `OPENAI_API_KEY`
   - Value: `sk-proj-YOUR_ACTUAL_KEY_HERE`
   - Environment: Select all (Production, Preview, Development)
   - Click "Save"

3. **Redeploy your application**
   - Go to "Deployments" tab
   - Click the three dots (...) on the latest deployment
   - Click "Redeploy"
   - **IMPORTANT**: Check "Use existing Build Cache" to speed up deployment

4. **Verify it worked**
   - After deployment completes, check the deployment logs
   - Look for: `✅ OpenAI API key loaded successfully`
   - Or check: `https://your-app.vercel.app/api/health`

## Troubleshooting

### Error: "OPENAI_API_KEY environment variable is not set"
- **Local**: Make sure `.env` file exists and has the correct key
- **Vercel**: Make sure you added the environment variable AND redeployed

### Error: "Invalid or expired OpenAI API key"
- Your API key is wrong or has been revoked
- Generate a new key at https://platform.openai.com/api-keys
- Update both `.env` (local) and Vercel environment variables

### Error: "OpenAI API rate limit exceeded"
- You've hit your API usage limit
- Check your usage at https://platform.openai.com/usage
- Upgrade your OpenAI plan if needed

### Vercel environment variable not working
Common issues:
1. **Didn't redeploy** - Environment variables only take effect on NEW deployments
2. **Typo in variable name** - Must be exactly `OPENAI_API_KEY`
3. **Wrong environment** - Make sure you selected the right environment (Production/Preview/Development)
4. **Cache issues** - Try "Redeploy" without using existing build cache

## Security Notes

✅ **DO:**
- Store API keys in environment variables
- Keep `.env` in `.gitignore` (already configured)
- Use different keys for dev/production

❌ **DON'T:**
- Commit API keys to Git
- Share API keys publicly
- Hardcode keys in source files

## Testing Your Setup

### Local Test
```bash
# Start the server
npm start

# In another terminal, test the health endpoint
curl http://localhost:3001/api/health

# Test the chat endpoint
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, test message"}'
```

### Vercel Test
```bash
# Test health endpoint
curl https://your-app.vercel.app/api/health

# Check deployment logs
vercel logs
```

## What I Changed

1. **`server.js`**
   - Changed from hardcoded API key to `process.env.OPENAI_API_KEY`
   - Added startup validation with clear error messages
   - Added 401 error detection for invalid keys
   - Added helpful hints in error responses

2. **`api/classify-balance-sheet.js`**
   - Enhanced error handling
   - Added specific error messages for 401 (invalid key) and 429 (rate limit)
   - Better logging for debugging

3. **Created `.env`**
   - Template file for local development
   - Already in `.gitignore` for security

## Next Steps

1. Add your OpenAI API key to `.env` for local development
2. Add your OpenAI API key to Vercel environment variables
3. Redeploy on Vercel
4. Test both local and production

If you still have issues, check the server logs for the specific error message.
