# AIVA

AIVA is a full-stack mobile app for browsing a short-video feed and generating AI videos from image uploads.  
The project has:

- `Frontend/`: Expo + React Native client (`App.js` contains the main app flow)
- `Backend/`: Node.js + Express API with PostgreSQL storage

## Screenshots

![Feed Screen](docs/video.png)
![Profile Screen](docs/profile.png)
![AIVA Generator](docs/create.png)

## How It Works

### App flow

1. User authenticates with phone + OTP and a password.
2. Frontend stores a session token in `AsyncStorage`.
3. Frontend calls backend APIs for:
   - profile/session state (`/auth/me`)
   - feed loading and interactions (`/feed`, likes, comments, views)
   - AIVA generation + status (`/aiva/generate`, `/aiva/status`)
4. Backend persists users, sessions, feed data, and generation jobs in Postgres.

### AIVA recommendation system (feed ranking)

The recommendation logic currently runs in the frontend (`Frontend/App.js`) and ranks the non-profile feed in two stages.

1. Candidate set:
   - Start from `candidateFeed` (all posts except your own when browsing the main feed).
2. Stage 1 keyword + behavior score:
   - Build token sets from each post's `username`, `caption`, `audio`, and comment text.
   - Build a user-interest token profile from prior interactions:
     - followed creator
     - liked post
     - comments you wrote
     - view counts
   - Score every post with weighted signals:
     - unseen boost (largest weight)
     - followed creator boost
     - liked/commented/viewed boosts
     - token similarity to your interest profile
     - small recency bonus based on current ordering
   - Sort by this score to get stage-1 ranking.
3. Stage 2 learned reranker:
   - Build training rows from items you have viewed or liked.
   - Label = `1` for liked, `0` for viewed-but-not-liked.
   - Train lightweight logistic-regression models on-device:
     - learned model (behavior features)
     - hybrid model (behavior + stage-1 keyword score feature)
   - Predict probabilities for all stage-1 items and compute final score:
     - `finalScore = hybridProbability * 0.85 + learnedProbability * 0.15`
4. Final ordering rules:
   - Unseen items are always placed before seen items.
   - Within those groups, sort by `finalScore` (then stage-1 score for tie-breaks).
   - While you are scrolling, already-viewed positions are partially frozen to avoid feed jumping.
5. Built-in evaluation:
   - The app logs `like@k` and `AUC` for keyword vs learned vs hybrid ranking in console (`[Recommender Eval]`), using a deterministic train/test split.

### AI video generation flow

1. User selects/upload images in the app.
2. Frontend sends images + prompt data to backend.
3. Backend orchestrates external providers:
   - OpenAI (prompt/content shaping)
   - ElevenLabs (voice/narration)
4. Backend uses `ffmpeg` to stitch/finalize output.
5. Final video is saved under `Backend/uploads/videos` and appears in feed.

## Tech Stack

- Frontend: Expo 54, React Native 0.81, React 19
- Backend: Express 4, `pg`, `multer`
- Database: PostgreSQL (Neon works)
- Media processing: `ffmpeg`

## Project Structure

```text
Aiva/
  Frontend/
    App.js
    CommentsSection.js
    package.json
  Backend/
    server.js
    uploads/
    package.json
```

## Prerequisites

- Node.js 18+
- npm
- PostgreSQL database URL
- `ffmpeg` installed and available in PATH (or set `FFMPEG_BINARY`)

## Setup

### 1. Backend

```bash
cd Backend
npm install
```

Create `Backend/.env` with required values:

```env
DATABASE_URL=postgresql://...
PG_SSL=true
PORT=3001

# Required for auth SMS
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_VERIFY_SERVICE_SID=...

# Required for AIVA generation
OPENAI_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
```

Optional backend env vars:

- `PUBLIC_BASE_URL`
- `OPENAI_API_BASE`, `OPENAI_MODEL`
- `ELEVENLABS_API_BASE`, `ELEVENLABS_MODEL_ID`
- `AIVA_MAX_IMAGES`, `AIVA_SECONDS_PER_IMAGE`, `AIVA_SCENE_COUNT`, `AIVA_PROMPT_TEXT`, `AIVA_PROMPT_IMAGE_URL`
- `AUTH_OTP_TTL_MS`, `AUTH_SESSION_TTL_MS`
- `PG_POOL_MAX`, `PG_IDLE_TIMEOUT_MS`, `PG_CONNECTION_TIMEOUT_MS`, `PG_KEEPALIVE_INITIAL_DELAY_MS`

Run backend:

```bash
npm start
```

The backend auto-creates/updates required tables on startup (`initDb()` in `server.js`).

### 2. Frontend

```bash
cd Frontend
npm install
```

Create `Frontend/.env`:

```env
EXPO_PUBLIC_API_BASE_URL=http://localhost:3001
```

Run frontend:

```bash
npm start
```

Then launch iOS/Android from Expo.

## API Overview

Common routes in `Backend/server.js`:

- Health: `GET /health`
- Auth:
  - `POST /auth/register/start`
  - `POST /auth/register/verify`
  - `POST /auth/login/start`
  - `POST /auth/login/verify`
  - `GET /auth/me`
  - `POST /auth/logout`
  - `POST /auth/change-password/start`
  - `POST /auth/change-password/verify`
  - `POST /auth/change-phone/start`
  - `POST /auth/change-phone/verify`
- AIVA:
  - `POST /aiva/prompt-image`
  - `POST /aiva/generate`
  - `GET /aiva/status`
  - `POST /aiva/reward-ad-view`
  - `POST /aiva/reset-upload-count`
- Feed/social:
  - `GET /feed`
  - `POST /feed/:id/like`
  - `POST /feed/:id/comments`
  - `POST /feed/:id/view`
  - `DELETE /feed/:id`
  - `GET /following`
  - `POST /following/:username`
  - `DELETE /channels/:username`

## Troubleshooting

- React Native error `No suitable URL request handler found for localhost:3001/...`:
  - Ensure `EXPO_PUBLIC_API_BASE_URL` includes `http://` or `https://`.
- Real device cannot reach backend on `localhost`:
  - Use your machine LAN IP, e.g. `http://192.168.x.x:3001`.
- Backend `ETIMEDOUT` to Postgres:
  - Verify network/VPN/firewall and database availability.
  - Tune `PG_CONNECTION_TIMEOUT_MS` and pool-related env vars.

## Notes

- Uploaded/generated media is stored under `Backend/uploads`.
- `node_modules` is committed locally in this workspace; for normal repos, keep it ignored.
