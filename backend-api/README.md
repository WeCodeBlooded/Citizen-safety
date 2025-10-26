# Backend API - Citizen Safety Platform

Node.js + Express REST API and WebSocket server for the Citizen Safety Platform.

## 🚀 Overview

This is the central Node.js and Express backend for the Citizen Safety Platform (formerly Smart Tourist Safety system). It handles user registration, location tracking, **citizen incident reporting**, group management, emergency service dispatch, and communication with AI anomaly detectors and blockchain.

## ✨ Key Features

- **User Authentication:** Secure registration and login using email and OTP
- **Real-time Location Tracking:** Ingests location data from the PWA and broadcasts updates via WebSockets
- **Citizen Incident Reporting:** Multi-module safety incidents (women safety, street animals, tourist safety, fire, medical, police)
- **Emergency Service Dispatch:** Automatic forwarding to nearest hospitals, police stations, and fire services
- **Group Management:** Allows tourists to create and join travel groups
- **Automated Alerts:** Integrates with the Smart anomaly detector to detect anomalies like geofence breaches, inactivity, and group dislocation
- **Panic Button:** Provides an endpoint for users to signal distress immediately
- **Admin Dashboard API:** Endpoints for incident management, status updates, and agency assignment

## 🛠️ Tech Stack

- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL
- **Real-time Communication:** Socket.io
- **Email Service:** Nodemailer
- **Task Scheduling:** node-cron
- _(Add any other key libraries you used)_

## ⚙️ Setup and Installation

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [PostgreSQL](https://www.postgresql.org/download/) database running
- An active Gmail account with an "App Password" for Nodemailer

### Installation Steps

1.  **Clone the repository:**
    ```bash
    git clone [your-repo-url]
    cd backend-api
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set up the database:**
    - Connect to your PostgreSQL instance
    - Create a new database (e.g., `tourist_safety`)
    - Run the `schema.sql` file to set up the necessary tables:
    ```powershell
    psql -U postgres -d tourist_safety -f schema.sql
    ```

4.  **Configure Environment Variables:**
    - Create a file named `.env` in the root of this folder
    - Fill in the required values (database credentials, email settings, etc.)

    **`.env` file:**
    ```env
    # PostgreSQL Database
    DB_HOST=localhost
    DB_PORT=5432
    DB_USER=postgres
    DB_PASSWORD=your_db_password
    DB_DATABASE=tourist_safety

    # Server
    PORT=3001

    # Admin dashboard authentication
    ADMIN_JWT_SECRET=change_this_secret
    ADMIN_TOKEN_COOKIE=admin_token
    ADMIN_TOKEN_TTL_HOURS=12

    # Nodemailer (Gmail for OTP)
    EMAIL_USER=your-email@gmail.com
    EMAIL_PASS=your_gmail_app_password

    # AI Services
    AI_SERVICE_URL=http://127.0.0.1:8001

    # Blockchain (optional)
    BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
    DIGITAL_ID_CONTRACT_ADDRESS=0x...
    ```

## ▶️ How to Run

1.  **Start the Smart anomaly detector (optional, for AI features):**
    ```powershell
    cd ..\Smart-anomly-detector
    python -m venv venv
    .\venv\Scripts\Activate.ps1
    pip install -r requirements.txt
    python train_model.py
    python app.py
    ```
    Runs at `http://127.0.0.1:8001`

2.  **Start the backend server:**
    ```powershell
    npm start
    ```
    The API will be running at `http://localhost:3001`

### Create an Admin User

The admin dashboard requires authenticated users stored in the `admin_users` table. Registration happens outside the UI. Use the helper CLI after configuring your `.env` file and running migrations:

```powershell
npm run create-admin -- --email=admin@example.com --password=StrongPass123 --display="City Command" --service=both
```

`--service` accepts `tourist`, `women`, or `both` and controls which datasets the admin can access inside the dashboard. Re-running the script for the same email updates the password, display name, and assigned service.

## 📝 API Endpoints

### Citizen Incident Reporting

- `POST /api/v1/incidents`: Create a new incident (women_safety, street_animal, tourist_safety, fire, medical, police)
- `GET /api/v1/incidents`: List incidents with filters (category, status, pagination)
- `PATCH /api/v1/incidents/:id`: Update incident status or assign to agency

### Tourist Tracking

- `POST /api/v1/auth/register`: Register a new tourist
- `POST /api/v1/location`: Update a tourist's location
- `POST /api/v1/panic`: Trigger a panic alert
- `GET /api/v1/tourists`: (Admin) Fetch all tourist data

### Emergency Services

- `POST /api/v1/alerts/forward-to-emergency`: Forward alert to nearby services
- `GET /api/v1/alerts/:passportId/history`: Get alert history for a tourist

### Offline SMS / USSD (Fallback delivery)

The backend supports an offline SMS queue for fallback delivery when realtime channels fail or when devices submit queued SOS events.

- `POST /api/v1/alert/enqueue-sms` — enqueue a message. Body: `{ passportId, phoneNumber, message, channel }`.
- `GET  /api/v1/alert/sms-queue` — list recent queue items (admin/debug).
- `POST /api/v1/alert/process-sms-queue` — trigger processing of the queue (calls the worker).

The queue records are persisted in the `sms_queue` table. The worker uses Twilio when `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are provided; otherwise processing is logged for development. Retries are attempted up to 5 times before marking an entry as `failed`.

Environment variables (Twilio):

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
- `TWILIO_SMS_FROM` — sender phone number for SMS
- `TWILIO_WHATSAPP_FROM` — sender address for WhatsApp if used
- `TWILIO_ENABLE_ALERTS` — set `false` to disable Twilio integration

### Safe Zones Mapping

The backend provides a REST API for managing and querying safe zones (police stations, hospitals, shelters, treatment centres) with offline caching support.

- `GET  /api/v1/safe-zones` — list all safe zones with optional filters. Query params:
  - `type` — filter by type: `police`, `hospital`, `shelter`, `treatment_centre`
  - `city`, `state` — filter by location
  - `verified` — filter by verification status (boolean)
  - `limit`, `offset` — pagination (default: limit=50)
- `GET  /api/v1/safe-zones/nearby` — find safe zones within radius. Query params:
  - `latitude`, `longitude` — center point coordinates (required)
  - `radius` — search radius in meters (default: 5000)
  - `type` — optional type filter
  - `limit` — max results (default: 20)
- `GET  /api/v1/safe-zones/:id` — get detailed information for a specific safe zone
- `POST /api/v1/safe-zones` — create new safe zone (admin). Body: `{ name, type, latitude, longitude, address, contact, city, district, state, operational_hours, services[], verified }`
- `PATCH /api/v1/safe-zones/:id` — update safe zone (admin)
- `DELETE /api/v1/safe-zones/:id` — soft delete safe zone (admin)

The safe zones are persisted in the `safe_zones` table with geospatial indexes for fast proximity queries. The API uses Haversine distance calculation for nearby searches. The frontend caches data in IndexedDB for offline access.

**Testing:** Run `node test-safe-zones.js` to test all endpoints.

See [SAFE_ZONES_FEATURE.md](../SAFE_ZONES_FEATURE.md) for comprehensive documentation.

### Family Dashboard

- `POST /api/v1/family/register`: Register a family group
- `POST /api/v1/family/login`: Family login
- `GET /api/v1/family/members`: Get family members' locations

See `docs/CITIZEN_SAFETY_ARCHITECTURE.md` for detailed API documentation.

---