# Financial Analysis Application

A comprehensive financial planning and analysis tool with AI-powered insights.

## Architecture

- **Frontend**: Static HTML/CSS/JavaScript (hosted on GitHub Pages)
- **Backend**: Node.js/Express server (handles OpenAI API calls securely)

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Setup

Copy the example environment file:
```bash
cp .env.example .env
```

The `.env` file already contains your OpenAI API key. For production, you should:
- Use environment variables on your hosting platform
- Never commit the `.env` file to version control

### 3. Start the Backend Server

```bash
npm start
```

The server will run on `http://localhost:3001`

### 4. Test the Backend

Visit: `http://localhost:3001/api/health`

You should see: `{"status":"OK","message":"Financial Analysis Backend is running"}`

### 5. Start the Frontend

Open `index.html` in your browser or serve it locally.

## API Endpoints

- `POST /api/chat` - Send chat messages to OpenAI
- `GET /api/health` - Health check

## Deployment

### Backend Deployment Options:

1. **Heroku** (Recommended for beginners)
2. **Railway** 
3. **Vercel**
4. **DigitalOcean**

### Frontend Deployment:
- Already deployed on GitHub Pages
- Update the `BACKEND_URL` in `src/app.js` to point to your deployed backend

## Security Notes

- API key is stored securely on the backend server
- Frontend never exposes the OpenAI API key
- CORS is enabled for development (configure for production)

## Development

To run in development mode with auto-restart:
```bash
npm run dev
```