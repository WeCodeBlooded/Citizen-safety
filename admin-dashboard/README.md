# Admin Dashboard

React dashboard for the Citizen Safety operations team. It provides authenticated access to tourist and women safety data, live alerts, incident triage, and panic response tooling.

## Features

- Email/password login backed by the backend `admin_users` table
- Role-aware access control (`tourist`, `women`, or `both`) applied across lists, filters, and incident actions
- Live location map with panic alerts, anomaly tracking, and reset workflows
- Incident management with status updates and agency assignments
- Women safety streaming review and emergency contact visibility
- Real-time socket updates scoped to the authenticated admin session

## Requirements

- Backend API running with admin authentication enabled
- Admin seeded via `npm run create-admin` in `backend-api`
- Node.js 18+ and npm

Create a `.env` file in this directory with at least:

```env
REACT_APP_BACKEND_URL=http://localhost:3001
```

The frontend automatically sends credentials (cookies) with axios requests, so the backend must allow credentialed requests over HTTP during development or use HTTPS in production.

## Getting Started

```powershell
cd admin-dashboard
npm install
npm start
```

Visit `http://localhost:3000` and log in using the email/password created through the backend helper. The header displays the assigned service and includes a logout action. Filters and data visibility adjust automatically according to that assignment.

## Development Notes

- Socket connections are re-established whenever the admin session changes. Logging out clears local state to prevent stale data exposure.
- 401 responses from the backend automatically clear the session and return to the login screen.
- Service filters are pinned when the admin is scoped to a specific team; global admins (`both`) can toggle between datasets.
- Styling for the login experience lives under `.auth-*` classes; header actions use `.header-*` modifiers in `src/App.css`.
