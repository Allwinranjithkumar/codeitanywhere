# 🏆 Anti-Cheat Coding Contest Platform

A complete web-based coding contest platform designed to prevent cheating through AI copy-pasting and tab switching. Perfect for college coding competitions with 30-100 students.

## ✨ Features

### Anti-Cheat Mechanisms
- ✅ **Copy-Paste Blocking** - Prevents Ctrl+C/V in browser
- ✅ **Tab Switch Detection** - Logs every time student switches tabs
- ✅ **Right-Click Disabled** - Prevents context menu access
- ✅ **DevTools Blocked** - F12 and inspect element disabled
- ✅ **Before Unload Warning** - Prevents accidental page closure

### Contest Features
- 📝 **Code Editor** - Syntax highlighting for Python, JavaScript, C++, Java
- ⚡ **Automatic Judging** - Tests code against multiple test cases
- 🏆 **Real-time Leaderboard** - Live rankings with scores
- ⏱️ **Timer** - Auto-submit when time expires
- 📊 **Admin Dashboard** - Monitor violations and submissions
- 🔒 **Secure Execution** - Sandboxed code execution with time limits

## 🚀 Quick Setup (15 minutes)

### Prerequisites
- Node.js (v14 or higher) - [Download here](https://nodejs.org/)
- Python 3 (for Python problems) - Usually pre-installed on Linux/Mac
- C++ compiler (optional, for C++ problems) - `sudo apt install g++` on Ubuntu
- Java (optional, for Java problems) - `sudo apt install default-jdk`

### Installation Steps

1. **Extract the project** (if you downloaded as ZIP)
   ```bash
   cd coding-contest
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the server**
   ```bash
   npm start
   ```

4. **Access the platform**
   - Student Portal: http://localhost:3000
   - Admin Panel: http://localhost:3000/admin.html

That's it! The platform is ready to use.

## 📝 Customizing Problems

Edit `problems/problems.json` to add your own problems:

```json
{
  "id": 5,
  "title": "Your Problem Title",
  "description": "<p>Problem description with HTML formatting</p>",
  "difficulty": "Medium",
  "points": 20,
  "testCases": [
    {
      "input": "sample input",
      "output": "expected output"
    }
  ]
}
```

**Important Notes:**
- First 2 test cases are shown to students (sample cases)
- All test cases are used during submission
- Input/output should be exact strings (including whitespace)
- Use `\n` for multi-line inputs

## 🎯 Contest Workflow

### For Organizers (You)

1. **Before Contest:**
   - Customize problems in `problems/problems.json`
   - Set contest duration in `public/app.js` (line 11: `timeRemaining = 3600`)
   - Test the platform yourself
   - Share the URL with students: `http://YOUR-IP:3000`

2. **During Contest:**
   - Monitor admin panel at `http://localhost:3000/admin.html`
   - Watch for violations in real-time
   - Check leaderboard for progress

3. **After Contest:**
   - Review submissions from admin panel
   - Export results (use browser save/print on admin panel)
   - Check violation logs for suspicious activity

### For Students

1. Navigate to the contest URL
2. Enter name and roll number
3. Start solving problems
4. Use "Run Code" to test with sample cases
5. Use "Submit" to submit final solution (tests all cases)
6. Check leaderboard anytime

## 🛡️ Anti-Cheat Details

### What Gets Detected:
- **Tab Switching** - Every Alt+Tab or window switch is logged
- **Copy-Paste Attempts** - Blocked and warned
- **Time on Page** - Tracked automatically
- **Submission Times** - Logged with timestamps

### What Students CANNOT Do:
- Copy code from ChatGPT/Copilot (paste is blocked)
- Switch to other tabs without detection
- Open DevTools to bypass restrictions
- Right-click to inspect code

### What Students CAN Do:
- Type code freely in the editor
- Run code to test with sample cases
- View problems and leaderboard
- Submit multiple times (best submission counts)

## 🌐 Deploying for Actual Contest

### Option 1: Local Network (Recommended for College Lab)
1. Connect all computers to same Wi-Fi/LAN
2. Find your IP: `ipconfig` (Windows) or `ifconfig` (Linux/Mac)
3. Start server on your computer
4. Students access: `http://YOUR-IP:3000`

### Option 2: Free Cloud Hosting

**Using Render.com (Free):**
1. Create account on render.com
2. Connect your GitHub repo
3. Deploy as Web Service
4. Students access your render URL

**Using Heroku (Free tier):**
1. Install Heroku CLI
2. Run: `heroku create`
3. Run: `git push heroku main`
4. Share the Heroku URL

### Option 3: College Server
Upload to your college's server and run with PM2:
```bash
npm install -g pm2
pm2 start server/server.js
pm2 save
```

## 📊 Admin Panel Features

Access at: `http://localhost:3000/admin.html`

- **Statistics Dashboard** - Live stats on students, submissions, violations
- **Leaderboard View** - See all rankings
- **Submissions Log** - Every submission with pass/fail status
- **Violation Tracker** - See which students switched tabs most

## 🔧 Configuration

### Change Contest Duration
Edit `public/app.js`, line 11:
```javascript
let timeRemaining = 3600; // 3600 seconds = 60 minutes
```

### Change Port
Edit `server/server.js`, line 8:
```javascript
const PORT = 3000; // Change to any port
```

### Add More Languages
1. Install language compiler (e.g., Ruby, Go)
2. Add executor function in `server/server.js`
3. Add language mode in `public/index.html`

## 🐛 Troubleshooting

### "npm install" fails
- Make sure Node.js is installed: `node --version`
- Try: `npm install --legacy-peer-deps`

### "Cannot execute Python code"
- Install Python 3: `python3 --version`
- Make sure it's in PATH

### Students can't access the site
- Check firewall settings
- Make sure all devices are on same network
- Use your actual IP, not `localhost`

### Code execution timeout
- Increase timeout in `server/server.js` (search for `timeout: 5000`)
- Default is 5 seconds, increase to 10000 for complex problems

## 📜 License

Free to use for educational purposes. Modify as needed for your contest!

## 🙋 Support

For issues or questions:
1. Check this README thoroughly
2. Test with the sample problems first
3. Verify all prerequisites are installed

## 🎓 Tips for Success

1. **Test Before Contest** - Run a practice round with 5-10 students
2. **Communicate Rules** - Tell students about anti-cheat features
3. **Set Expectations** - Explain violation logging beforehand
4. **Have Backups** - Keep problems in separate file
5. **Monitor Actively** - Watch admin panel during contest

Good luck with your contest! 🚀
