# Citizen Safety Platform

A comprehensive multi-module citizen safety system with real-time monitoring, incident reporting, and emergency response coordination. Originally built as a tourist safety platform, now expanded to cover multiple safety domains.

## 🎯 Overview

This platform provides integrated safety services for citizens across multiple domains:

- **Women Safety**: Emergency response, harassment reporting, safe route planning
- **Street Animal Safety**: Report stray/aggressive animals, rabies risk alerts
- **Tourist Safety**: Location tracking, geofence alerts, group monitoring
- **Fire, Medical, Police**: Direct incident reporting with automatic emergency service dispatch

### Key Features

- 🚨 Real-time incident reporting with GPS location
- 📍 Live location tracking with anomaly detection
- 🏥 Automatic dispatch to nearest emergency services (hospital, police, fire)
- 👨‍👩‍👧‍👦 Family monitoring dashboard
- 🗺️ Interactive maps with safe zones and risk areas
- 🔔 Push notifications and SMS alerts
- 📊 Admin dashboard for incident management
- 🤖 AI-powered anomaly detection and risk scoring
- ⛓️ Blockchain-based digital ID verification
- 📡 **Offline-first location tracking** - Works even without internet connectivity
- 💾 **Smart data sync** - Automatic sync when connection is restored
- 🔋 **Battery efficient** - Optimized for mobile devices

## 🏗️ Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Tourist PWA   │────▶│  Backend API    │────▶│   PostgreSQL    │
│  (React SPA)    │     │  (Node/Express) │     │   Database      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                        ┌──────┴──────┐
                        │             │
                   ┌────▼────┐   ┌────▼────┐
                   │  Admin  │   │   AI    │
                   │Dashboard│   │Services │
                   └─────────┘   └─────────┘
```

### Components

- **tourist-pwa**: Progressive Web App for citizens to report incidents and track safety
- **admin-dashboard**: Management interface for authorities to monitor and respond to incidents
- **backend-api**: REST API + WebSocket server handling all business logic
- **ai-service**: Flask app for geofence monitoring and anomaly detection
- **Smart-anomly-detector**: FastAPI service for ML-based risk scoring
- **blockchain-logic**: Smart contracts for digital ID
- **hardhat-node**: Local Ethereum development node

## 🚀 Quick Start

### Prerequisites

- **Node.js** 16+ (backend, PWA, admin)
- **Python** 3.8+ (AI services)
- **PostgreSQL** 12+ (database)
- **npm** or **yarn** (package management)

### 1. Database Setup

Create the PostgreSQL database and initialize schema:

```powershell
# Create database (run in PostgreSQL terminal or pgAdmin)
psql -U postgres
CREATE DATABASE tourist_safety;
\c tourist_safety
\i e:\Tourist-Safety-System\backend-api\schema.sql
\q
```

Or using Windows PowerShell:

```powershell
cd e:\Tourist-Safety-System\backend-api
psql -U postgres -d tourist_safety -f schema.sql
```

### 2. Backend API Setup

```powershell
cd e:\Tourist-Safety-System\backend-api

# Install dependencies
npm install

# Create .env file (copy from .env.example if available, or create manually)
# Required environment variables:
#   DB_HOST=localhost
#   DB_PORT=5432
#   DB_USER=postgres
#   DB_PASSWORD=your_password
#   DB_NAME=tourist_safety
#   PORT=3001
#   AI_SERVICE_URL=http://127.0.0.1:8001

# Start the server
npm start
```

Server will run at `http://localhost:3001`

### 3. Tourist PWA Setup

```powershell
cd e:\Tourist-Safety-System\tourist-pwa

# Install dependencies
npm install

# Start development server
npm start
```

PWA will open at `http://localhost:3000`

### 4. Admin Dashboard Setup

```powershell
cd e:\Tourist-Safety-System\admin-dashboard

# Install dependencies
npm install

# Start development server
npm start
```

Admin dashboard will run at `http://localhost:3002` (or next available port)

### 5. AI Services (Optional)

#### Geofence Service

```powershell
cd e:\Tourist-Safety-System\ai-service

# Create virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1

# Install dependencies
pip install flask flask-cors requests

# Start service
python app.py
```

Runs at `http://127.0.0.1:5001`

#### Smart Anomaly Detector

```powershell
cd e:\Tourist-Safety-System\Smart-anomly-detector

# Activate virtual environment (or create new)
python -m venv venv
.\venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt

# Train model (first time)
python train_model.py

# Start service
python app.py
```

Runs at `http://127.0.0.1:8001`

## 📋 Usage

### For Citizens

1. **Open PWA** at `http://localhost:3000`
2. **Register/Login** with passport ID and email
3. **Report Incident**:
   - Click category quick-pick (Women Safety, Street Animal, etc.) or "Report an Incident"
   - Fill in description, location (or use auto-detect)
   - Submit - incident is automatically forwarded to relevant authorities
4. **Track Status**: View your incident's status and assigned agency

### For Authorities (Admin)

1. **Open Admin Dashboard** at `http://localhost:3002`
2. **Monitor Incidents**:
   - Click the Report icon in header
   - Filter by category (women_safety, street_animal, tourist_safety, fire, medical, police)
   - Filter by status (new, forwarded, in_progress, resolved, dismissed)
3. **Take Action**:
   - Update status (In Progress → Resolved)
   - Assign to specific agency
   - View location and reporter details

### For Families

1. Navigate to `http://localhost:3000#/login/family`
2. Register family group or log in
3. View all family members' locations and alerts on dashboard

## 🧪 Testing

### Backend Smoke Test

```powershell
cd e:\Tourist-Safety-System\backend-api
node test-incidents.js
```

This creates, lists, and updates a test incident.

### Integration Tests

```powershell
cd e:\Tourist-Safety-System\backend-api
node test-integration.js
```

### All Tests

```powershell
cd e:\Tourist-Safety-System\backend-api
.\test-all.ps1
```

## 🗂️ Project Structure

```
Tourist-Safety-System/
├── backend-api/           # Node.js + Express + PostgreSQL
│   ├── index.js          # Main server file
│   ├── db.js             # Database helpers
│   ├── schema.sql        # Database schema
│   ├── emergencyService.js
│   ├── womenService.js   # Women safety endpoints
│   ├── blockchainService.js
│   └── docs/
│       └── CITIZEN_SAFETY_ARCHITECTURE.md
├── tourist-pwa/           # React Progressive Web App
│   ├── src/
│   │   ├── App.js
│   │   ├── utils/
│   │   │   └── offlineLocationTracker.js  # 📡 Offline tracking system
│   │   ├── components/
│   │   │   ├── WomenDashboard.js   # Women safety dashboard
│   │   │   ├── ReportIncident.js   # New citizen incident reporting
│   │   │   ├── RegisterForm.js
│   │   │   ├── Login.js
│   │   │   └── FamilyDashboard.js
│   │   └── Map.js
│   └── public/
├── admin-dashboard/       # React + Material-UI + Leaflet
│   └── src/
│       └── App.js        # Incidents management UI
├── ai-service/            # Flask geofence service
│   └── app.py
├── Smart-anomly-detector/ # FastAPI ML anomaly detection
│   ├── app.py
│   ├── train_model.py
│   └── model/
├── blockchain-logic/      # Solidity smart contracts
│   └── DigitalID.sol
└── hardhat-node/          # Hardhat Ethereum dev environment
    └── hardhat.config.js
```

## 🔧 Configuration

### Backend Environment Variables (.env)

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=tourist_safety

# Server
PORT=3001

# AI Services (optional)
AI_SERVICE_URL=http://127.0.0.1:8001

# Email (optional, for OTP)
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password

# Blockchain (optional)
BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
DIGITAL_ID_CONTRACT_ADDRESS=0x...
```

### PWA Configuration

The PWA auto-detects the backend URL. If running on a different machine or port, set localStorage:

```javascript
localStorage.setItem('BACKEND_URL', 'http://192.168.1.100:3001');
```

## 🔐 Security Notes

- Always use HTTPS in production
- Set up proper authentication tokens
- Configure CORS to only allow trusted origins
- Use environment variables for sensitive data
- Enable rate limiting on API endpoints
- Validate and sanitize all user inputs

## � Offline Location Tracking

The Women Safety module includes robust offline-first location tracking that works even without internet connectivity.

### Features
- ✅ **Continuous tracking** even when offline
- ✅ **IndexedDB storage** for pending location data
- ✅ **Automatic sync** when connection is restored
- ✅ **SOS alert prioritization** for emergency situations
- ✅ **Battery efficient** using native geolocation API
- ✅ **Smart retry logic** with exponential backoff

### How It Works

1. **Offline Mode**: Location data stored locally in browser's IndexedDB
2. **Online Detection**: Automatically detects when connection is restored
3. **Background Sync**: Sends all pending data to backend automatically
4. **Visual Feedback**: Dashboard shows offline/sync status in real-time

### Technical Details

- **Storage**: IndexedDB with 500 location limit
- **Sync Interval**: Every 30 seconds when online
- **Retry Logic**: Up to 5 attempts with exponential backoff
- **Data Retention**: 7 days for synced records

📚 **Full Documentation**: See [OFFLINE_LOCATION_TRACKING.md](./OFFLINE_LOCATION_TRACKING.md)

## �🛣️ Roadmap

- [ ] Real government API integrations (112, municipal services)
- [ ] Media upload for incident reports (photo/video)
- [ ] Real-time socket notifications for incident updates
- [ ] Mobile app versions (React Native)
- [ ] Multi-language support
- [ ] Advanced analytics dashboard
- [ ] Integration with city CCTV systems
- [ ] Predictive risk modeling using historical data
- [x] **Offline-first location tracking** ✅
- [ ] Service Worker for true background sync
- [ ] Push notifications for offline data sync

## 📄 License

[Add your license here]

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## 📞 Support

For issues or questions, please contact:
- Email: support@citizensafety.example
- GitHub Issues: [Repository Issues](https://github.com/WeCodeBlooded/Tourist-Safety-System/issues)

---

**Built with ❤️ for safer communities**
