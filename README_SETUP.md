# Coding Platform Setup Guide

## 1. Prerequisites
- **Node.js** (Installed)
- **PostgreSQL** (Installed and Running)

## 2. Database Setup
1. Open pgAdmin or psql and create a new database called `coding_platform`.
2. Update the `.env` file in the root directory with your PostgreSQL credentials:
   ```env
   DB_USER=postgres
   DB_PASSWORD=your_password
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=coding_platform
   ```

## 3. Data Setup
1. Ensure your Excel whitelist file is at `data/allowed_users.xlsx`.
2. The columns in the Excel file must be `Email` and `RegisterNumber`.

## 4. Run the Project
1. Install dependencies (if you haven't):
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   npm start
   ```
   (Or `npm run dev` for development with auto-reload).

## 5. Verification
- Go to `http://localhost:3000`.
- You should be redirected to the Login page.
- Register with a valid email (ending in `@psgitech.ac.in`) and a Register Number matching the format `7155xx1050xx`.
- **Note**: The email/register number MUST exist in your Excel whitelist file first!

## 6. Architecture Overview
- **server/db.js**: Handles PostgreSQL connection and automatic table creation.
- **server/auth.routes.js**: Handles Login/Register with JWT.
- **server/judge.routes.js**: Handles code execution and submission.
- **public/auth.html**: New Glassmorphism login page.
- **public/app.js**: Updated frontend logic using JWT.
