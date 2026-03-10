<?php
/**
 * Claude Collab Chatroom API — SQLite Backend
 *
 * GET  ?action=messages[&since=ID][&limit=N][&session=current|ID]  → return messages (with attachments)
 * GET  ?action=pending&for=<name>             → unread messages mentioning participant
 * GET  ?action=history&mode=full|since&since=N → summary + recent messages (for AI context)
 * GET  ?action=state                          → session state (active, typing, exchange count)
 * GET  ?action=status                         → participant busy/idle status
 * GET  ?action=presence                        → Rob's presence state
 * GET  ?action=sessions                        → list all sessions with message counts
 * GET  ?action=conversations&for=<name>        → list DM conversations for a participant
 * GET  ?action=dm_messages&conversation_id=N[&since=N][&limit=N] → get DM messages
 * GET  ?action=attachments&message_id=N|dm_message_id=N → get attachments for a message
 * POST {from, content}                        → add a chatroom message
 * POST {action: "status", id, status, by}     → update message delivery status
 * POST {action: "set_status", participant, state} → set participant busy/idle
 * POST {action: "typing", participant}         → typing heartbeat
 * POST {action: "heartbeat"}                   → Rob's presence heartbeat (tab focused)
 * POST {action: "session", state}              → set session active/paused
 * POST {action: "summary", summary_text, covers_up_to} → store a summary
 * POST {action: "dm", from, to, content}       → send a direct message
 * POST {action: "create_conversation", from, with} → create/find a DM conversation
 * POST {action: "dm_read", conversation_id, reader} → mark DMs as read
 * POST {action: "upload"} (multipart form)     → upload a file attachment
 */

header('Content-Type: application/json');
header('Cache-Control: no-cache, no-store, must-revalidate');
$allowedOrigins = ['http://localhost', 'http://127.0.0.1'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowedOrigins)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// --- Participant Registry (single source of truth) ---
const PARTICIPANTS_ALL = ['Rob', 'Soren', 'Atlas', 'Web', 'System', 'Ellison'];
const PARTICIPANTS_AI  = ['Soren', 'Atlas', 'Ellison'];  // AI participants (for status, routing)
const PARTICIPANTS_ACTIVE_AI = ['Soren', 'Atlas'];        // Auto-responding AIs (@all targets)

// --- Database ---
$DB_PATH = __DIR__ . '/chatroom.db';

function getDb(string $path): PDO {
    $isNew = !file_exists($path);
    $db = new PDO('sqlite:' . $path);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $db->exec('PRAGMA journal_mode=WAL');
    $db->exec('PRAGMA synchronous=NORMAL');
    $db->exec('PRAGMA busy_timeout=5000');
    if ($isNew) {
        initDb($db);
    }
    return $db;
}

function initDb(PDO $db): void {
    $db->exec("
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            participant TEXT NOT NULL,
            content TEXT NOT NULL,
            mentions TEXT DEFAULT '[]',
            status TEXT DEFAULT 'pending',
            read_by TEXT DEFAULT '[]',
            timestamp TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            token_estimate INTEGER DEFAULT 0,
            session_id INTEGER DEFAULT NULL,
            has_attachment INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            ended_at TEXT DEFAULT NULL,
            title TEXT DEFAULT NULL
        );

        CREATE TABLE IF NOT EXISTS summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            covers_up_to_message_id INTEGER NOT NULL,
            summary_text TEXT NOT NULL,
            token_estimate INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS session_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_messages_participant ON messages(participant);
        CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

        CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            participant_a TEXT NOT NULL,
            participant_b TEXT NOT NULL,
            created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            last_message_at TEXT DEFAULT NULL,
            last_message_preview TEXT DEFAULT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_pair ON conversations(participant_a, participant_b);

        CREATE TABLE IF NOT EXISTS dm_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            sender TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            read_at TEXT DEFAULT NULL,
            has_attachment INTEGER DEFAULT 0,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id)
        );
        CREATE INDEX IF NOT EXISTS idx_dm_messages_convo ON dm_messages(conversation_id);

        CREATE TABLE IF NOT EXISTS file_attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER DEFAULT NULL,
            dm_message_id INTEGER DEFAULT NULL,
            filename TEXT NOT NULL,
            original_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            uploaded_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            uploaded_by TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_attachments_message ON file_attachments(message_id);
        CREATE INDEX IF NOT EXISTS idx_attachments_dm ON file_attachments(dm_message_id);

        CREATE TABLE IF NOT EXISTS rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_by TEXT NOT NULL DEFAULT 'Rob',
            created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            conversation_state TEXT DEFAULT 'active',
            last_message_at TEXT DEFAULT NULL,
            last_message_preview TEXT DEFAULT NULL,
            archived INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS room_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER NOT NULL,
            participant TEXT NOT NULL,
            added_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            FOREIGN KEY (room_id) REFERENCES rooms(id),
            UNIQUE(room_id, participant)
        );
        CREATE INDEX IF NOT EXISTS idx_room_members_room ON room_members(room_id);
        CREATE INDEX IF NOT EXISTS idx_room_members_participant ON room_members(participant);
        CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id);
    ");

    // Initialize session state defaults
    $defaults = [
        'session_active' => 'false',
        'exchange_counter' => '0',
        'exchange_cap' => '6',
        'last_rob_message_at' => '',
        'rob_typing_at' => '',
        'participant_status_Soren' => 'idle',
        'participant_status_Atlas' => 'idle',
        'participant_status_Web' => 'idle',
        'participant_status_Ellison' => 'idle',
        'rob_heartbeat_at' => '',
        'rob_focused' => 'false',
        'conversation_state' => 'active',
        'current_session_id' => '',
        'watcher_heartbeat_at' => '',
        'watcher_pid' => '',
        'session_ended_explicitly' => 'false',
    ];
    $stmt = $db->prepare("INSERT OR IGNORE INTO session_state (key, value) VALUES (?, ?)");
    foreach ($defaults as $k => $v) {
        $stmt->execute([$k, $v]);
    }
}

function getState(PDO $db, string $key): string {
    $stmt = $db->prepare("SELECT value FROM session_state WHERE key = ?");
    $stmt->execute([$key]);
    $row = $stmt->fetch();
    return $row ? $row['value'] : '';
}

function setState(PDO $db, string $key, string $value): void {
    $stmt = $db->prepare("INSERT INTO session_state (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at");
    $stmt->execute([$key, $value]);
}

function estimateTokens(string $text): int {
    return (int)ceil(strlen($text) / 4);
}

// --- Migration for existing databases ---
function migrateDb(PDO $db): void {
    // Add sessions table if missing
    $db->exec("
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            ended_at TEXT DEFAULT NULL,
            title TEXT DEFAULT NULL
        );
    ");

    // Add session_id column to messages if missing
    $cols = $db->query("PRAGMA table_info(messages)")->fetchAll();
    $colNames = array_column($cols, 'name');
    if (!in_array('session_id', $colNames)) {
        $db->exec("ALTER TABLE messages ADD COLUMN session_id INTEGER DEFAULT NULL");
    }

    // Index after column exists
    $db->exec("CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)");

    // Add missing session_state keys
    $stmt = $db->prepare("INSERT OR IGNORE INTO session_state (key, value) VALUES (?, ?)");
    $stmt->execute(['current_session_id', '']);
    $stmt->execute(['watcher_heartbeat_at', '']);
    $stmt->execute(['watcher_pid', '']);
    $stmt->execute(['session_ended_explicitly', 'false']);
    $stmt->execute(['conversation_state', 'active']);

    // Add conversations table
    $db->exec("
        CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            participant_a TEXT NOT NULL,
            participant_b TEXT NOT NULL,
            created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            last_message_at TEXT DEFAULT NULL,
            last_message_preview TEXT DEFAULT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_pair ON conversations(participant_a, participant_b);
    ");

    // Add dm_messages table
    $db->exec("
        CREATE TABLE IF NOT EXISTS dm_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            sender TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            read_at TEXT DEFAULT NULL,
            has_attachment INTEGER DEFAULT 0,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id)
        );
        CREATE INDEX IF NOT EXISTS idx_dm_messages_convo ON dm_messages(conversation_id);
    ");

    // Add file_attachments table
    $db->exec("
        CREATE TABLE IF NOT EXISTS file_attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER DEFAULT NULL,
            dm_message_id INTEGER DEFAULT NULL,
            filename TEXT NOT NULL,
            original_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            uploaded_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            uploaded_by TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_attachments_message ON file_attachments(message_id);
        CREATE INDEX IF NOT EXISTS idx_attachments_dm ON file_attachments(dm_message_id);
    ");

    // Add has_attachment column to messages if missing
    $msgCols = $db->query("PRAGMA table_info(messages)")->fetchAll();
    $msgColNames = array_column($msgCols, 'name');
    if (!in_array('has_attachment', $msgColNames)) {
        $db->exec("ALTER TABLE messages ADD COLUMN has_attachment INTEGER DEFAULT 0");
    }

    // Add rooms tables
    $db->exec("
        CREATE TABLE IF NOT EXISTS rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_by TEXT NOT NULL DEFAULT 'Rob',
            created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            conversation_state TEXT DEFAULT 'active',
            last_message_at TEXT DEFAULT NULL,
            last_message_preview TEXT DEFAULT NULL,
            archived INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS room_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER NOT NULL,
            participant TEXT NOT NULL,
            added_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            FOREIGN KEY (room_id) REFERENCES rooms(id),
            UNIQUE(room_id, participant)
        );
        CREATE INDEX IF NOT EXISTS idx_room_members_room ON room_members(room_id);
        CREATE INDEX IF NOT EXISTS idx_room_members_participant ON room_members(participant);
    ");

    // Add room_id column to messages if missing
    if (!in_array('room_id', $msgColNames)) {
        $db->exec("ALTER TABLE messages ADD COLUMN room_id INTEGER DEFAULT NULL");
    }
    $db->exec("CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id)");

    // One-time migration: assign orphan NULL-session messages to session 1
    // This prevents historical messages from bleeding into every new session's AI context
    $orphanCount = $db->query("SELECT COUNT(*) as cnt FROM messages WHERE session_id IS NULL")->fetch()['cnt'];
    if ($orphanCount > 0) {
        // Ensure session 1 exists
        $s1 = $db->query("SELECT id FROM sessions WHERE id = 1")->fetch();
        if (!$s1) {
            $db->exec("INSERT INTO sessions (id, started_at, ended_at, title) VALUES (1, '2026-01-01T00:00:00.000Z', '2026-02-24T00:00:00.000Z', 'Historical messages')");
        } elseif (!$db->query("SELECT ended_at FROM sessions WHERE id = 1")->fetch()['ended_at']) {
            $db->exec("UPDATE sessions SET ended_at = '2026-02-24T00:00:00.000Z', title = 'Historical messages' WHERE id = 1");
        }
        $db->exec("UPDATE messages SET session_id = 1 WHERE session_id IS NULL");
    }
}

// Get current session ID (or null if none active)
function getCurrentSessionId(PDO $db): ?int {
    $val = getState($db, 'current_session_id');
    return $val !== '' ? (int)$val : null;
}

// Create a new session, close any dangling ones first
function startSession(PDO $db): int {
    // Close zombie sessions (ended_at IS NULL)
    $zombies = $db->query("SELECT id FROM sessions WHERE ended_at IS NULL")->fetchAll();
    foreach ($zombies as $z) {
        // Set ended_at to the last message timestamp in that session
        $lastMsg = $db->prepare("SELECT timestamp FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 1");
        $lastMsg->execute([$z['id']]);
        $last = $lastMsg->fetch();
        $endTime = $last ? $last['timestamp'] : gmdate('Y-m-d\TH:i:s\Z');
        $db->prepare("UPDATE sessions SET ended_at = ? WHERE id = ?")->execute([$endTime, $z['id']]);
    }

    // Create new session
    $db->exec("INSERT INTO sessions (started_at) VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))");
    $sessionId = (int)$db->lastInsertId();
    setState($db, 'current_session_id', (string)$sessionId);
    return $sessionId;
}

// Close the current session
function endSession(PDO $db): void {
    $sessionId = getCurrentSessionId($db);
    if ($sessionId !== null) {
        $db->prepare("UPDATE sessions SET ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")->execute([$sessionId]);
        setState($db, 'current_session_id', '');
    }
}

// Watcher runs as a standalone process in Rob's user session.
// PHP only toggles session_active — watcher sees the flag on next poll.

$db = getDb($DB_PATH);
migrateDb($db);

// --- Uploads directory ---
$uploadsDir = __DIR__ . '/uploads';
if (!is_dir($uploadsDir)) {
    mkdir($uploadsDir, 0755, true);
}

// --- Helper: find or create conversation (always store alphabetically-first name as participant_a) ---
function findOrCreateConversation(PDO $db, string $nameA, string $nameB): array {
    $pA = (strcmp($nameA, $nameB) <= 0) ? $nameA : $nameB;
    $pB = ($pA === $nameA) ? $nameB : $nameA;

    $stmt = $db->prepare("SELECT * FROM conversations WHERE participant_a = ? AND participant_b = ?");
    $stmt->execute([$pA, $pB]);
    $convo = $stmt->fetch();
    if ($convo) {
        return $convo;
    }

    $stmt = $db->prepare("INSERT INTO conversations (participant_a, participant_b) VALUES (?, ?)");
    $stmt->execute([$pA, $pB]);
    $id = (int)$db->lastInsertId();

    $stmt = $db->prepare("SELECT * FROM conversations WHERE id = ?");
    $stmt->execute([$id]);
    return $stmt->fetch();
}

// --- Helper: get attachments for an array of message IDs (chatroom messages) ---
function getAttachmentsForMessages(PDO $db, array $messageIds): array {
    if (empty($messageIds)) return [];
    $placeholders = implode(',', array_fill(0, count($messageIds), '?'));
    $stmt = $db->prepare("SELECT * FROM file_attachments WHERE message_id IN ($placeholders)");
    $stmt->execute($messageIds);
    $rows = $stmt->fetchAll();
    $map = [];
    foreach ($rows as $row) {
        $row['url'] = 'uploads/' . $row['filename'];
        $map[$row['message_id']][] = $row;
    }
    return $map;
}

// --- Helper: get attachments for an array of DM message IDs ---
function getAttachmentsForDmMessages(PDO $db, array $dmMessageIds): array {
    if (empty($dmMessageIds)) return [];
    $placeholders = implode(',', array_fill(0, count($dmMessageIds), '?'));
    $stmt = $db->prepare("SELECT * FROM file_attachments WHERE dm_message_id IN ($placeholders)");
    $stmt->execute($dmMessageIds);
    $rows = $stmt->fetchAll();
    $map = [];
    foreach ($rows as $row) {
        $row['url'] = 'uploads/' . $row['filename'];
        $map[$row['dm_message_id']][] = $row;
    }
    return $map;
}

// --- Helper: validate participant name ---
function isValidParticipant(string $name): bool {
    if (in_array($name, PARTICIPANTS_ALL)) return true;
    return (bool)preg_match('/^[a-zA-Z0-9 _\-\[\]]{1,20}$/', $name);
}

// --- GET ---
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? 'messages';

    // --- Messages (with optional since/limit/session) ---
    if ($action === 'messages') {
        $since = (int)($_GET['since'] ?? 0);
        $limit = (int)($_GET['limit'] ?? 0);
        $session = $_GET['session'] ?? '';
        $includeHistory = ($_GET['include_history'] ?? 'false') === 'true';
        $roomId = isset($_GET['room_id']) ? (int)$_GET['room_id'] : null;

        $sql = "SELECT * FROM messages";
        $params = [];
        $conditions = [];

        // Room filtering: specific room_id, or lobby (NULL) by default
        if ($roomId !== null) {
            $conditions[] = "room_id = ?";
            $params[] = $roomId;
        } else {
            $conditions[] = "room_id IS NULL";
        }

        if ($since > 0) {
            $conditions[] = "id > ?";
            $params[] = $since;
        }

        // Session filtering:
        // - Default behavior (no parameters): return only current session (lightweight poll)
        // - ?include_history=true: return all sessions (opt-in for Show History toggle)
        // - ?session=current: explicit current session filter
        // - ?session=N: specific session ID
        if (!$includeHistory) {
            if ($session === '' || $session === 'current') {
                // Default: current session only
                $currentId = getCurrentSessionId($db);
                if ($currentId !== null) {
                    $conditions[] = "session_id = ?";
                    $params[] = $currentId;
                }
            } elseif (is_numeric($session)) {
                // Specific session ID
                $conditions[] = "session_id = ?";
                $params[] = (int)$session;
            }
        }
        // If include_history=true, no session filter — return all messages

        if (count($conditions) > 0) {
            $sql .= " WHERE " . implode(" AND ", $conditions);
        }

        $sql .= " ORDER BY id ASC";

        if ($limit > 0) {
            $sql .= " LIMIT ?";
            $params[] = $limit;
        }

        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        $messages = $stmt->fetchAll();

        // Decode JSON fields
        foreach ($messages as &$m) {
            $m['mentions'] = json_decode($m['mentions'], true) ?? [];
            $m['read_by'] = json_decode($m['read_by'], true) ?? [];
        }
        unset($m);

        // Always initialize attachments array, and merge in file data for messages that have them
        $withAttachments = array_filter($messages, fn($m) => !empty($m['has_attachment']));
        $attachMap = !empty($withAttachments) ? getAttachmentsForMessages($db, array_column($withAttachments, 'id')) : [];
        foreach ($messages as &$m) {
            $m['attachments'] = $attachMap[$m['id']] ?? [];
        }
        unset($m);

        $countStmt = $db->query("SELECT COUNT(*) as cnt FROM messages");
        $total = $countStmt->fetch()['cnt'];

        echo json_encode([
            'ok' => true,
            'messages' => $messages,
            'count' => count($messages),
            'total' => (int)$total,
            'session_id' => getCurrentSessionId($db)
        ], JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }

    // --- Pending (for trigger system) ---
    if ($action === 'pending') {
        $for = $_GET['for'] ?? '';
        if ($for === '' || !isValidParticipant($for)) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Missing or invalid "for" parameter']);
            exit;
        }

        // Check session state for pause conditions (batched query)
        $stateStmt = $db->query("SELECT key, value FROM session_state WHERE key IN ('session_active', 'rob_typing_at', 'rob_heartbeat_at')");
        $stateRows = $stateStmt->fetchAll();
        $stateMap = [];
        foreach ($stateRows as $row) $stateMap[$row['key']] = $row['value'];

        $sessionActive = ($stateMap['session_active'] ?? 'false') === 'true';
        $robTypingAt = $stateMap['rob_typing_at'] ?? '';
        $robTypingTs = ($robTypingAt !== '') ? strtotime($robTypingAt) : false;
        $robTypingRecently = ($robTypingTs !== false) && (time() - $robTypingTs) < 10;

        // Presence check: heartbeat within 5 minutes
        $heartbeatAt = $stateMap['rob_heartbeat_at'] ?? '';
        $robPresent = false;
        if ($heartbeatAt !== '') {
            $robPresent = (time() - strtotime($heartbeatAt)) < 300;
        }
        $paused = !$sessionActive || !$robPresent || $robTypingRecently;

        // Safe LIKE query — $for is validated against allowlist above
        // Filter to current session only (orphan NULL messages have been migrated to session 1)
        // Optional room_id filter for room-scoped pending
        $currentId = getCurrentSessionId($db);
        $pendingRoomId = isset($_GET['room_id']) ? (int)$_GET['room_id'] : null;

        $pendingSql = "SELECT * FROM messages WHERE mentions LIKE ? AND read_by NOT LIKE ?";
        $pendingParams = ['%"' . $for . '"%', '%"' . $for . '"%'];

        if ($currentId !== null) {
            $pendingSql .= " AND session_id = ?";
            $pendingParams[] = $currentId;
        }

        if ($pendingRoomId !== null) {
            $pendingSql .= " AND room_id = ?";
            $pendingParams[] = $pendingRoomId;
        } else {
            $pendingSql .= " AND room_id IS NULL";
        }

        $pendingSql .= " ORDER BY id ASC";
        $stmt = $db->prepare($pendingSql);
        $stmt->execute($pendingParams);
        $pending = $stmt->fetchAll();

        foreach ($pending as &$m) {
            $m['mentions'] = json_decode($m['mentions'], true) ?? [];
            $m['read_by'] = json_decode($m['read_by'], true) ?? [];
        }
        unset($m);

        echo json_encode([
            'ok' => true,
            'pending' => $pending,
            'count' => count($pending),
            'paused' => $paused,
            'session_active' => $sessionActive,
            'rob_present' => $robPresent,
            'rob_typing' => $robTypingRecently
        ], JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }

    // --- History (summary + recent — for AI context windows) ---
    if ($action === 'history') {
        $mode = $_GET['mode'] ?? 'full';
        $since = (int)($_GET['since'] ?? 0);
        $historyRoomId = isset($_GET['room_id']) ? (int)$_GET['room_id'] : null;

        // Session-scoped: only current session + orphan messages
        $currentId = getCurrentSessionId($db);
        $sessionFilter = ($currentId !== null) ? " AND session_id = $currentId" : "";
        // Room-scoped: filter to specific room or lobby (NULL)
        if ($historyRoomId !== null) {
            $roomFilter = " AND room_id = " . (int)$historyRoomId;
        } else {
            $roomFilter = " AND room_id IS NULL";
        }

        if ($mode === 'since' && $since > 0) {
            // Mid-session: only new messages
            $stmt = $db->prepare("SELECT * FROM messages WHERE id > ?$sessionFilter$roomFilter ORDER BY id ASC");
            $stmt->execute([$since]);
            $messages = $stmt->fetchAll();
            foreach ($messages as &$m) {
                $m['mentions'] = json_decode($m['mentions'], true) ?? [];
                $m['read_by'] = json_decode($m['read_by'], true) ?? [];
            }
            unset($m);
            echo json_encode(['ok' => true, 'mode' => 'since', 'messages' => $messages, 'count' => count($messages)], JSON_INVALID_UTF8_SUBSTITUTE);
            exit;
        }

        // Full mode: latest summary + messages after it
        $summaryStmt = $db->query("SELECT * FROM summaries ORDER BY covers_up_to_message_id DESC LIMIT 1");
        $summary = $summaryStmt->fetch();

        $afterId = $summary ? (int)$summary['covers_up_to_message_id'] : 0;
        $recentLimit = 20;

        $stmt = $db->prepare("SELECT * FROM messages WHERE id > ?$sessionFilter$roomFilter ORDER BY id DESC LIMIT " . (int)$recentLimit);
        $stmt->execute([$afterId]);
        $messages = array_reverse($stmt->fetchAll()); // Reverse to chronological

        foreach ($messages as &$m) {
            $m['mentions'] = json_decode($m['mentions'], true) ?? [];
            $m['read_by'] = json_decode($m['read_by'], true) ?? [];
        }
        unset($m);

        $result = json_encode([
            'ok' => true,
            'mode' => 'full',
            'summary' => $summary ? $summary['summary_text'] : null,
            'summary_covers_up_to' => $afterId,
            'messages' => $messages,
            'count' => count($messages)
        ], JSON_INVALID_UTF8_SUBSTITUTE);
        if ($result === false) {
            http_response_code(500);
            echo json_encode(['ok' => false, 'error' => 'JSON encoding failed: ' . json_last_error_msg()]);
            exit;
        }
        echo $result;
        exit;
    }

    // --- Session state ---
    if ($action === 'state') {
        $stmt = $db->query("SELECT * FROM session_state ORDER BY key");
        $rows = $stmt->fetchAll();
        $state = [];
        foreach ($rows as $row) {
            $state[$row['key']] = $row['value'];
        }
        echo json_encode(['ok' => true, 'state' => $state]);
        exit;
    }

    // --- Presence (Rob's heartbeat state for watcher) ---
    if ($action === 'presence') {
        $heartbeatAt = getState($db, 'rob_heartbeat_at');
        $focused = getState($db, 'rob_focused') === 'true';
        $convState = getState($db, 'conversation_state');
        $lastInteraction = getState($db, 'last_rob_message_at');
        $robTypingAt = getState($db, 'rob_typing_at');

        // Determine if Rob is "present" (heartbeat within 5 minutes)
        $present = false;
        if ($heartbeatAt !== '') {
            $elapsed = time() - strtotime($heartbeatAt);
            $present = $elapsed < 300; // 5 minutes
        }

        echo json_encode([
            'ok' => true,
            'present' => $present,
            'focused' => $focused,
            'heartbeat_at' => $heartbeatAt,
            'last_interaction_at' => $lastInteraction,
            'rob_typing_at' => $robTypingAt,
            'conversation_state' => $convState
        ]);
        exit;
    }

    // --- Sessions list ---
    if ($action === 'sessions') {
        $stmt = $db->query("SELECT s.*, (SELECT COUNT(*) FROM messages WHERE session_id = s.id) as message_count FROM sessions s ORDER BY s.id DESC");
        $sessions = $stmt->fetchAll();
        echo json_encode([
            'ok' => true,
            'sessions' => $sessions,
            'current_session_id' => getCurrentSessionId($db)
        ], JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }

    // --- Participant status ---
    if ($action === 'status') {
        $statusMap = [];
        foreach (PARTICIPANTS_AI as $p) {
            $statusMap[$p] = getState($db, 'participant_status_' . $p);
        }
        echo json_encode(['ok' => true, 'status' => $statusMap]);
        exit;
    }

    // --- Conversations list for a participant ---
    if ($action === 'conversations') {
        $for = $_GET['for'] ?? '';
        if ($for === '' || !isValidParticipant($for)) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Missing or invalid "for" parameter']);
            exit;
        }

        $stmt = $db->prepare("
            SELECT c.*,
                CASE WHEN c.participant_a = ? THEN c.participant_b ELSE c.participant_a END AS other_participant,
                (SELECT COUNT(*) FROM dm_messages dm WHERE dm.conversation_id = c.id AND dm.sender != ? AND dm.read_at IS NULL) AS unread_count
            FROM conversations c
            WHERE c.participant_a = ? OR c.participant_b = ?
            ORDER BY c.last_message_at DESC
        ");
        $stmt->execute([$for, $for, $for, $for]);
        $conversations = $stmt->fetchAll();

        echo json_encode(['ok' => true, 'conversations' => $conversations], JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }

    // --- Rooms list ---
    if ($action === 'rooms') {
        $for = $_GET['for'] ?? '';
        if ($for !== '' && !isValidParticipant($for)) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Invalid "for" parameter']);
            exit;
        }

        if ($for !== '') {
            // Rooms where participant is a member
            $stmt = $db->prepare("
                SELECT r.*, GROUP_CONCAT(rm2.participant) as member_list
                FROM rooms r
                JOIN room_members rm ON rm.room_id = r.id AND rm.participant = ?
                LEFT JOIN room_members rm2 ON rm2.room_id = r.id
                WHERE r.archived = 0
                GROUP BY r.id
                ORDER BY r.last_message_at DESC NULLS LAST
            ");
            $stmt->execute([$for]);
        } else {
            $stmt = $db->query("
                SELECT r.*, GROUP_CONCAT(rm.participant) as member_list
                FROM rooms r
                LEFT JOIN room_members rm ON rm.room_id = r.id
                WHERE r.archived = 0
                GROUP BY r.id
                ORDER BY r.last_message_at DESC NULLS LAST
            ");
        }
        $rooms = $stmt->fetchAll();
        foreach ($rooms as &$room) {
            $room['members'] = $room['member_list'] ? explode(',', $room['member_list']) : [];
            unset($room['member_list']);
        }

        echo json_encode(['ok' => true, 'rooms' => $rooms], JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }

    // --- Room members ---
    if ($action === 'room_members') {
        $roomId = (int)($_GET['room_id'] ?? 0);
        if ($roomId === 0) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Missing room_id']);
            exit;
        }
        $stmt = $db->prepare("SELECT participant, added_at FROM room_members WHERE room_id = ? ORDER BY added_at");
        $stmt->execute([$roomId]);
        echo json_encode(['ok' => true, 'members' => $stmt->fetchAll()]);
        exit;
    }

    // --- DM messages for a conversation ---
    if ($action === 'dm_messages') {
        $conversationId = (int)($_GET['conversation_id'] ?? 0);
        if ($conversationId === 0) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Missing "conversation_id"']);
            exit;
        }

        $since = (int)($_GET['since'] ?? 0);
        $limit = (int)($_GET['limit'] ?? 0);

        $sql = "SELECT * FROM dm_messages WHERE conversation_id = ?";
        $params = [$conversationId];

        if ($since > 0) {
            $sql .= " AND id > ?";
            $params[] = $since;
        }

        $sql .= " ORDER BY id ASC";

        if ($limit > 0) {
            $sql .= " LIMIT ?";
            $params[] = $limit;
        }

        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        $messages = $stmt->fetchAll();

        // Attach file attachments to DM messages that have them
        $withAttachments = array_filter($messages, fn($m) => !empty($m['has_attachment']));
        $attachMap = !empty($withAttachments) ? getAttachmentsForDmMessages($db, array_column($withAttachments, 'id')) : [];
        foreach ($messages as &$m) {
            $m['attachments'] = $attachMap[$m['id']] ?? [];
        }
        unset($m);

        echo json_encode([
            'ok' => true,
            'dm_messages' => $messages,
            'count' => count($messages),
            'conversation_id' => $conversationId
        ], JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }

    // --- Attachments for a specific message or DM message ---
    if ($action === 'attachments') {
        $messageId = isset($_GET['message_id']) ? (int)$_GET['message_id'] : null;
        $dmMessageId = isset($_GET['dm_message_id']) ? (int)$_GET['dm_message_id'] : null;

        if ($messageId === null && $dmMessageId === null) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Provide "message_id" or "dm_message_id"']);
            exit;
        }

        if ($messageId !== null) {
            $stmt = $db->prepare("SELECT * FROM file_attachments WHERE message_id = ?");
            $stmt->execute([$messageId]);
        } else {
            $stmt = $db->prepare("SELECT * FROM file_attachments WHERE dm_message_id = ?");
            $stmt->execute([$dmMessageId]);
        }
        $attachments = $stmt->fetchAll();
        foreach ($attachments as &$a) {
            $a['url'] = 'uploads/' . $a['filename'];
        }
        unset($a);

        echo json_encode(['ok' => true, 'attachments' => $attachments], JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }

    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Unknown action']);
    exit;
}

// --- POST ---
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Handle file uploads (multipart form data) — check $_FILES before reading php://input
    if (!empty($_FILES)) {
        $input = $_POST;
    } else {
        $input = json_decode(file_get_contents('php://input'), true);
        if (!$input) {
            $input = $_POST;
        }
    }

    $action = $input['action'] ?? 'post';

    // --- Post a message ---
    if ($action === 'post') {
        $from = trim($input['from'] ?? '');
        $content = trim($input['content'] ?? '');

        if ($from === '') {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Missing "from"']);
            exit;
        }
        // Allow empty content if caller will attach files
        if ($content === '') $content = '(attachment)';

        // Allow known participants or guest handles (alphanumeric + spaces, 1-20 chars)
        $isKnown = isValidParticipant($from);
        $isValidGuest = !$isKnown && preg_match('/^[a-zA-Z0-9 _\-\[\]]{1,20}$/', $from);
        if (!$isKnown && !$isValidGuest) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Invalid "from". Use a known participant or a guest handle (1-20 alphanumeric chars).']);
            exit;
        }

        // Auto-detect @mentions (@all expands to active AI participants)
        // Build mention regex dynamically from participant registry
        $mentionPattern = implode('|', array_map('preg_quote', PARTICIPANTS_ALL)) . '|all';
        preg_match_all('/@(' . $mentionPattern . ')\b/i', $content, $matches);
        $raw = $input['mentions'] ?? $matches[1] ?? [];
        // Build canonical name map dynamically
        $canonicalNames = ['all' => 'all'];
        foreach (PARTICIPANTS_ALL as $p) { $canonicalNames[strtolower($p)] = $p; }
        $expanded = [];
        foreach ($raw as $m) {
            $normalized = $canonicalNames[strtolower($m)] ?? $m;
            if (strtolower($normalized) === 'all') {
                foreach (PARTICIPANTS_ACTIVE_AI as $ai) { $expanded[] = $ai; }
            } else {
                $expanded[] = $normalized;
            }
        }
        $mentions = array_values(array_unique($expanded));

        $tokenEst = estimateTokens($content);
        $sessionId = getCurrentSessionId($db);

        $stmt = $db->prepare("INSERT INTO messages (participant, content, mentions, read_by, token_estimate, session_id) VALUES (?, ?, ?, ?, ?, ?)");
        $stmt->execute([$from, $content, json_encode($mentions), json_encode([$from]), $tokenEst, $sessionId]);
        $id = (int)$db->lastInsertId();

        // Update exchange counter
        if ($from === 'Rob') {
            setState($db, 'exchange_counter', '0');
            setState($db, 'last_rob_message_at', gmdate('Y-m-d\TH:i:s\Z'));

            // Session/conversation control: keyword IS the message (with optional punctuation).
            // Two tiers: thread-stop (conversation_state='stopped', session stays alive)
            // and session-kill (session_active=false + conversation_state='stopped').
            $lower = trim(strtolower($content));
            $stripped = preg_replace('/[.!?,\s]+$/', '', $lower); // Remove trailing punctuation
            $startKeywords = ['good morning', 'startup', 'start session'];
            $sessionKillKeywords = ['end session', 'stop session', 'pause session'];
            $threadStopKeywords = ['stop', 'enough', 'halt', 'pause'];

            if (in_array($stripped, $startKeywords)) {
                setState($db, 'session_active', 'true');
                setState($db, 'exchange_counter', '0');
                setState($db, 'session_ended_explicitly', 'false');
                setState($db, 'conversation_state', 'active');
                setState($db, 'last_rob_message_at', gmdate('Y-m-d\TH:i:s\Z'));
                if (getCurrentSessionId($db) === null) {
                    startSession($db);
                }
            } elseif (in_array($stripped, $sessionKillKeywords)) {
                setState($db, 'session_active', 'false');
                setState($db, 'conversation_state', 'stopped');
            } elseif (in_array($stripped, $threadStopKeywords)) {
                setState($db, 'conversation_state', 'stopped');
            }

            // Auto-clear conversation stop on substantive Rob message
            $allControlWords = array_merge($startKeywords, $sessionKillKeywords, $threadStopKeywords);
            $ignoreWords = ['approve', 'approved', 'deny', 'denied', 'yes', 'no', 'ok', 'okay',
                            'k', 'thx', 'thanks', 'ty', 'np', 'lol', 'haha', 'nice'];
            if (!in_array($stripped, $allControlWords) &&
                !in_array($stripped, $ignoreWords) &&
                getState($db, 'conversation_state') === 'stopped') {
                setState($db, 'conversation_state', 'active');
            }
        } else if ($from !== 'System') {
            // Atomic increment to prevent race between concurrent AI responses
            $db->exec("UPDATE session_state SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = 'exchange_counter'");
        }

        // Fetch the created message
        $stmt = $db->prepare("SELECT * FROM messages WHERE id = ?");
        $stmt->execute([$id]);
        $message = $stmt->fetch();
        $message['mentions'] = json_decode($message['mentions'], true) ?? [];
        $message['read_by'] = json_decode($message['read_by'], true) ?? [];

        echo json_encode(['ok' => true, 'message' => $message], JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }

    // --- Update message delivery status ---
    if ($action === 'status') {
        $id = (int)($input['id'] ?? 0);
        $status = $input['status'] ?? '';
        $by = $input['by'] ?? '';
        $validStatuses = ['pending', 'delivered', 'read'];

        if ($id === 0 || !in_array($status, $validStatuses)) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Missing "id" or "status"']);
            exit;
        }

        $db->beginTransaction();
        try {
            $stmt = $db->prepare("SELECT read_by FROM messages WHERE id = ?");
            $stmt->execute([$id]);
            $row = $stmt->fetch();
            if (!$row) {
                $db->rollBack();
                http_response_code(404);
                echo json_encode(['ok' => false, 'error' => 'Message not found']);
                exit;
            }

            $readBy = json_decode($row['read_by'], true) ?? [];
            if ($by !== '' && !in_array($by, $readBy)) {
                $readBy[] = $by;
            }

            $stmt = $db->prepare("UPDATE messages SET status = ?, read_by = ? WHERE id = ?");
            $stmt->execute([$status, json_encode($readBy), $id]);
            $db->commit();
        } catch (Exception $e) {
            $db->rollBack();
            throw $e;
        }

        echo json_encode(['ok' => true]);
        exit;
    }

    // --- Set participant busy/idle ---
    if ($action === 'set_status') {
        $participant = $input['participant'] ?? '';
        $state = $input['state'] ?? '';
        if (!in_array($participant, PARTICIPANTS_AI) || !in_array($state, ['busy', 'idle', 'waiting_approval'])) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Invalid participant or state']);
            exit;
        }
        setState($db, 'participant_status_' . $participant, $state);
        echo json_encode(['ok' => true]);
        exit;
    }

    // --- Typing heartbeat ---
    if ($action === 'typing') {
        $participant = $input['participant'] ?? 'Rob';
        if ($participant === 'Rob') {
            setState($db, 'rob_typing_at', gmdate('Y-m-d\TH:i:s\Z'));
        }
        echo json_encode(['ok' => true]);
        exit;
    }

    // --- Presence heartbeat (Rob's tab is focused) ---
    if ($action === 'heartbeat') {
        $focused = ($input['focused'] ?? false) ? 'true' : 'false';
        setState($db, 'rob_heartbeat_at', gmdate('Y-m-d\TH:i:s\Z'));
        setState($db, 'rob_focused', $focused);

        // If Rob comes back after being away, resume conversation + session
        $convState = getState($db, 'conversation_state');
        if ($focused === 'true') {
            if ($convState === 'paused') {
                setState($db, 'conversation_state', 'active');
            }
            // Re-activate session ONLY if it was paused by the watcher (stale heartbeat),
            // NOT if Rob explicitly ended it via the End Session button.
            if (getState($db, 'session_active') !== 'true' && getState($db, 'session_ended_explicitly') !== 'true') {
                setState($db, 'session_active', 'true');
                setState($db, 'last_rob_message_at', gmdate('Y-m-d\TH:i:s\Z'));
                // Ensure a session row exists
                if (getCurrentSessionId($db) === null) {
                    startSession($db);
                }
            }
        }

        echo json_encode(['ok' => true, 'conversation_state' => getState($db, 'conversation_state')]);
        exit;
    }

    // --- Session control ---
    if ($action === 'session') {
        $state = $input['state'] ?? '';
        if (!in_array($state, ['active', 'paused'])) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'State must be "active" or "paused"']);
            exit;
        }
        setState($db, 'session_active', $state === 'active' ? 'true' : 'false');
        if ($state === 'active') {
            setState($db, 'exchange_counter', '0');
            setState($db, 'session_ended_explicitly', 'false');
            setState($db, 'last_rob_message_at', gmdate('Y-m-d\TH:i:s\Z'));
            // Create a new session row if none is active
            if (getCurrentSessionId($db) === null) {
                $sessionId = startSession($db);
            }
        } else {
            // Only close the session row if explicitly requested (End Session button).
            // Watcher heartbeat pauses don't close sessions — they're temporary.
            $closeSession = !empty($input['close_session']);
            if ($closeSession) {
                endSession($db);
                setState($db, 'session_ended_explicitly', 'true');
            }
        }
        echo json_encode([
            'ok' => true,
            'session_active' => $state === 'active',
            'session_id' => getCurrentSessionId($db)
        ]);
        exit;
    }

    // --- Watcher heartbeat (watcher reports it's alive) ---
    if ($action === 'watcher_heartbeat') {
        setState($db, 'watcher_heartbeat_at', gmdate('Y-m-d\TH:i:s\Z'));
        $pid = $input['pid'] ?? '';
        if ($pid !== '' && is_numeric($pid) && (int)$pid > 0) setState($db, 'watcher_pid', (string)(int)$pid);
        echo json_encode(['ok' => true]);
        exit;
    }

    // --- Set conversation state (for watcher loop detection) ---
    if ($action === 'set_conversation_state') {
        $newState = $input['state'] ?? '';
        if (!in_array($newState, ['active', 'stopped'])) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'State must be "active" or "stopped"']);
            exit;
        }
        setState($db, 'conversation_state', $newState);
        echo json_encode(['ok' => true, 'conversation_state' => $newState]);
        exit;
    }

    // --- Watcher control (start/stop from frontend) ---
    if ($action === 'watcher_control') {
        $command = $input['command'] ?? '';
        $watcherScript = 'c:\\claude-collab\\watcher.js';
        $watcherPid = (int)getState($db, 'watcher_pid');

        if ($command === 'stop' && $watcherPid > 0) {
            exec("taskkill /PID " . $watcherPid . " /F 2>&1", $out, $code);
            setState($db, 'watcher_pid', '');
            setState($db, 'watcher_heartbeat_at', '');
            echo json_encode(['ok' => true, 'action' => 'stopped', 'output' => implode("\n", $out)], JSON_INVALID_UTF8_SUBSTITUTE);
            exit;
        }

        if ($command === 'start' || $command === 'restart') {
            // Kill existing if restart
            if ($command === 'restart' && $watcherPid > 0) {
                exec("taskkill /PID " . $watcherPid . " /F 2>&1");
                sleep(1);
            }
            // Start new watcher in background
            $cmd = "start /B node \"{$watcherScript}\" > NUL 2>&1";
            pclose(popen($cmd, 'r'));
            echo json_encode(['ok' => true, 'action' => $command === 'restart' ? 'restarted' : 'started']);
            exit;
        }

        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Command must be start, stop, or restart']);
        exit;
    }

    // --- Store a summary ---
    if ($action === 'summary') {
        $text = trim($input['summary_text'] ?? '');
        $coversUpTo = (int)($input['covers_up_to'] ?? 0);
        if ($text === '' || $coversUpTo === 0) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Missing summary_text or covers_up_to']);
            exit;
        }
        $tokenEst = estimateTokens($text);
        $stmt = $db->prepare("INSERT INTO summaries (covers_up_to_message_id, summary_text, token_estimate) VALUES (?, ?, ?)");
        $stmt->execute([$coversUpTo, $text, $tokenEst]);
        echo json_encode(['ok' => true, 'id' => (int)$db->lastInsertId()]);
        exit;
    }

    // --- Send a DM ---
    if ($action === 'dm') {
        $from = trim($input['from'] ?? '');
        $to = trim($input['to'] ?? '');
        $content = trim($input['content'] ?? '');

        if ($from === '' || $to === '') {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Missing "from" or "to"']);
            exit;
        }
        // Allow empty content if caller will attach files
        if ($content === '') $content = '(attachment)';
        if ($from === $to) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Cannot DM yourself']);
            exit;
        }
        if (!isValidParticipant($from) || !isValidParticipant($to)) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Invalid participant name']);
            exit;
        }

        $convo = findOrCreateConversation($db, $from, $to);

        $stmt = $db->prepare("INSERT INTO dm_messages (conversation_id, sender, content) VALUES (?, ?, ?)");
        $stmt->execute([$convo['id'], $from, $content]);
        $msgId = (int)$db->lastInsertId();

        // Update conversation metadata
        $preview = mb_substr($content, 0, 100);
        $stmt = $db->prepare("UPDATE conversations SET last_message_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_message_preview = ? WHERE id = ?");
        $stmt->execute([$preview, $convo['id']]);

        // Fetch the created message
        $stmt = $db->prepare("SELECT * FROM dm_messages WHERE id = ?");
        $stmt->execute([$msgId]);
        $message = $stmt->fetch();

        echo json_encode(['ok' => true, 'dm_message' => $message, 'conversation_id' => (int)$convo['id']], JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }

    // --- Create conversation explicitly ---
    if ($action === 'create_conversation') {
        $from = trim($input['from'] ?? '');
        $with = trim($input['with'] ?? '');

        if ($from === '' || $with === '') {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Missing "from" or "with"']);
            exit;
        }
        if ($from === $with) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Cannot create conversation with yourself']);
            exit;
        }
        if (!isValidParticipant($from) || !isValidParticipant($with)) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Invalid participant name']);
            exit;
        }

        $convo = findOrCreateConversation($db, $from, $with);
        echo json_encode(['ok' => true, 'conversation' => $convo], JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }

    // --- Mark DMs as read ---
    if ($action === 'dm_read') {
        $conversationId = (int)($input['conversation_id'] ?? 0);
        $reader = trim($input['reader'] ?? '');

        if ($conversationId === 0 || $reader === '') {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Missing "conversation_id" or "reader"']);
            exit;
        }

        $stmt = $db->prepare("UPDATE dm_messages SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE conversation_id = ? AND sender != ? AND read_at IS NULL");
        $stmt->execute([$conversationId, $reader]);
        $updated = $stmt->rowCount();

        echo json_encode(['ok' => true, 'marked_read' => $updated]);
        exit;
    }

    // --- Create a private room (Rob only) ---
    if ($action === 'create_room') {
        $name = trim($input['name'] ?? '');
        $members = $input['members'] ?? [];

        if ($name === '' || strlen($name) > 50) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Room name required (1-50 chars)']);
            exit;
        }
        if (!is_array($members)) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Members must be an array']);
            exit;
        }

        // Validate all members
        foreach ($members as $m) {
            if (!isValidParticipant($m)) {
                http_response_code(400);
                echo json_encode(['ok' => false, 'error' => "Invalid member: $m"]);
                exit;
            }
        }

        // Rob is always included
        if (!in_array('Rob', $members)) {
            array_unshift($members, 'Rob');
        }
        $members = array_unique($members);

        // Create room
        $stmt = $db->prepare("INSERT INTO rooms (name, created_by) VALUES (?, 'Rob')");
        $stmt->execute([$name]);
        $roomId = (int)$db->lastInsertId();

        // Add members
        $memberStmt = $db->prepare("INSERT INTO room_members (room_id, participant) VALUES (?, ?)");
        foreach ($members as $m) {
            $memberStmt->execute([$roomId, $m]);
        }

        echo json_encode([
            'ok' => true,
            'room' => [
                'id' => $roomId,
                'name' => $name,
                'members' => array_values($members),
                'conversation_state' => 'active'
            ]
        ]);
        exit;
    }

    // --- Post a message to a room ---
    if ($action === 'room_message') {
        $roomId = (int)($input['room_id'] ?? 0);
        $from = trim($input['from'] ?? '');
        $content = trim($input['content'] ?? '');

        if ($roomId === 0) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Missing room_id']);
            exit;
        }
        if ($from === '') {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Missing "from"']);
            exit;
        }
        if ($content === '') {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Missing content']);
            exit;
        }

        // Verify room exists
        $roomStmt = $db->prepare("SELECT * FROM rooms WHERE id = ? AND archived = 0");
        $roomStmt->execute([$roomId]);
        $room = $roomStmt->fetch();
        if (!$room) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Room not found']);
            exit;
        }

        // Verify sender is a member
        $memberCheck = $db->prepare("SELECT 1 FROM room_members WHERE room_id = ? AND participant = ?");
        $memberCheck->execute([$roomId, $from]);
        if (!$memberCheck->fetch()) {
            http_response_code(403);
            echo json_encode(['ok' => false, 'error' => "$from is not a member of this room"]);
            exit;
        }

        // Parse @mentions scoped to room members
        $roomMembersStmt = $db->prepare("SELECT participant FROM room_members WHERE room_id = ?");
        $roomMembersStmt->execute([$roomId]);
        $roomMemberNames = $roomMembersStmt->fetchAll(PDO::FETCH_COLUMN);
        $mentionPattern = implode('|', array_map('preg_quote', $roomMemberNames)) . '|all';
        preg_match_all('/@(' . $mentionPattern . ')\b/i', $content, $matches);
        $raw = $matches[1] ?? [];
        $canonicalNames = ['all' => 'all'];
        foreach (PARTICIPANTS_ALL as $p) { $canonicalNames[strtolower($p)] = $p; }
        $expanded = [];
        foreach ($raw as $m) {
            $normalized = $canonicalNames[strtolower($m)] ?? $m;
            if (strtolower($normalized) === 'all') {
                // @all in a room = all AI members of this room
                foreach ($roomMemberNames as $rm) {
                    if (in_array($rm, PARTICIPANTS_AI)) $expanded[] = $rm;
                }
            } else {
                $expanded[] = $normalized;
            }
        }
        $mentions = json_encode(array_values(array_unique($expanded)));

        $tokenEst = estimateTokens($content);
        $sessionId = getCurrentSessionId($db);

        $stmt = $db->prepare("INSERT INTO messages (participant, content, mentions, token_estimate, session_id, room_id) VALUES (?, ?, ?, ?, ?, ?)");
        $stmt->execute([$from, $content, $mentions, $tokenEst, $sessionId, $roomId]);
        $msgId = (int)$db->lastInsertId();

        // Update room metadata
        $preview = mb_substr($content, 0, 80);
        $db->prepare("UPDATE rooms SET last_message_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_message_preview = ? WHERE id = ?")->execute([$preview, $roomId]);

        // Rob stop signals for this room only
        if ($from === 'Rob') {
            setState($db, 'last_rob_message_at', gmdate('Y-m-d\TH:i:s\Z'));
            $stopPatterns = '/^(stop|halt|pause|enough)$/i';
            if (preg_match($stopPatterns, trim($content))) {
                $db->prepare("UPDATE rooms SET conversation_state = 'stopped' WHERE id = ?")->execute([$roomId]);
            }
            // Increment global exchange counter
            $ex = (int)getState($db, 'exchange_counter');
            setState($db, 'exchange_counter', (string)($ex + 1));
        }

        echo json_encode(['ok' => true, 'id' => $msgId], JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }

    // --- Add member to room ---
    if ($action === 'add_room_member') {
        $roomId = (int)($input['room_id'] ?? 0);
        $participant = trim($input['participant'] ?? '');

        if ($roomId === 0 || !isValidParticipant($participant)) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Invalid room_id or participant']);
            exit;
        }

        $stmt = $db->prepare("INSERT OR IGNORE INTO room_members (room_id, participant) VALUES (?, ?)");
        $stmt->execute([$roomId, $participant]);
        echo json_encode(['ok' => true]);
        exit;
    }

    // --- Remove member from room ---
    if ($action === 'remove_room_member') {
        $roomId = (int)($input['room_id'] ?? 0);
        $participant = trim($input['participant'] ?? '');

        if ($roomId === 0 || $participant === '') {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Invalid room_id or participant']);
            exit;
        }
        if ($participant === 'Rob') {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Cannot remove Rob from a room']);
            exit;
        }

        $stmt = $db->prepare("DELETE FROM room_members WHERE room_id = ? AND participant = ?");
        $stmt->execute([$roomId, $participant]);
        echo json_encode(['ok' => true]);
        exit;
    }

    // --- Set room conversation state ---
    if ($action === 'set_room_state') {
        $roomId = (int)($input['room_id'] ?? 0);
        $state = trim($input['state'] ?? '');

        if ($roomId === 0 || !in_array($state, ['active', 'stopped'])) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Invalid room_id or state']);
            exit;
        }

        $stmt = $db->prepare("UPDATE rooms SET conversation_state = ? WHERE id = ?");
        $stmt->execute([$state, $roomId]);
        echo json_encode(['ok' => true]);
        exit;
    }

    // --- File upload ---
    if ($action === 'upload') {
        if (empty($_FILES['file'])) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'No file uploaded. Send as multipart form with field name "file"']);
            exit;
        }

        $file = $_FILES['file'];
        $uploadedBy = trim($input['uploaded_by'] ?? '');
        $messageId = isset($input['message_id']) ? (int)$input['message_id'] : null;
        $dmMessageId = isset($input['dm_message_id']) ? (int)$input['dm_message_id'] : null;
        $overrideCap = ($input['override_cap'] ?? '') === 'true';

        if ($uploadedBy === '') {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Missing "uploaded_by"']);
            exit;
        }
        if (!isValidParticipant($uploadedBy)) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Invalid "uploaded_by" participant name']);
            exit;
        }

        // Check for upload errors
        if ($file['error'] !== UPLOAD_ERR_OK) {
            $errorMessages = [
                UPLOAD_ERR_INI_SIZE => 'File exceeds server upload_max_filesize',
                UPLOAD_ERR_FORM_SIZE => 'File exceeds form MAX_FILE_SIZE',
                UPLOAD_ERR_PARTIAL => 'File was only partially uploaded',
                UPLOAD_ERR_NO_FILE => 'No file was uploaded',
                UPLOAD_ERR_NO_TMP_DIR => 'Missing temporary folder',
                UPLOAD_ERR_CANT_WRITE => 'Failed to write file to disk',
                UPLOAD_ERR_EXTENSION => 'Upload stopped by PHP extension',
            ];
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => $errorMessages[$file['error']] ?? 'Upload error code ' . $file['error']]);
            exit;
        }

        // Size check
        $maxSize = $overrideCap ? 52428800 : 10485760; // 50MB or 10MB
        if ($file['size'] > $maxSize) {
            http_response_code(400);
            $maxMB = $maxSize / 1048576;
            echo json_encode(['ok' => false, 'error' => "File too large. Maximum is {$maxMB}MB"]);
            exit;
        }

        // Block executable extensions
        $originalName = basename($file['name']);
        $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
        $allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'svg',
                              'txt', 'md', 'log', 'csv', 'json', 'xml',
                              'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
                              'zip', 'tar', 'gz', 'mp3', 'mp4', 'wav', 'ogg', 'webm'];
        if (!in_array($ext, $allowedExtensions)) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => "File type .{$ext} is not allowed"]);
            exit;
        }

        // Generate unique filename
        $timestamp = time();
        $random = bin2hex(random_bytes(8));
        $safeOriginal = preg_replace('/[^a-zA-Z0-9._-]/', '_', $originalName);
        $uniqueName = "{$timestamp}_{$random}_{$safeOriginal}";

        $destPath = $uploadsDir . '/' . $uniqueName;
        if (!move_uploaded_file($file['tmp_name'], $destPath)) {
            http_response_code(500);
            echo json_encode(['ok' => false, 'error' => 'Failed to move uploaded file']);
            exit;
        }

        // Detect MIME type
        $mimeType = $file['type'] ?: (function_exists('mime_content_type') ? mime_content_type($destPath) : 'application/octet-stream');

        // Insert into file_attachments
        $stmt = $db->prepare("INSERT INTO file_attachments (message_id, dm_message_id, filename, original_name, mime_type, size_bytes, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([
            $messageId,
            $dmMessageId,
            $uniqueName,
            $originalName,
            $mimeType,
            $file['size'],
            $uploadedBy
        ]);
        $attachmentId = (int)$db->lastInsertId();

        // Update has_attachment flag on the associated message
        if ($messageId !== null && $messageId > 0) {
            $db->prepare("UPDATE messages SET has_attachment = 1 WHERE id = ?")->execute([$messageId]);
        }
        if ($dmMessageId !== null && $dmMessageId > 0) {
            $db->prepare("UPDATE dm_messages SET has_attachment = 1 WHERE id = ?")->execute([$dmMessageId]);
        }

        // Fetch the created record
        $stmt = $db->prepare("SELECT * FROM file_attachments WHERE id = ?");
        $stmt->execute([$attachmentId]);
        $attachment = $stmt->fetch();
        $attachment['url'] = 'uploads/' . $attachment['filename'];

        echo json_encode(['ok' => true, 'attachment' => $attachment], JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }

    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Unknown action']);
    exit;
}

http_response_code(405);
echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
