require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_THIS_TO_YOUR_SECRET_KEY';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

// Middleware
app.use(helmet({
    contentSecurityPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session
app.use(session({
    secret: JWT_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Initialize SQLite Database
const db = new sqlite3.Database('./projectzero.db', (err) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Connected to SQLite database');
    }
});

// ==========================================
-- ADMIN MIDDLEWARE
-- ==========================================

function requireAdmin(req, res, next) {
    if (!req.session.isAdmin) {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    next();
}

// ==========================================
-- AUTH ROUTES
-- ==========================================

app.post('/api/admin/login', async (req, res) => {
    const { password } = req.body;

    if (password !== ADMIN_PASS) {
        return res.json({ success: false, message: 'Invalid password' });
    }

    const token = jwt.sign({ isAdmin: true }, JWT_SECRET, { expiresIn: '24h' });
    req.session.isAdmin = true;

    res.json({ success: true, token, message: 'Login successful' });
});

app.post('/api/admin/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Logout failed' });
        }
        res.json({ success: true, message: 'Logout successful' });
    });
});

app.get('/api/admin/check', (req, res) => {
    res.json({ success: true, isAdmin: !!req.session.isAdmin });
});

// ==========================================
-- DASHBOARD ROUTES
-- ==========================================

app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
    const stats = {};

    // Total users
    db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
        stats.totalUsers = row ? row.count : 0;

        // Total keys
        db.get('SELECT COUNT(*) as count FROM keys', (err, row) => {
            stats.totalKeys = row ? row.count : 0;

            // Active keys
            db.get('SELECT COUNT(*) as count FROM keys WHERE is_active = 1', (err, row) => {
                stats.activeKeys = row ? row.count : 0;

                // Total HWID bindings
                db.get('SELECT COUNT(*) as count FROM hwid_bindings', (err, row) => {
                    stats.totalBindings = row ? row.count : 0;

                    // Today's verifications
                    db.get(
                        'SELECT COUNT(*) as count FROM logs WHERE created_at >= datetime("now", "start of day") AND status = ?',
                        ['SUCCESS'],
                        (err, row) => {
                            stats.todayVerifications = row ? row.count : 0;

                            // Recent logs
                            db.all(
                                'SELECT * FROM logs ORDER BY created_at DESC LIMIT 10',
                                (err, recentLogs) => {
                                    stats.recentLogs = recentLogs || [];

                                    res.json({ success: true, stats });
                                }
                            );
                        }
                    );
                });
            });
        });
    });
});

// ==========================================
-- KEY MANAGEMENT
-- =========================================--

app.get('/api/admin/keys', requireAdmin, (req, res) => {
    const { page = 1, limit = 50, search = '' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `SELECT k.*, u.username 
                 FROM keys k 
                 JOIN users u ON k.user_id = u.id`;
    const params = [];

    if (search) {
        query += ' WHERE k.key_string LIKE ? OR u.username LIKE ?';
        params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY k.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    db.all(query, params, (err, keys) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error' });
        }

        // Get total count
        let countQuery = 'SELECT COUNT(*) as total FROM keys k JOIN users u ON k.user_id = u.id';
        if (search) {
            countQuery += ' WHERE k.key_string LIKE ? OR u.username LIKE ?';
        }

        db.get(countQuery, search ? [`%${search}%`, `%${search}%`] : [], (err, countRow) => {
            res.json({
                success: true,
                keys: keys,
                total: countRow ? countRow.total : 0,
                page: parseInt(page),
                pages: Math.ceil((countRow ? countRow.total : 0) / parseInt(limit))
            });
        });
    });
});

app.post('/api/admin/keys/generate', requireAdmin, (req, res) => {
    const { username, email, rank = 'user', expires_at, max_hwid_uses = 1 } = req.body;

    if (!username || !email) {
        return res.json({ success: false, message: 'Username and email are required' });
    }

    // Hash password
    const password = uuidv4().substring(0, 8);
    const passwordHash = bcrypt.hashSync(password, 10);

    // Create or get user
    db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email], async (err, user) => {
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

        // Generate key
        const keyString = generateRandomString(32);
        const keyHash = hashString(keyString);

        db.run(
            'INSERT INTO keys (key_string, user_id, expires_at, rank, max_hwid_uses) VALUES (?, ?, ?, ?, ?)',
            [keyHash, userId, expires_at || null, rank, max_hwid_uses],
            function(err) {
                if (err) {
                    return res.status(500).json({ success: false, message: 'Failed to generate key' });
                }

                res.json({
                    success: true,
                    key: keyString,
                    key_id: this.lastID,
                    username: username,
                    email: email,
                    rank: rank,
                    expires_at: expires_at || 'Never',
                    password: password
                });
            }
        );
    });
});

app.post('/api/admin/keys/delete', requireAdmin, (req, res) => {
    const { key_id } = req.body;

    db.run('DELETE FROM hwid_bindings WHERE key_id = ?', [key_id], (err) => {
        db.run('DELETE FROM keys WHERE id = ?', [key_id], function(err) {
            if (err) {
                return res.status(500).json({ success: false, message: 'Database error' });
            }
            res.json({ success: true, message: 'Key deleted' });
        });
    });
});

// ==========================================
-- USER MANAGEMENT
-- ==========================================

app.get('/api/admin/users', requireAdmin, (req, res) => {
    db.all(
        `SELECT u.*, COUNT(k.id) as key_count 
         FROM users u 
         LEFT JOIN keys k ON u.id = k.user_id 
         GROUP BY u.id 
         ORDER BY u.created_at DESC`,
        (err, users) => {
            if (err) {
                return res.status(500).json({ success: false, message: 'Database error' });
            }
            res.json({ success: true, users });
        }
    );
});

app.post('/api/admin/users/ban', requireAdmin, (req, res) => {
    const { user_id, reason } = req.body;

    db.run(
        'UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?',
        [reason || 'No reason', user_id],
        function(err) {
            if (err) {
                return res.status(500).json({ success: false, message: 'Database error' });
            }
            res.json({ success: true, message: 'User banned' });
        }
    );
});

app.post('/api/admin/users/unban', requireAdmin, (req, res) => {
    db.run(
        'UPDATE users SET is_banned = 0, ban_reason = NULL WHERE id = ?',
        [req.body.user_id],
        function(err) {
            if (err) {
                return res.status(500).json({ success: false, message: 'Database error' });
            }
            res.json({ success: true, message: 'User unbanned' });
        }
    );
});

// ==========================================
-- BLACKLIST MANAGEMENT
-- ==========================================

app.get('/api/admin/blacklist', requireAdmin, (req, res) => {
    db.all('SELECT * FROM blacklist ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.json({ success: true, blacklist: rows });
    });
});

app.post('/api/admin/blacklist', requireAdmin, (req, res) => {
    const { type, value, reason } = req.body;

    if (!type || !value) {
        return res.json({ success: false, message: 'Type and value are required' });
    }

    db.run(
        'INSERT OR IGNORE INTO blacklist (type, value, reason) VALUES (?, ?, ?)',
        [type, value, reason || 'No reason'],
        function(err) {
            if (err) {
                return res.status(500).json({ success: false, message: 'Database error' });
            }
            res.json({ success: true, message: 'Added to blacklist' });
        }
    );
});

app.delete('/api/admin/blacklist/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM blacklist WHERE id = ?', [req.params.id], function(err) {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.json({ success: true, message: 'Removed from blacklist' });
    });
});

// ==========================================
-- LOGS
-- ==========================================

app.get('/api/admin/logs', requireAdmin, (req, res) => {
    const { status, executor, limit = 100 } = req.query;

    let query = 'SELECT * FROM logs';
    const conditions = [];
    const params = [];

    if (status) {
        conditions.push('status = ?');
        params.push(status);
    }
    if (executor) {
        conditions.push('executor = ?');
        params.push(executor);
    }

    if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    db.all(query, params, (err, logs) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.json({ success: true, logs });
    });
});

// ==========================================
-- UTILITY FUNCTIONS
-- ==========================================

function generateRandomString(length) {
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

// ==========================================
-- START SERVER
-- ==========================================

app.listen(PORT, () => {
    console.log(`[Project Zero Admin] Dashboard running on port ${PORT}`);
    console.log(`[Project Zero Admin] URL: http://localhost:${PORT}`);
});

module.exports = app;
