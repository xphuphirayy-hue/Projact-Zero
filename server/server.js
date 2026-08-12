require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_THIS_TO_YOUR_SECRET_KEY';
const API_SECRET = process.env.API_SECRET || 'CHANGE_THIS_TO_YOUR_API_SECRET';

// Middleware
app.use(helmet());
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { success: false, message: 'Too many requests' }
});
app.use('/api/', limiter);

// Strict rate limit for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { success: false, message: 'Too many authentication attempts' }
});

// Initialize SQLite Database
const db = new sqlite3.Database('./projectzero.db', (err) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Connected to SQLite database');
    }
});

// Create tables
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        rank TEXT DEFAULT 'user',
        is_banned INTEGER DEFAULT 0,
        ban_reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Keys table
    db.run(`CREATE TABLE IF NOT EXISTS keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_string TEXT UNIQUE NOT NULL,
        user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        is_active INTEGER DEFAULT 1,
        hwid TEXT,
        max_hwid_uses INTEGER DEFAULT 1,
        current_hwid_uses INTEGER DEFAULT 0,
        rank TEXT DEFAULT 'user',
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // HWID bindings table
    db.run(`CREATE TABLE IF NOT EXISTS hwid_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id INTEGER NOT NULL,
        hwid TEXT NOT NULL,
        first_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        use_count INTEGER DEFAULT 1,
        FOREIGN KEY (key_id) REFERENCES keys(id)
    )`);

    // Logs table
    db.run(`CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_string TEXT,
        hwid TEXT,
        status TEXT NOT NULL,
        executor TEXT,
        version TEXT,
        ip_address TEXT,
        user_agent TEXT,
        message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Blacklist table
    db.run(`CREATE TABLE IF NOT EXISTS blacklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        value TEXT NOT NULL,
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Getkey requests table
    db.run(`CREATE TABLE IF NOT EXISTS getkey_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        hwid TEXT,
        executor TEXT,
        status TEXT DEFAULT 'pending',
        work_status TEXT DEFAULT 'pending',
        work_type TEXT,
        work_proof TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Work links table
    db.run(`CREATE TABLE IF NOT EXISTS work_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT,
        description TEXT,
        is_completed INTEGER DEFAULT 0,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (request_id) REFERENCES getkey_requests(id)
    )`);

    // Claimed keys from getkey
    db.run(`CREATE TABLE IF NOT EXISTS claimed_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL,
        key_string TEXT NOT NULL,
        is_used INTEGER DEFAULT 0,
        used_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (request_id) REFERENCES getkey_requests(id)
    )`);
});

// ==========================================
-- AUTH MIDDLEWARE
-- ==========================================

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

function checkApiSecret(req, res, next) {
    const clientSecret = req.headers['x-api-secret'] || req.body.api_secret;
    
    if (!clientSecret || clientSecret !== API_SECRET) {
        return res.status(401).json({ success: false, message: 'Invalid API secret' });
    }
    next();
}

// ==========================================
-- UTILITY FUNCTIONS
-- ==========================================

function generateKey(length = 32) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function hashString(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
}

function isKeyBlacklisted(keyString) {
    return new Promise((resolve) => {
        db.get(
            'SELECT * FROM blacklist WHERE type = ? AND value = ? AND created_at > datetime("now", "-30 days")',
            ['key', keyString],
            (err, row) => {
                if (err) {
                    console.error('Blacklist check error:', err);
                    resolve(false);
                    return;
                }
                resolve(!!row);
            }
        );
    });
}

function isHWIDBlacklisted(hwid) {
    return new Promise((resolve) => {
        db.get(
            'SELECT * FROM blacklist WHERE type = ? AND value = ? AND created_at > datetime("now", "-30 days")',
            ['hwid', hwid],
            (err, row) => {
                if (err) {
                    console.error('Blacklist check error:', err);
                    resolve(false);
                    return;
                }
                resolve(!!row);
            }
        );
    });
}

function isExecutorAllowed(executor) {
    const allowedExecutors = process.env.ALLOWED_EXECUTORS 
        ? process.env.ALLOWED_EXECUTORS.split(',') 
        : ['Synapse X', 'Delta', 'Krnl', 'Fluxus', 'Electron', 'Velocity', 'Xeno'];
    
    return allowedExecutors.includes(executor);
}

// ==========================================
-- API ROUTES
-- ==========================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        status: 'online',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

// Verify Key (Main client endpoint)
app.post('/api/verify', async (req, res) => {
    const { key, hwid, version, executor } = req.body;

    // Validate input
    if (!key || !hwid) {
        return res.json({ 
            success: false, 
            message: 'Key and HWID are required' 
        });
    }

    // Check blacklists
    const keyBlacklisted = await isKeyBlacklisted(key);
    const hwidBlacklisted = await isHWIDBlacklisted(hwid);

    if (keyBlacklisted) {
        await logAttempt(key, hwid, 'BLACKLISTED_KEY', executor, version, req);
        return res.json({ 
            success: false, 
            message: 'Key has been blacklisted' 
        });
    }

    if (hwidBlacklisted) {
        await logAttempt(key, hwid, 'BLACKLISTED_HWID', executor, version, req);
        return res.json({ 
            success: false, 
            message: 'HWID has been blacklisted' 
        });
    }

    // Check if executor is allowed
    if (executor && !isExecutorAllowed(executor)) {
        await logAttempt(key, hwid, 'EXECUTOR_NOT_ALLOWED', executor, version, req);
        return res.json({ 
            success: false, 
            message: 'Executor not allowed' 
        });
    }

    // Find the key in database
    db.get(
        'SELECT * FROM keys WHERE key_string = ? AND is_active = 1',
        [key],
        async (err, keyRow) => {
            if (err || !keyRow) {
                await logAttempt(key, hwid, 'INVALID_KEY', executor, version, req);
                return res.json({ 
                    success: false, 
                    message: 'Invalid key' 
                });
            }

            // Check if key is expired
            if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
                await logAttempt(key, hwid, 'KEY_EXPIRED', executor, version, req);
                return res.json({ 
                    success: false, 
                    message: 'Key has expired' 
                });
            }

            // Check HWID usage
            if (keyRow.max_hwid_uses > 0) {
                const hwidCount = await new Promise((resolve) => {
                    db.get(
                        'SELECT COUNT(*) as count FROM hwid_bindings WHERE key_id = ? AND hwid = ?',
                        [keyRow.id, hwid],
                        (err, row) => resolve(row ? row.count : 0)
                    );
                });

                if (hwidCount === 0 && keyRow.current_hwid_uses >= keyRow.max_hwid_uses) {
                    await logAttempt(key, hwid, 'HWID_LIMIT_REACHED', executor, version, req);
                    return res.json({ 
                        success: false, 
                        message: 'Maximum HWID usage reached for this key' 
                        });
                }

                // If HWID not yet bound, bind it
                if (hwidCount === 0) {
                    db.run(
                        'INSERT INTO hwid_bindings (key_id, hwid) VALUES (?, ?)',
                        [keyRow.id, hwid],
                        (err) => {
                            if (!err) {
                                db.run(
                                    'UPDATE keys SET current_hwid_uses = current_hwid_uses + 1 WHERE id = ?',
                                    [keyRow.id]
                                );
                            }
                        }
                    );
                }
            }

            // Get user info
            db.get(
                'SELECT username, email, rank FROM users WHERE id = ?',
                [keyRow.user_id],
                async (err, user) => {
                    if (err || !user) {
                        await logAttempt(key, hwid, 'USER_NOT_FOUND', executor, version, req);
                        return res.json({ 
                            success: false, 
                            message: 'User not found' 
                        });
                    }

                    // Successful verification
                    const responseData = {
                        success: true,
                        message: 'Verification successful',
                        username: user.username,
                        email: user.email,
                        rank: keyRow.rank || user.rank,
                        expires_at: keyRow.expires_at,
                        key_id: keyRow.id
                    };

                    await logAttempt(key, hwid, 'SUCCESS', executor, version, req, user.username);

                    res.json(responseData);
                }
            );
        }
    );
});

// Check Key Status
app.post('/api/status', authenticateToken, (req, res) => {
    const { key, hwid } = req.body;

    if (!key) {
        return res.json({ success: false, message: 'Key is required' });
    }

    db.get(
        'SELECT k.*, u.username, u.rank as user_rank FROM keys k JOIN users u ON k.user_id = u.id WHERE k.key_string = ?',
        [key],
        (err, keyRow) => {
            if (err || !keyRow) {
                return res.json({ success: false, message: 'Key not found' });
            }

            const isExpired = keyRow.expires_at && new Date(keyRow.expires_at) < new Date();
            
            res.json({
                success: !isExpired && keyRow.is_active,
                message: isExpired ? 'Key expired' : 'Key active',
                username: keyRow.username,
                rank: keyRow.rank || keyRow.user_rank,
                expires_at: keyRow.expires_at,
                is_active: keyRow.is_active
            });
        }
    );
});

// ==========================================
-- GETKEY / WORK.LINK SYSTEM
-- ==========================================

// Create getkey request
app.post('/api/getkey/request', async (req, res) => {
    const { session_id, hwid, executor } = req.body;

    if (!session_id) {
        return res.json({ success: false, message: 'Session ID is required' });
    }

    // Check if session already has a pending/approved request
    db.get(
        'SELECT * FROM getkey_requests WHERE session_id = ? AND status IN (?, ?)',
        [session_id, 'pending', 'approved'],
        async (err, existing) => {
            if (err) {
                return res.status(500).json({ success: false, message: 'Database error' });
            }

            if (existing && existing.status === 'approved') {
                // Return existing approved key if not yet claimed
                db.get(
                    'SELECT * FROM claimed_keys WHERE request_id = ? AND is_used = 0',
                    [existing.id],
                    (err, claimed) => {
                        if (claimed) {
                            return res.json({
                                success: true,
                                status: 'approved',
                                message: 'Key already approved',
                                key: claimed.key_string
                            });
                        }
                    }
                );
            }

            if (existing && existing.status === 'pending') {
                return res.json({
                    success: true,
                    status: 'pending',
                    message: 'Request already pending',
                    request_id: existing.id
                });
            }

            // Create new request
            const workTasks = [
                { type: 'discord', url: 'https://discord.gg/your-server', title: 'Join Discord', description: 'Join our Discord server' },
                { type: 'youtube', url: 'https://youtube.com/@your-channel', title: 'Subscribe YouTube', description: 'Subscribe to our channel' },
                { type: 'telegram', url: 'https://t.me/your-channel', title: 'Join Telegram', description: 'Join our Telegram channel' }
            ];

            db.run(
                `INSERT INTO getkey_requests (session_id, hwid, executor, ip_address, user_agent, status) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    session_id,
                    hwid || null,
                    executor || null,
                    req.ip || req.connection.remoteAddress,
                    req.get('user-agent') || null,
                    'pending'
                ],
                function(err) {
                    if (err) {
                        return res.status(500).json({ success: false, message: 'Failed to create request' });
                    }

                    const requestId = this.lastID;

                    // Insert work links
                    const stmt = db.prepare('INSERT INTO work_links (request_id, type, url, title, description) VALUES (?, ?, ?, ?, ?)');
                    for (const task of workTasks) {
                        stmt.run(requestId, task.type, task.url, task.title, task.description);
                    }
                    stmt.finalize();

                    // Get work links for this request
                    db.all(
                        'SELECT * FROM work_links WHERE request_id = ?',
                        [requestId],
                        (err, links) => {
                            res.json({
                                success: true,
                                status: 'pending',
                                request_id: requestId,
                                message: 'Complete the tasks below to get your key',
                                tasks: links
                            });
                        }
                    );
                }
            );
        }
    );
});

// Complete work and get key
app.post('/api/getkey/complete', async (req, res) => {
    const { session_id, task_proofs } = req.body;

    if (!session_id) {
        return res.json({ success: false, message: 'Session ID is required' });
    }

    // Find pending request
    db.get(
        'SELECT * FROM getkey_requests WHERE session_id = ? AND status = ?',
        [session_id, 'pending'],
        async (err, request) => {
            if (err || !request) {
                return res.json({ success: false, message: 'No pending request found' });
            }

            // Get work links
            db.all(
                'SELECT * FROM work_links WHERE request_id = ?',
                [request.id],
                async (err, links) => {
                    if (err || !links || links.length === 0) {
                        return res.json({ success: false, message: 'No work tasks found' });
                    }

                    // Validate task proofs (simplified - in production, verify actual completion)
                    const requiredTypes = links.map(l => l.type);
                    const providedTypes = task_proofs ? Object.keys(task_proofs) : [];
                    
                    const allCompleted = requiredTypes.every(type => 
                        providedTypes.includes(type) && task_proofs[type] === true
                    );

                    if (!allCompleted && requiredTypes.length > 0) {
                        return res.json({
                            success: false,
                            message: 'All tasks must be completed',
                            pending: requiredTypes.filter(t => !providedTypes.includes(t))
                        });
                    }

                    // Mark all tasks as completed
                    const updateStmt = db.prepare('UPDATE work_links SET is_completed = 1, completed_at = ? WHERE request_id = ?');
                    updateStmt.run(new Date().toISOString(), request.id);
                    updateStmt.finalize();

                    // Generate key
                    const keyString = generateKey(32);
                    const keyHash = hashString(keyString);

                    // Create user if not exists
                    const username = 'getkey_' + session_id.substring(0, 8);
                    const email = session_id + '@getkey.local';
                    const passwordHash = bcrypt.hashSync(uuidv4(), 10);

                    db.get('SELECT id FROM users WHERE username = ?', [username], async (err, user) => {
                        let userId;
                        if (user) {
                            userId = user.id;
                        } else {
                            userId = await new Promise((resolve) => {
                                db.run(
                                    'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
                                    [username, email, passwordHash],
                                    function(err) {
                                        resolve(this.lastID);
                                    }
                                );
                            });
                        }

                        // Create key
                        const expiresAt = new Date();
                        expiresAt.setDate(expiresAt.getDate() + 30); // 30 days expiry

                        db.run(
                            'INSERT INTO keys (key_string, user_id, expires_at, rank, max_hwid_uses) VALUES (?, ?, ?, ?, ?)',
                            [keyHash, userId, expiresAt.toISOString(), 'user', 1],
                            function(err) {
                                if (err) {
                                    return res.status(500).json({ success: false, message: 'Failed to create key' });
                                }

                                // Save claimed key
                                db.run(
                                    'INSERT INTO claimed_keys (request_id, key_string) VALUES (?, ?)',
                                    [request.id, keyString]
                                );

                                // Update request status
                                db.run(
                                    'UPDATE getkey_requests SET status = ?, work_status = ?, updated_at = ? WHERE id = ?',
                                    ['approved', 'completed', new Date().toISOString(), request.id]
                                );

                                // Log
                                logAttempt(keyString, request.hwid, 'GETKEY_SUCCESS', request.executor, '1.0.0', req, username);

                                res.json({
                                    success: true,
                                    status: 'approved',
                                    message: 'Work completed! Here is your key',
                                    key: keyString,
                                    expires_at: expiresAt.toISOString(),
                                    rank: 'user'
                                });
                            }
                        );
                    });
                }
            );
        }
    );
});

// Check getkey status
app.get('/api/getkey/status/:sessionId', (req, res) => {
    const { sessionId } = req.params;

    db.get(
        'SELECT * FROM getkey_requests WHERE session_id = ? ORDER BY created_at DESC LIMIT 1',
        [sessionId],
        (err, request) => {
            if (err || !request) {
                return res.json({ success: false, message: 'Request not found' });
            }

            let keyInfo = null;
            if (request.status === 'approved') {
                db.get(
                    'SELECT * FROM claimed_keys WHERE request_id = ? AND is_used = 0',
                    [request.id],
                    (err, claimed) => {
                        if (claimed) {
                            keyInfo = { key: claimed.key_string, is_used: claimed.is_used };
                        }
                        res.json({
                            success: true,
                            status: request.status,
                            work_status: request.work_status,
                            key: keyInfo ? keyInfo.key : null
                        });
                    }
                );
                return;
            }

            res.json({
                success: true,
                status: request.status,
                work_status: request.work_status
            });
        }
    );
});

// Admin: Get all getkey requests
app.get('/api/admin/getkey', authenticateToken, (req, res) => {
    const { status, limit = 50 } = req.query;

    db.get('SELECT rank FROM users WHERE id = ?', [req.user.user_id], (err, admin) => {
        if (err || !admin || admin.rank !== 'admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        let query = 'SELECT * FROM getkey_requests';
        const params = [];

        if (status) {
            query += ' WHERE status = ?';
            params.push(status);
        }

        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(parseInt(limit));

        db.all(query, params, (err, rows) => {
            if (err) {
                return res.status(500).json({ success: false, message: 'Database error' });
            }
            res.json({ success: true, requests: rows });
        });
    });
});

// Admin: Generate Key
app.post('/api/admin/generate-key', authenticateToken, async (req, res) => {
    const { user_id, expires_at, rank, max_hwid_uses } = req.body;

    // Check if user is admin
    db.get('SELECT rank FROM users WHERE id = ?', [req.user.user_id], (err, admin) => {
        if (err || !admin || admin.rank !== 'admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        const keyString = generateKey(32);
        const hashedKey = hashString(keyString);

        db.run(
            'INSERT INTO keys (key_string, user_id, expires_at, rank, max_hwid_uses) VALUES (?, ?, ?, ?, ?)',
            [hashedKey, user_id, expires_at || null, rank || 'user', max_hwid_uses || 1],
            function(err) {
                if (err) {
                    return res.status(500).json({ success: false, message: 'Failed to generate key' });
                }

                res.json({
                    success: true,
                    key: keyString,
                    key_id: this.lastID,
                    expires_at: expires_at,
                    rank: rank || 'user'
                });
            }
        );
    });
});

// Admin: Get all keys
app.get('/api/admin/keys', authenticateToken, (req, res) => {
    db.get('SELECT rank FROM users WHERE id = ?', [req.user.user_id], (err, admin) => {
        if (err || !admin || admin.rank !== 'admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        db.all(
            `SELECT k.*, u.username 
             FROM keys k 
             JOIN users u ON k.user_id = u.id 
             ORDER BY k.created_at DESC`,
            (err, rows) => {
                if (err) {
                    return res.status(500).json({ success: false, message: 'Database error' });
                }
                res.json({ success: true, keys: rows });
            }
        );
    });
});

// Admin: Ban/Blacklist
app.post('/api/admin/blacklist', authenticateToken, (req, res) => {
    const { type, value, reason } = req.body;

    db.get('SELECT rank FROM users WHERE id = ?', [req.user.user_id], (err, admin) => {
        if (err || !admin || admin.rank !== 'admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        db.run(
            'INSERT OR IGNORE INTO blacklist (type, value, reason) VALUES (?, ?, ?)',
            [type, value, reason || 'No reason provided'],
            function(err) {
                if (err) {
                    return res.status(500).json({ success: false, message: 'Database error' });
                }
                res.json({ success: true, message: 'Added to blacklist' });
            }
        );
    });
});

// Admin: Get logs
app.get('/api/admin/logs', authenticateToken, (req, res) => {
    const { limit = 100, status } = req.query;

    db.get('SELECT rank FROM users WHERE id = ?', [req.user.user_id], (err, admin) => {
        if (err || !admin || admin.rank !== 'admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        let query = 'SELECT * FROM logs';
        const params = [];

        if (status) {
            query += ' WHERE status = ?';
            params.push(status);
        }

        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(parseInt(limit));

        db.all(query, params, (err, rows) => {
            if (err) {
                return res.status(500).json({ success: false, message: 'Database error' });
            }
            res.json({ success: true, logs: rows });
        });
    });
});

// ==========================================
-- HELPER FUNCTIONS
-- ==========================================

async function logAttempt(key, hwid, status, executor, version, req, username = null) {
    db.run(
        `INSERT INTO logs (key_string, hwid, status, executor, version, ip_address, user_agent) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            key ? hashString(key) : null,
            hwid || null,
            status,
            executor || null,
            version || null,
            req.ip || req.connection.remoteAddress,
            req.get('user-agent') || null
        ]
    );
}

// ==========================================
-- ERROR HANDLING
-- ==========================================

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
});

app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Endpoint not found' });
});

// ==========================================
-- START SERVER
// ==========================================

app.listen(PORT, () => {
    console.log(`[Project Zero API] Server running on port ${PORT}`);
    console.log(`[Project Zero API] Version: 1.0.0`);
    console.log(`[Project Zero API] Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
