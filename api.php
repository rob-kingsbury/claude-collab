<?php
/**
 * Claude Collab Chatroom API — SQLite Backend
 *
 * GET  ?action=messages[&since=ID][&limit=N]  → return messages
 * GET  ?action=pending&for=<name>             → unread messages mentioning participant
 * GET  ?action=history&mode=full|since&since=N → summary + recent messages (for AI context)
 * GET  ?action=state                          → session state (active, typing, exchange count)
 * GET  ?action=status                         → participant busy/idle status
 * POST {from, content}                        → add a message
 * POST {action: "status", id, status, by}     → update message delivery status
 * POST {action: "set_status", participant, state} → set participant busy/idle
 * POST {action: "typing", participant}         → typing heartbeat
 * POST {action: "heartbeat"}                   → Rob's presence heartbeat (tab focused)
 * GET  ?action=presence                        → Rob's presence state
 * POST {action: "session", state}              → set session active/paused
 * POST {action: "summary", summary_text, covers_up_to} → store a summary
 */

header('Content-Type: application/json');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

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
            token_estimate INTEGER DEFAULT 0
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
    ");

    // Initialize session state defaults
    $defaults = [
        'session_active' => 'false',
        'exchange_counter' => '0',
        'exchange_cap' => '5',
        'last_rob_message_at' => '',
        'rob_typing_at' => '',
        'participant_status_Soren' => 'idle',
        'participant_status_Atlas' => 'idle',
        'participant_status_Web' => 'idle',
        'participant_status_Ellison' => 'idle',
        'rob_heartbeat_at' => '',
        'rob_focused' => 'false',
        'conversation_state' => 'active',
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

// Watcher runs as a standalone process in Rob's user session.
// PHP only toggles session_active — watcher sees the flag on next poll.

$db = getDb($DB_PATH);

// --- GET ---
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? 'messages';

    // --- Messages (with optional since/limit) ---
    if ($action === 'messages') {
        $since = (int)($_GET['since'] ?? 0);
        $limit = (int)($_GET['limit'] ?? 0);

        $sql = "SELECT * FROM messages";
        $params = [];

        if ($since > 0) {
            $sql .= " WHERE id > ?";
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

        // Decode JSON fields
        foreach ($messages as &$m) {
            $m['mentions'] = json_decode($m['mentions'], true) ?? [];
            $m['read_by'] = json_decode($m['read_by'], true) ?? [];
        }
        unset($m);

        $countStmt = $db->query("SELECT COUNT(*) as cnt FROM messages");
        $total = $countStmt->fetch()['cnt'];

        echo json_encode(['ok' => true, 'messages' => $messages, 'count' => count($messages), 'total' => (int)$total]);
        exit;
    }

    // --- Pending (for trigger system) ---
    if ($action === 'pending') {
        $for = $_GET['for'] ?? '';
        $validParticipants = ['Rob', 'Soren', 'Atlas', 'Web', 'Ellison'];
        if ($for === '' || !in_array($for, $validParticipants)) {
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
        $stmt = $db->prepare("SELECT * FROM messages WHERE mentions LIKE ? AND read_by NOT LIKE ? ORDER BY id ASC");
        $stmt->execute(['%"' . $for . '"%', '%"' . $for . '"%']);
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
        ]);
        exit;
    }

    // --- History (summary + recent — for AI context windows) ---
    if ($action === 'history') {
        $mode = $_GET['mode'] ?? 'full';
        $since = (int)($_GET['since'] ?? 0);

        if ($mode === 'since' && $since > 0) {
            // Mid-session: only new messages
            $stmt = $db->prepare("SELECT * FROM messages WHERE id > ? ORDER BY id ASC");
            $stmt->execute([$since]);
            $messages = $stmt->fetchAll();
            foreach ($messages as &$m) {
                $m['mentions'] = json_decode($m['mentions'], true) ?? [];
                $m['read_by'] = json_decode($m['read_by'], true) ?? [];
            }
            unset($m);
            echo json_encode(['ok' => true, 'mode' => 'since', 'messages' => $messages, 'count' => count($messages)]);
            exit;
        }

        // Full mode: latest summary + messages after it
        $summaryStmt = $db->query("SELECT * FROM summaries ORDER BY covers_up_to_message_id DESC LIMIT 1");
        $summary = $summaryStmt->fetch();

        $afterId = $summary ? (int)$summary['covers_up_to_message_id'] : 0;
        $recentLimit = 20;

        $stmt = $db->prepare("SELECT * FROM messages WHERE id > ? ORDER BY id DESC LIMIT ?");
        $stmt->execute([$afterId, $recentLimit]);
        $messages = array_reverse($stmt->fetchAll()); // Reverse to chronological

        foreach ($messages as &$m) {
            $m['mentions'] = json_decode($m['mentions'], true) ?? [];
            $m['read_by'] = json_decode($m['read_by'], true) ?? [];
        }
        unset($m);

        echo json_encode([
            'ok' => true,
            'mode' => 'full',
            'summary' => $summary ? $summary['summary_text'] : null,
            'summary_covers_up_to' => $afterId,
            'messages' => $messages,
            'count' => count($messages)
        ]);
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

    // --- Participant status ---
    if ($action === 'status') {
        echo json_encode(['ok' => true, 'status' => [
            'Soren' => getState($db, 'participant_status_Soren'),
            'Atlas' => getState($db, 'participant_status_Atlas'),
            'Web' => getState($db, 'participant_status_Web'),
            'Ellison' => getState($db, 'participant_status_Ellison'),
        ]]);
        exit;
    }

    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Unknown action: ' . $action]);
    exit;
}

// --- POST ---
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    if (!$input) {
        $input = $_POST;
    }

    $action = $input['action'] ?? 'post';

    // --- Post a message ---
    if ($action === 'post') {
        $from = trim($input['from'] ?? '');
        $content = trim($input['content'] ?? '');

        if ($from === '' || $content === '') {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Missing "from" or "content"']);
            exit;
        }

        $validFrom = ['Rob', 'Soren', 'Atlas', 'Web', 'System', 'Ellison'];
        if (!in_array($from, $validFrom)) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Invalid "from". Must be one of: ' . implode(', ', $validFrom)]);
            exit;
        }

        // Auto-detect @mentions
        preg_match_all('/@(Rob|Soren|Atlas|Web|Ellison)\b/', $content, $matches);
        $mentions = array_values(array_unique($input['mentions'] ?? $matches[1] ?? []));

        $tokenEst = estimateTokens($content);

        $stmt = $db->prepare("INSERT INTO messages (participant, content, mentions, read_by, token_estimate) VALUES (?, ?, ?, ?, ?)");
        $stmt->execute([$from, $content, json_encode($mentions), json_encode([$from]), $tokenEst]);
        $id = (int)$db->lastInsertId();

        // Update exchange counter
        if ($from === 'Rob') {
            setState($db, 'exchange_counter', '0');
            setState($db, 'last_rob_message_at', gmdate('Y-m-d\TH:i:s\Z'));

            // Session activation: only match when the keyword IS the message (with optional punctuation)
            // or appears as an explicit command. Prevents "don't stop working" from killing the session.
            $lower = trim(strtolower($content));
            $stripped = preg_replace('/[.!?,\s]+$/', '', $lower); // Remove trailing punctuation
            $startKeywords = ['good morning', 'startup', 'start session'];
            $stopKeywords = ['stop', 'stop session', 'pause', 'pause session', 'halt', 'end session'];
            if (in_array($stripped, $startKeywords)) {
                setState($db, 'session_active', 'true');
                setState($db, 'exchange_counter', '0');
            }
            if (in_array($stripped, $stopKeywords)) {
                setState($db, 'session_active', 'false');
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

        echo json_encode(['ok' => true, 'message' => $message]);
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
        $validStatusParticipants = ['Soren', 'Atlas', 'Web', 'Ellison'];
        if (!in_array($participant, $validStatusParticipants) || !in_array($state, ['busy', 'idle'])) {
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
            // Re-activate session if watcher paused it due to stale heartbeat
            if (getState($db, 'session_active') !== 'true') {
                setState($db, 'session_active', 'true');
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
        }
        echo json_encode(['ok' => true, 'session_active' => $state === 'active']);
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

    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Unknown action: ' . $action]);
    exit;
}

http_response_code(405);
echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
