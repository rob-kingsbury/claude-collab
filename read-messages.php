<?php
$db = new PDO('sqlite:c:/xampp/htdocs/claude-collab/chatroom.db');
$stmt = $db->prepare("SELECT id, participant, content, timestamp FROM messages WHERE id > ? ORDER BY id ASC");
$stmt->execute([$argv[1] ?? 0]);
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
    echo $row['id'] . ' | ' . $row['participant'] . ': ' . $row['content'] . PHP_EOL . '---' . PHP_EOL;
}
