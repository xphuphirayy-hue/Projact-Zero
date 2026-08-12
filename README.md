# Project Zero : Whitelist

ระบบบอท Whitelist สำหรับ RobloxExecutor

## โครงสร้างไฟล์

- `whitelist.lua` - ระบบตรวจสอบ Whitelist ฝั่งลูกค้า
- `loader.lua` - ระบบโหลดอัตโนมัติ
- `server/server.js` - API ฝั่งเซิร์ฟเวอร์
- `server/admin.js` - แผงควบคุมผู้ดูแล
- `server/package.json` - Dependencies

## การติดตั้ง

### 1. ติดตั้ง Dependencies

```bash
cd server
npm install
```

### 2. ตั้งค่า Environment Variables

สร้างไฟล์ `.env` ในโฟลเดอร์ `server/`:

```env
PORT=3000
JWT_SECRET=your_secret_key_here
API_SECRET=your_api_secret_here
ADMIN_PASS=your_admin_password
ALLOWED_ORIGINS=*
```

### 3. เริ่มต้นเซิร์ฟเวอร์

```bash
# API Server
node server.js

# Admin Panel (ports 3001)
node admin.js
```

### 4. การใช้งานฝั่งลูกค้า

อัปเดต CONFIG ใน `whitelist.lua`:

```lua
CONFIG = {
    API_URL = "https://your-domain.com/api",
    SECRET_KEY = "your_secret_key",
    ...
}
```

## คุณสมบัติ

- ✅ HWID Binding
- ✅ Key Verification
- ✅ Expiry Check
- ✅ Anti-Debugger
- ✅ Background Re-verification
- ✅ Admin Dashboard
- ✅ Blacklist System
- ✅ Execution Logs
- ✅ Executor Whitelist

## Admin Panel

เข้าถึงได้ที่: `http://localhost:3001`

จัดการ:
- สร้าง/ลบ Key
- ดู Logs
- จัดการ Users
- Blacklist Keys/HWID
- ดูสถิติ

## License

MIT
