# Deployment & Security Guide

This guide explains how to host your Coding Contest Platform on the cloud (so students can access it from anywhere) and how to prevent them from bypassing your JavaScript checks.

## Part 1: Hosting on the Cloud (The Easy Way)

To run this platform, you need a server that has **Node.js**, **G++**, **Python**, and **Java** installed. Most standard web hosts (repl.it, Vercel, Netlify) DO NOT support this easily.

We will use **Docker** to package everything (your code + all compilers) and run it on a cloud provider like **Render** or **Railway**.

### Step 1: Push Code to GitHub
1.  Create a new repository on [GitHub](https://github.com).
2.  Upload all your project files (including the `Dockerfile` I just created) to this repository.

### Step 2: Deploy on Render.com (Free Tier recommended for testing)
1.  Sign up at [Render.com](https://render.com).
2.  Click **"New +"** and select **"Web Service"**.
3.  Connect your GitHub repository.
4.  Render will detect the `Dockerfile`.
5.  Click **"Deploy"**.
6.  Render will build your app (this takes about 5-10 minutes because it installs all the compilers).
7.  Once done, it will give you a URL (e.g., `https://my-coding-contest.onrender.com`).
8.  **Share this URL** with your students.

### ⚠️ CRITICAL: Data Safety Warning
This platform stores all student data (scores, violations) in the **Server's RAM (Memory)**. It does NOT use a permanent database like SQL or MongoDB.

**What does this mean for you?**
1.  **If the server restarts, ALL DATA IS LOST.**
2.  **If you "Suspend" the service on Render, ALL DATA IS LOST.**
3.  **If you "Redeploy" your code, ALL DATA IS LOST.**

**YOUR RESPONSIBILITY:**
*   As soon as the exam ends (or even during the exam), go to the **Admin Panel** (`/admin.html`).
*   Click **"Export Report (Excel)"**.
*   Save that file to your computer.
*   **Do not stop/suspend the server until you have that file.**

### Part 1.5: Free Cloud Options (Compiler Support Required!)

Your project is special because it needs **C++, Python, and Java compilers** installed on the server. Most "standard" free hosts (like **Vercel** or **Netlify**) DO NOT have these compilers, so your code will fail there.

Here are the best **Free** options that support Docker (which we need):

1.  **Render.com (Best Option)**
    *   **Pros**: 100% Free tier, easy setup (just connect GitHub), supports Docker perfectly.
    *   **Cons**: The server goes to sleep after 15 minutes of inactivity. The first person to visit the site might wait ~30 seconds for it to wake up ("Cold Start").
    *   **Verdict**: Perfect for a college contest (just visit the site 5 mins before the exam starts to wake it up).

2.  **Fly.io**
    *   **Pros**: Free allowance, faster than Render.
    *   **Cons**: Requires installing a CLI tool on your laptop to deploy (a bit harder to set up).

3.  **Railway.app**
    *   **Pros**: Very easy, fast.
    *   **Cons**: Only gives a small amount of trial credit (keeps running out), not "forever free".

**Avoid These (They won't work):**
*   ❌ **Vercel / Netlify**: Great for websites, but they don't have C++ compilers installed. Your backend will crash when trying to run code.
*   ❌ **GitHub Pages**: Only hosts static HTML, cannot run a backend server at all.

---

## Part 2: Preventing Cheating (The Hard Part)

JavaScript checks (like tab switching detection) are "client-side". A smart CS student can bypass them by:
- Disabling JavaScript (which breaks the editor, so that's fine).
- Opening the developer console (F12) and deleting the alert code.
- Using a second device (phone/laptop).

### Solution: Safe Exam Browser (SEB) / Kiosk Mode
To strictly prevent bypassing, you cannot rely on a normal browser (Chrome/Edge). You need to force students to use a locked-down browser.

### Option A: Physical Invigilation (Best for College Labs)
- Ask students to sit in a lab.
- You (the proctor) walk around.
- If you see a phone or a different tab, disqualify them.
- This is 100% effective and costs $0.

### Option B: Safe Exam Browser (SEB)
[Safe Exam Browser](https://safeexambrowser.org/) is a free tool that turns a computer into a secure workstation. It prevents students from:
- Switching to other applications.
- Using shortcuts (Alt+Tab, Ctrl+C/V).
- Opening other websites.

**How to use SEB with your platform:**
1.  Download & Install SEB on all student computers.
2.  Create a configuration file (`.seb` file) using the SEB Config Tool.
    - **Start URL**: Set this to your deployed URL (e.g., `https://my-coding-contest.onrender.com`).
    - **Quit Password**: Set a password so they can't exit without your permission.
3.  Send the `.seb` file to students.
4.  When they open it, it launches your contest in full-screen lock-down mode.

### Option C: Update Your Code to Detect "User Agent" (Advanced)
You can modify `server.js` to ONLY accept requests from the Safe Exam Browser.

1.  In `server/server.js`, add a middleware:
    ```javascript
    app.use((req, res, next) => {
        const userAgent = req.headers['user-agent'];
        if (userAgent && userAgent.includes('SEB')) {
            next(); // Allow SEB
        } else {
            res.send('<h1>Access Denied: You must use Safe Exam Browser.</h1>');
        }
    });
    ```
2.  This prevents them from opening the link in Chrome or Edge.

---

## Summary Recommendation for Your College Contest

1.  **Deploy** the app to **Render** or **DigitalOcean** using the Dockerfile.
2.  **Install Safe Exam Browser** on the lab computers (or ask students to install it).
3.  **Create a SEB Config** pointing to your contest URL.
4.  **Run the contest**: Students launch the SEB file, log in, and code. They cannot switch tabs or copy-paste from ChatGPT.

Good luck!
