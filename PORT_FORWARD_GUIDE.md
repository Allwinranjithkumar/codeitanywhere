# Port Forwarding Guide for Coding Contest Platform

## Option 1: ngrok (Easiest - 5 Minutes)

**Best for:** Quick testing, temporary access, sharing with friends

### Steps:
1. Download ngrok: https://ngrok.com/download
2. Install and add to PATH
3. Run your server: `npm start`
4. In a new terminal, run:
   ```bash
   ngrok http 3000
   ```
5. ngrok will give you a public URL like: `https://abc123.ngrok.io`
6. Share this URL with anyone! They can access your contest from anywhere.

**Pros:**
- ✅ Works in 2 minutes
- ✅ No router configuration needed
- ✅ HTTPS included (secure)
- ✅ Works from anywhere in the world

**Cons:**
- ❌ Free tier gives you a random URL each time
- ❌ URL changes when you restart ngrok
- ❌ Not permanent

**Note:** Free tier works fine for testing with 20-40 students.

---

## Option 2: Router Port Forwarding (Local Network)

**Best for:** College lab setup, local network access only

### Steps:

#### Step 1: Find Your Local IP
Open PowerShell and run:
```powershell
ipconfig
```
Look for "IPv4 Address" under your active network adapter (e.g., `192.168.1.100`)

#### Step 2: Access Your Router Settings
1. Open browser and go to your router IP (usually `192.168.1.1` or `192.168.0.1`)
2. Login with admin credentials (check router label or manual)

#### Step 3: Configure Port Forwarding
- Navigate to "Port Forwarding" or "Virtual Server" section
- Add a new rule:
  - **Service Name:** Coding Contest
  - **External Port:** 3000
  - **Internal IP:** Your PC's IP (from Step 1)
  - **Internal Port:** 3000
  - **Protocol:** TCP

#### Step 4: Find Your Public IP
Go to: https://whatismyipaddress.com/
Note down your public IP (e.g., `203.0.113.45`)

#### Step 5: Share the URL
Students can access via: `http://YOUR_PUBLIC_IP:3000`

**Pros:**
- ✅ Free
- ✅ Full control

**Cons:**
- ❌ Requires router access
- ❌ Public IP might change (use Dynamic DNS to fix)
- ❌ Security risk if not configured properly
- ❌ Only works if your ISP doesn't block incoming connections

**Security Tips:**
- Change the default port from 3000 to something random (e.g., 8472)
- Use a firewall
- Only enable during the contest

---

## Option 3: Deploy to Render.com (Cloud Hosting - Permanent)

**Best for:** Production use, permanent hosting, professional setup

### Steps:

#### 1. Prepare Your Code
Your code is already ready! You have:
- ✅ `Dockerfile` 
- ✅ PostgreSQL database configuration
- ✅ Environment variables in `.env`

#### 2. Create GitHub Repository
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/codeitanywhere.git
git push -u origin main
```

#### 3. Create PostgreSQL Database on Render
1. Go to https://dashboard.render.com/
2. Click **New +** → **PostgreSQL**
3. Name: `codeitanywhere-db`
4. Select **Free** tier
5. Click **Create Database**
6. Copy the **Internal Database URL** (looks like: `postgres://user:pass@host/db`)

#### 4. Create Web Service on Render
1. Click **New +** → **Web Service**
2. Connect your GitHub repository
3. Settings:
   - **Name:** `codeitanywhere`
   - **Region:** Singapore (or closest)
   - **Branch:** `main`
   - **Runtime:** Docker
   - **Instance Type:** Free

#### 5. Add Environment Variables
Click "Environment" and add:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | (Paste the Internal Database URL from Step 3) |
| `JWT_SECRET` | `your_random_secret_key_here_change_this` |
| `NODE_ENV` | `production` |

#### 6. Deploy
Click **Create Web Service**

Render will:
- Build your Docker image (takes ~5-10 minutes)
- Install all compilers (C++, Python, Java)
- Start your server
- Give you a permanent URL like: `https://codeitanywhere.onrender.com`

**Pros:**
- ✅ Permanent URL
- ✅ HTTPS included
- ✅ Professional
- ✅ No router configuration
- ✅ Auto-restarts if crashes
- ✅ Can handle 50+ concurrent students

**Cons:**
- ❌ Free tier "sleeps" after 15 minutes of inactivity
- ❌ First request after sleep takes 30 seconds to wake up
- ❌ Database data persists, but in-memory data is lost on restart

**Important - Data Backup:**
Since you're using PostgreSQL, your user data (submissions, scores) is SAFE in the database. However, always download the admin export before shutting down.

---

## Recommendation

**For a college coding contest:**
1. **Testing phase**: Use **ngrok** (quick and easy)
2. **Actual contest**: Use **Render** (professional and reliable)
3. **Lab-only**: Use **Router port forwarding** (if ISP allows)

---

## Need Help?

- ngrok tutorial: https://ngrok.com/docs
- Render tutorial: https://render.com/docs
- Port forwarding guide: https://portforward.com/
