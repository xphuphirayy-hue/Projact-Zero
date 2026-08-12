# Project Zero : Whitelist

ระบบบอท Whitelist สำหรับ RobloxExecutor พร้อมระบบ Getkey/Work.link

## โครงสร้างไฟล์

- `whitelist.lua` - ระบบตรวจสอบ Whitelist ฝั่งลูกค้า
- `loader.lua` - ระบบโหลดอัตโนมัติ
- `server/server.js` - API ฝั่งเซิร์ฟเวอร์ (Verify, Status, Getkey, Work.link)
- `server/admin.js` - แผงควบคุมผู้ดูแล
- `server/package.json` - Dependencies
- `server/public/index.html` - หน้า Getkey/Work.link

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
# API Server (รวม Work.link page)
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
    GETKEY_ENABLED = true,
    GETKEY_URL = "https://your-domain.com/getkey",
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
- ✅ Getkey System
- ✅ Work.link Integration

## ระบบ Getkey / Work.link

### การทำงาน

1. ผู้ใช้เปิดสคริปต์ -> กดปุ่ม "GET KEY"
2. สคริปต์ส่ง session_id ไปยัง API
3. API สร้าง Work tasks (Join Discord, Subscribe YouTube, etc.)
4. ผู้ใช้เปิดเว็บเพจ `/getkey` และทำตาม tasks
5. หลังจากทำครบ -> กดปุ่ม Complete -> ได้ Key
6. ผู้ใช้นำ Key ใส่ในสคริปต์ -> ยืนยัน Whitelist

### การตั้งค่า Work Tasks

แก้ไขใน `server/server.js` บรรทัดที่สร้าง tasks:

```javascript
const workTasks = [
    { type: 'discord', url: 'https://discord.gg/your-server', title: 'Join Discord', description: 'Join our Discord server' },
    { type: 'youtube', url: 'https://youtube.com/@your-channel', title: 'Subscribe YouTube', description: 'Subscribe to our channel' },
    { type: 'telegram', url: 'https://t.me/your-channel', title: 'Join Telegram', description: 'Join our Telegram channel' }
];
```

### API Endpoints

- `POST /api/getkey/request` - สร้างคำขอรับ Key
- `POST /api/getkey/complete` - ทำตาม tasks แล้วรับ Key
- `GET /api/getkey/status/:sessionId` - เช็คสถานะ
- `GET /getkey` - หน้าเว็บสำหรับทำ tasks

## Admin Panel

เข้าถึงได้ที่: `http://localhost:3001`

จัดการ:
- สร้าง/ลบ Key
- ดู Logs
- จัดการ Users
- Blacklist Keys/HWID
- ดูสถิติ
- ดู Getkey requests

## License

MIT
