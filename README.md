# Civic AI App

A smart AI-powered civic issue reporting platform with FastAPI backend and multi-page frontend.

## Features

- **Smart Photo Recognition**: AI-powered issue classification using CLIP
- **Voice Input**: Add voice descriptions to reports
- **Community Dashboard**: View and vote on public complaints
- **Personal Reports**: Track your submitted issues
- **User Authentication**: Secure login and registration system
- **Welcome Page**: First-time user onboarding experience

## Structure

```
civic-ai-app/
│
├── backend/                # FastAPI backend
│   ├── app/
│   │   ├── main.py         # FastAPI entrypoint
│   │   ├── classifier.py   # CLIP classification logic
│   │   ├── templates.py    # Category → Description mapping
│   │   ├── models.py       # Database models
│   │   ├── database.py     # Database configuration
│   │   ├── routes_*.py     # API route handlers
│   │   └── __init__.py
│   ├── data/               # Database files
│   ├── uploads/            # User uploaded images
│   ├── scripts/            # Database management scripts
│   ├── requirements.txt
│   └── venv/               # (optional) Python virtual environment
│
├── frontend/               # Static frontend
│   ├── welcome.html        # First-time user landing page
│   ├── index.html          # Main dashboard
│   ├── report.html         # Issue reporting page
│   ├── community.html      # Community dashboard
│   ├── myreports.html      # Personal reports
│   ├── profile.html        # User profile
│   ├── style.css           # Main styling
│   ├── script.js           # Core JavaScript functions
│   ├── report.js           # Report page functionality
│   ├── community.js        # Community page functionality
│   └── myreports.js        # My Reports page functionality
│
└── README.md
```

## User Experience

### First-Time Users

- Are greeted with a beautiful welcome page (`welcome.html`)
- See app features, benefits, and statistics
- Click "Enter Civic AI Platform" to access the main app

### Returning Users

- Directly access the main app
- See their username and logout option in the navigation
- Have access to all features immediately

### Navigation

- **When Not Logged In**: Login/Register buttons in navigation
- **When Logged In**: Username dropdown with Profile and Logout options

## Running the App

### Backend Setup

1. Create a virtual environment and install dependencies:

   ```sh
   cd backend
   python -m venv venv
   venv\Scripts\activate  # On Windows
   pip install -r requirements.txt
   ```

2. Start the FastAPI server:
   ```sh
   uvicorn app.main:app --reload
   ```

### Frontend Setup

1. Serve the frontend files using any static file server:

   ```sh
   cd frontend
   # Using Python's built-in server
   python -m http.server 5500

   # Or using Node.js http-server
   npx http-server -p 5500

   # Or using Live Server extension in VS Code
   ```

2. Open your browser to [http://localhost:5500](http://localhost:5500)

## Using the App

### For New Users

1. Visit the app URL - you'll be greeted with the welcome page
2. Click "Enter Civic AI Platform" to access the main app
3. Register for an account or login with existing credentials
4. Start reporting issues by taking photos or uploading images

### Core Features

- **Report Issues**: Take photos, get AI analysis, add voice descriptions
- **Community Dashboard**: View and vote on public complaints
- **My Reports**: Track your submitted issues and their status
- **Profile**: Manage your account and view statistics
- **Authentication**: Simple username/password login system (no email required)

## Authentication System

The app uses a simple username/password authentication system:

### Registration

- **Username**: Choose any username (must be unique)
- **Password**: Set a secure password
- No email address required

### Login

- **Username**: Your chosen username
- **Password**: Your password

### Backend API

- **Register**: `POST /auth/register` with `username` and `password`
- **Login**: `POST /auth/token` with `username` and `password`
- **Profile**: `GET /auth/me` with JWT token

All authentication forms across the app use consistent `username` and `password` fields.

## Development & Testing

### Reset Welcome State

To test the first-time user experience, run this in browser console:

```javascript
localStorage.removeItem("hasSeenWelcome");
localStorage.removeItem("token");
localStorage.removeItem("username");
window.location.reload();
```

### Database Management

- Create admin user: `python scripts/create_admin.py`
- Reset database: `python scripts/recreate_db.py`
- Migrate database: `python scripts/migrate_db.py`
