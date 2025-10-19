# Tourist PWA - Citizen Safety Platform

Progressive Web App for citizens to report safety incidents, track locations, and access emergency services.

## Features

- 🚨 **Multi-Module Incident Reporting**: Report incidents across categories:
  - Women Safety
  - Street Animal Safety
  - Tourist Safety
  - Fire Emergencies
  - Medical Emergencies
  - Police Assistance
- 📍 **Real-time Location Tracking**: Share your location with family and authorities
- 🗺️ **Interactive Map**: View safe zones, risk areas, and your location history
- 👨‍👩‍👧‍👦 **Family Dashboard**: Monitor family members' safety in real-time
- 🔔 **Panic Button**: Quick access to emergency alerts
- 🔐 **Secure Authentication**: Email-based OTP login system
- 📱 **Offline Support**: Works even with limited connectivity

## Tech Stack

- **Framework**: React 18
- **Mapping**: Leaflet + React-Leaflet
- **Routing**: React Router
- **HTTP**: Axios
- **Real-time**: Socket.IO client
- **Styling**: CSS3 with responsive design

## Quick Start

### Prerequisites

- Node.js 16+
- Backend API running at `http://localhost:3001`

### Installation

```powershell
# Install dependencies
npm install

# Start development server
npm start
```

App opens at `http://localhost:3000`

## Available Scripts

### `npm start`

Runs the app in development mode at [http://localhost:3000](http://localhost:3000).

The page will reload when you make changes. You may also see lint errors in the console.

### `npm test`

Launches the test runner in interactive watch mode.

### `npm run build`

Builds the app for production to the `build` folder. It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and filenames include hashes. Your app is ready to be deployed!

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

## Configuration

### Backend URL

The PWA auto-detects the backend URL based on hostname. To manually configure:

```javascript
// In browser console or app code
localStorage.setItem('BACKEND_URL', 'http://your-backend:3001');
```

### Environment Variables

Create `.env` file (optional):

```env
REACT_APP_BACKEND_URL=http://localhost:3001
REACT_APP_API_TIMEOUT=10000
```

## Usage

### For Citizens

1. **Open PWA** at `http://localhost:3000`
2. **Register** with passport ID and email
3. **Verify** email OTP
4. **Complete Profile** with passport documents
5. **Report Incident**:
   - Click a category quick-pick button (e.g., "Women Safety")
   - Or click "Report an Incident" for all options
   - Fill in details and location
   - Submit for automatic dispatch to authorities

### For Families

1. Navigate to `http://localhost:3000#/login/family`
2. Register family group with:
   - Family name
   - Admin email and password
   - Add family members (passport IDs)
3. View all members on family dashboard map
4. Monitor locations and receive alerts

## Routes

- `/` - Landing page with login/register
- `/register` - New user registration
- `/login` - User login
- `/login/family` - Family login
- `/family-dashboard` - Family monitoring interface
- `/report-incident` - Incident reporting form
- `/report-incident?cat=<category>` - Pre-filled category report

## Components

### Core Components

- **App.js**: Main application with routing and state management
- **Map.js**: Interactive Leaflet map with markers and controls
- **ProfileForm.js**: User profile and document upload
- **AlertModal.js**: Emergency alert notifications
- **GeoFenceAlertModal.js**: Geofence breach warnings

### Incident Reporting

- **ReportIncident.js**: Multi-category incident form with:
  - Category quick-pick chips
  - Auto-location detection
  - Optional reporter details
  - Real-time submission status

### Authentication

- **RegisterForm.js**: New user registration
- **Login.js**: Email + OTP authentication
- **EmailVerification.js**: OTP verification flow

### Family Features

- **FamilyLogin.js**: Family group authentication
- **FamilyDashboard.js**: Real-time family location map

### UI Components

- **Guidance.js**: Safety tips and guidance
- **Orbits.js**: Animated loading indicator

## API Integration

The PWA communicates with the backend via:

### REST API
- `POST /api/v1/tourists/register` - User registration
- `POST /api/v1/auth/send-otp` - Send OTP
- `POST /api/v1/auth/verify-otp` - Verify OTP
- `POST /api/v1/incidents` - Create incident
- `POST /api/v1/location` - Update location
- `POST /api/v1/panic` - Trigger panic alert

### WebSocket
- `locationUpdate` - Real-time location updates
- `panicAlert` - Emergency notifications
- `anomalyAlert` - Anomaly detection alerts

## Features Detail

### Incident Reporting Flow

1. User clicks category (e.g., "Women Safety")
2. PWA navigates to `#/report-incident?cat=women_safety`
3. Form pre-selects category
4. User fills description and location (or auto-detects)
5. Optional: Add reporter name/contact
6. Submit → Backend creates incident
7. Backend auto-forwards to relevant services (police, hospital, etc.)
8. User sees confirmation with incident ID and status

### Location Tracking

The PWA implements intelligent GPS filtering:
- Accuracy thresholds (rejects > 5km uncertainty)
- Speed validation (rejects physically impossible jumps)
- Moving average smoothing (5-point buffer)
- Minimal bandwidth usage (only sends significant changes)

### Family Dashboard

- Real-time map with all family members
- Color-coded status indicators:
  - Green: Active
  - Red: Distress
  - Yellow: Anomaly detected
  - Gray: Offline
- Group dislocation alerts when members separate > threshold

## Troubleshooting

### Backend Not Connecting

Check browser console for errors. Common issues:
- Backend not running (start with `npm start` in `backend-api/`)
- Wrong URL in localStorage
- CORS issues (backend should allow localhost)

### Location Not Updating

- Check browser location permissions
- Ensure HTTPS (or localhost) for geolocation API
- Verify WebSocket connection in Network tab

### Map Not Loading

- Check internet connection for tile downloads
- Verify Leaflet CSS is imported
- Clear browser cache

## Production Build

```powershell
# Create optimized build
npm run build

# Serve with a static server
npx serve -s build -p 3000
```

Or deploy to:
- **Netlify**: Drag `build/` folder to Netlify
- **Vercel**: Connect GitHub repo
- **Azure Static Web Apps**: Use GitHub Actions

## Progressive Web App Features

The PWA supports:
- ✅ Offline mode (service worker)
- ✅ Install to home screen
- ✅ Push notifications (when configured)
- ✅ Background sync
- ✅ Responsive design (mobile, tablet, desktop)

## Contributing

See main repository README for contribution guidelines.

## License

[Add license]

## Learn More

- [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started)
- [React documentation](https://reactjs.org/)
- [Leaflet documentation](https://leafletjs.com/)
- [Socket.IO client docs](https://socket.io/docs/v4/client-api/)
