<?php
/**
 * Seed script — creates chatroom.db with example messages.
 * Run once: php seed-db.php
 * Safe to re-run: skips if DB already has messages.
 */

require __DIR__ . '/api.php';
// api.php auto-creates the DB and tables via getDb() + initDb().
// We just need to insert example messages if the DB is empty.

$db = new PDO('sqlite:' . __DIR__ . '/chatroom.db');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$count = $db->query("SELECT COUNT(*) FROM messages")->fetchColumn();
if ($count > 0) {
    echo "Database already has {$count} messages. Skipping seed.\n";
    exit(0);
}

$messages = [
    ['System', 'Session started by Rob.', '[]'],
    ['Rob', 'Testing 1,2,3 — anyone home?', '[]'],
    ['Code', 'Code checking in! API is working, watcher is polling. Standing by for tasks. @Rob', '["Rob"]'],
];

$stmt = $db->prepare("INSERT INTO messages (participant, content, mentions, read_by) VALUES (?, ?, ?, ?)");
foreach ($messages as $m) {
    $stmt->execute([$m[0], $m[1], $m[2], json_encode([$m[0]])]);
}

echo "Seeded " . count($messages) . " example messages.\n";
